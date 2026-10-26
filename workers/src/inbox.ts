/* eslint-disable no-console */
/**
 * Reads the forwarded-bank-email label in Gmail over IMAP, turns balance alerts and statements into balance
 * readings and records them (rules and safety checks live in @fwos/ingest and are tested there).
 * Runs in GitHub Actions. Uses the same Gmail app password as the daily summary; IMAP must be switched on in Gmail.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { extractText, getDocumentProxy } from 'unpdf';
import { createClient } from '@supabase/supabase-js';
import {
  resolveWorkingModel,
  runInbox,
  type InboxIo,
  type InboxMessage,
  type KnownAccount,
} from '@fwos/ingest';
import { importCasPdf, importTaxFile } from '@fwos/data';

const need = (n: string) => {
  const v = process.env[n];
  if (!v) {
    console.error(`${n} is required`);
    process.exit(2);
  }
  return v;
};
const db = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});
const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

const today = new Date().toISOString().slice(0, 10);

async function householdId(): Promise<string> {
  if (process.env.INBOX_HOUSEHOLD_ID) return process.env.INBOX_HOUSEHOLD_ID;
  const rows = must(await db.from('households').select('id'), 'households');
  if (rows.length !== 1)
    throw new Error(
      `Expected exactly one household, found ${rows.length}; set INBOX_HOUSEHOLD_ID.`,
    );
  return rows[0]!.id as string;
}

const stripHtml = (h: string) =>
  h
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const hh = await householdId();
  const settings = must(
    await db
      .from('integration_settings')
      .select('ai_provider, ai_api_key, inbox_label')
      .eq('household_id', hh)
      .maybeSingle(),
    'settings',
  ) as {
    ai_provider: 'groq' | 'gemini' | null;
    ai_api_key: string | null;
    inbox_label: string;
  } | null;
  const label = settings?.inbox_label ?? 'FWOS/Inbox';
  // providers retire models without notice, so ask which one this key can use
  const model =
    settings?.ai_provider && settings.ai_api_key
      ? await resolveWorkingModel(
          (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(20_000) }),
          settings.ai_provider,
          settings.ai_api_key,
        )
      : null;
  const ai =
    settings?.ai_provider && settings.ai_api_key
      ? { provider: settings.ai_provider, key: settings.ai_api_key, ...(model ? { model } : {}) }
      : null;

  const io: InboxIo = {
    async accounts() {
      const assets = must(
        await db
          .from('assets')
          .select('id, type, currency, identifier_last4, institution_id')
          .eq('household_id', hh)
          .in('type', ['bank_account', 'third_party_held']),
        'assets',
      );
      const inst = new Map(
        must(
          await db.from('institutions').select('id, name').eq('household_id', hh),
          'institutions',
        ).map((i) => [i.id as string, i.name as string]),
      );
      return assets.map((a): KnownAccount => ({
        assetId: a.id as string,
        institution: inst.get(a.institution_id as string) ?? '',
        last4: (a.identifier_last4 as string | null) ?? null,
        currency: a.currency as string,
        type: a.type as string,
      }));
    },
    async latestObservation(assetId) {
      const r = must(
        await db
          .from('observations')
          .select('amount, as_of')
          .eq('asset_id', assetId)
          .is('superseded_by', null)
          .order('as_of', { ascending: false })
          .limit(1),
        'latest observation',
      );
      return r[0] ? { amount: Number(r[0].amount), asOf: r[0].as_of as string } : null;
    },
    async alreadySeen(messageId) {
      const r = await db
        .from('inbox_messages')
        .select('id', { count: 'exact', head: true })
        .eq('household_id', hh)
        .eq('message_id', messageId);
      if (r.error) throw new Error(`seen check: ${r.error.message}`);
      return (r.count ?? 0) > 0;
    },
    async record(row) {
      must(
        await db.from('inbox_messages').upsert(
          {
            household_id: hh,
            message_id: row.messageId,
            received_on: row.receivedOn,
            from_domain: row.fromDomain,
            subject: row.subject,
            outcome: row.outcome,
            reason: row.reason,
            reading: row.reading,
            asset_id: row.assetId,
          },
          { onConflict: 'household_id,message_id' },
        ),
        'log message',
      );
    },
    async apply({ assetId, reading, messageId, source }) {
      let fx: number | null = null;
      if (reading.currency !== 'INR') {
        const r = must(
          await db
            .from('fx_rates')
            .select('inr_per_unit')
            .eq('currency', reading.currency)
            .lte('rate_date', reading.asOf)
            .order('rate_date', { ascending: false })
            .limit(1),
          'fx rate',
        );
        fx = r[0] ? Number(r[0].inr_per_unit) : null;
        if (!fx)
          throw new Error(
            `No ${reading.currency} exchange rate on record yet; run the market-data job first`,
          );
      }
      must(
        await db.from('observations').insert({
          household_id: hh,
          asset_id: assetId,
          kind: 'balance',
          amount: reading.amount,
          currency: reading.currency,
          fx_rate: fx,
          as_of: reading.asOf,
          received_at: new Date().toISOString(),
          source,
          source_ref: messageId.slice(0, 200),
          confidence: reading.source === 'rule' ? 'verified' : 'imported_unverified',
          note:
            reading.source === 'ai'
              ? 'Read from a statement by an AI service'
              : 'Read from a bank balance alert',
        }),
        'record balance',
      );
    },
    async casImport(m) {
      const pans = must(
        await db.from('owner_pan').select('owner_id, pan').eq('household_id', hh),
        'saved PANs',
      ) as { owner_id: string; pan: string }[];
      const candidates = pans.map((p) => ({
        ownerId: p.owner_id,
        passwords: [p.pan, p.pan.toLowerCase()],
        panLast4: p.pan.slice(-4),
      }));
      const results = [];
      for (const a of m.attachments)
        results.push(
          await importCasPdf(db, hh, a.content, candidates, {
            sourceRef: `${m.messageId}|${a.filename}`,
            today,
            receivedOn: m.receivedOn,
          }),
        );
      const ok = results.filter((r) => r.outcome !== 'failed');
      if (ok.length === 0)
        return {
          outcome: 'failed',
          reason: results
            .map((r) => r.detail)
            .join(' ')
            .slice(0, 300),
        };
      const n = ok.reduce((a, r) => a + (r.report?.matched ?? 0) + (r.report?.created ?? 0), 0);
      const t = ok.reduce((a, r) => a + (r.report?.transactionsAdded ?? 0), 0);
      const review = ok.flatMap((r) => r.report?.needsReview ?? []);
      return {
        outcome: review.length > 0 ? 'partial' : 'imported',
        reason: `${n} funds updated, ${t} new transactions${review.length ? `; check: ${review.join(', ')}` : ''}`,
      };
    },
    async taxImport(m) {
      const owners = must(
        await db.from('owners').select('id, dob, pan_last4').eq('household_id', hh),
        'people',
      ) as { id: string; dob: string | null; pan_last4: string | null }[];
      const pans = new Map(
        (
          must(
            await db.from('owner_pan').select('owner_id, pan').eq('household_id', hh),
            'saved PANs',
          ) as { owner_id: string; pan: string }[]
        ).map((p) => [p.owner_id, p.pan]),
      );
      let lastReason = 'no attachment could be read';
      for (const a of m.attachments) {
        for (const o of owners) {
          const dob = o.dob
            ? `${o.dob.slice(8, 10)}${o.dob.slice(5, 7)}${o.dob.slice(0, 4)}`
            : null;
          const pan = pans.get(o.id) ?? null;
          const passwords = [
            ...(dob ? [dob] : []),
            ...(dob && pan ? [pan.toLowerCase() + dob, pan + dob] : []),
          ];
          const res = await importTaxFile(db, hh, { id: o.id, panLast4: o.pan_last4 }, a.content, {
            passwords,
            ai,
            fetchJson: (url, init) => io.fetchJson(url, init),
          });
          if (res.ok) return { outcome: 'imported', reason: res.message };
          lastReason = res.message;
          if (!/does not match|password/i.test(res.message)) break;
        }
      }
      return { outcome: 'failed', reason: lastReason };
    },
    async fetchJson(url, init) {
      const res = await fetch(url, init);
      if (!res.ok) {
        const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        throw new Error(`AI service answered ${res.status}: ${body}`);
      }
      return res.json();
    },
    async pdfText(content) {
      const pdf = await getDocumentProxy(new Uint8Array(content));
      const { text } = await extractText(pdf, { mergePages: true });
      return text;
    },
  };

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: need('SMTP_USER'), pass: need('SMTP_APP_PASSWORD') },
    logger: false,
  });
  const messages: InboxMessage[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock(label);
    try {
      // already handled messages are skipped, so a longer look-back is safe and catches mail labelled late
      const since = new Date(Date.now() - Number(process.env.INBOX_DAYS || 35) * 86_400_000);
      const uids = (await client.search({ since })) || [];
      for await (const m of client.fetch(uids, { source: true, uid: true })) {
        if (!m.source) continue;
        const p = await simpleParser(m.source);
        messages.push({
          messageId: p.messageId ?? `uid-${m.uid}@${label}`,
          from: p.from?.text ?? '',
          subject: p.subject ?? '',
          text: p.text ?? (typeof p.html === 'string' ? stripHtml(p.html) : ''),
          receivedOn: (p.date ?? new Date()).toISOString().slice(0, 10),
          attachments: p.attachments
            .filter((a) => /\.pdf$/i.test(a.filename ?? '') || a.contentType === 'application/pdf')
            .map((a) => ({
              filename: a.filename ?? 'attachment.pdf',
              content: new Uint8Array(a.content),
            })),
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  const report = await runInbox(messages, io, { today, ai });
  console.log(
    `Inbox: ${report.seen} messages (${report.skipped} already handled): applied ${report.applied}, to review ${report.needsReview}, ignored ${report.ignored}, errors ${report.errors}`,
  );
  for (const l of report.lines) console.log(' -', l);
  if (report.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Inbox job failed:', (e as Error).message);
  process.exit(1);
});
