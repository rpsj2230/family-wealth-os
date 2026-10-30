/* eslint-disable no-console */
/**
 * Reads the forwarded-bank-email label in Gmail over IMAP, turns balance alerts and statements into balance
 * readings and records them (rules and safety checks live in @fwos/ingest and are tested there).
 * Runs in GitHub Actions. Uses the same Gmail app password as the daily summary; IMAP must be switched on in Gmail.
 */
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { extractText, getDocumentProxy } from 'unpdf';
import { connectDb, householdId, must, need } from './shared';
import {
  PROVIDER_SHORT,
  runInbox,
  type AiAttempt,
  type InboxIo,
  type InboxMessage,
  type KnownAccount,
} from '@fwos/ingest';
import {
  aiChainFor,
  importCasAttachments,
  importTaxFile,
  loadSettings,
  rebuildStatementMoves,
  saveAlertLine,
} from '@fwos/data';

const db = connectDb();

const today = new Date().toISOString().slice(0, 10);
const logAiFailure = (a: AiAttempt) =>
  console.log(`AI: ${a.brief}${a.detail ? ` - ${a.detail}` : ''}`);

const stripHtml = (h: string) =>
  h
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

async function main() {
  const hh = await householdId(db);
  const settings = must(
    await db
      .from('integration_settings')
      .select('inbox_label')
      .eq('household_id', hh)
      .maybeSingle(),
    'settings',
  ) as { inbox_label: string } | null;
  const label = settings?.inbox_label ?? 'FWOS/Inbox';
  // the AI keys that are switched on, first choice first: when one fails the next is asked, and a key that was refused is not
  // asked again in this run. Each key's model is checked when it is first needed (providers retire models without notice).
  const ai = await aiChainFor(db, hh, 'service', { onFailure: logAiFailure });
  console.log(
    ai.empty
      ? 'AI: no key is switched on (statements and unfamiliar e-mails are not read).'
      : `AI keys, in order: ${ai.keys.map((k) => PROVIDER_SHORT[k.provider]).join(', ')}.`,
  );

  let alertLines = 0;
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
          .select('amount, as_of, source, received_at')
          .eq('asset_id', assetId)
          .is('superseded_by', null)
          .order('as_of', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(1),
        'latest observation',
      );
      return r[0]
        ? {
            amount: Number(r[0].amount),
            asOf: r[0].as_of as string,
            source: (r[0].source as string | null) ?? null,
            receivedAt: (r[0].received_at as string | null) ?? null,
          }
        : null;
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
            body_text: row.bodyText,
            rescan_requested_at: null,
          },
          { onConflict: 'household_id,message_id' },
        ),
        'log message',
      );
    },
    // the movement an alert reports, as a statement line of the account (a later statement takes its place)
    async addAlertLine({ assetId, date, amount, balance, words }) {
      if (await saveAlertLine(db, hh, { assetId, date, amount, balance, words })) alertLines++;
    },
    async apply({ assetId, reading, messageId, source, receivedAt, replaceSameDay }) {
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
      const added = must(
        await db
          .from('observations')
          .insert({
            household_id: hh,
            asset_id: assetId,
            kind: 'balance',
            amount: reading.amount,
            currency: reading.currency,
            fx_rate: fx,
            as_of: reading.asOf,
            // when the email arrived, so two alerts of one day can be told apart
            received_at: receivedAt ?? new Date().toISOString(),
            source,
            source_ref: messageId.slice(0, 200),
            confidence: reading.source === 'rule' ? 'verified' : 'imported_unverified',
            note:
              reading.source === 'ai'
                ? 'Read from a statement by an AI service'
                : 'Read from a bank balance alert',
          })
          .select('id'),
        'record balance',
      );
      // a later alert of the same day: the earlier value of that day from an email stays in the history, marked as replaced
      if (replaceSameDay && added[0])
        must(
          await db
            .from('observations')
            .update({ superseded_by: added[0].id as string })
            .eq('asset_id', assetId)
            .eq('as_of', reading.asOf)
            .eq('source', 'email')
            .is('superseded_by', null)
            .neq('id', added[0].id as string),
          'replace the earlier value of the day',
        );
    },
    async casImport(m) {
      // shared with the Gmail statements scan (packages/data/src/cas.ts)
      const r = await importCasAttachments(db, hh, m, today);
      return { outcome: r.outcome, reason: r.reason };
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
          });
          if (res.ok) return { outcome: 'imported', reason: res.message };
          lastReason = res.message;
          if (!/does not match|password/i.test(res.message)) break;
        }
      }
      return { outcome: 'failed', reason: lastReason };
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
          receivedAt: (p.date ?? new Date()).toISOString(),
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

  // your own mailboxes that forward the banks' mail: the addresses listed in Settings and every household member's login address
  const members = must(
    await db.from('household_members').select('user_id').eq('household_id', hh),
    'members',
  );
  const inboxSettings = (await loadSettings(db, hh)).config.inbox;
  const trustedForwarders = new Set<string>(inboxSettings.trustedForwarders);
  for (const m of members) {
    const u = await db.auth.admin.getUserById(m.user_id as string);
    if (u.data.user?.email) trustedForwarders.add(u.data.user.email.toLowerCase());
  }
  // messages you pressed "Read again" on (they had no kept copy): read once more, even though they were seen before
  const again = new Set(
    must(
      await db
        .from('inbox_messages')
        .select('message_id')
        .eq('household_id', hh)
        .not('rescan_requested_at', 'is', null),
      'read-again requests',
    ).map((r) => r.message_id as string),
  );
  for (const m of messages) if (again.has(m.messageId)) m.reread = true;
  const report = await runInbox(messages, io, {
    today,
    ai,
    trustedForwarders: [...trustedForwarders],
    forwardUtcOffsetHours: inboxSettings.forwardUtcOffsetHours,
  });
  console.log(
    `Inbox: ${report.seen} messages (${report.skipped} already handled): applied ${report.applied}, to review ${report.needsReview}, ignored ${report.ignored}, errors ${report.errors}`,
  );
  for (const l of report.lines) console.log(' -', l);
  // lines from alerts are sorted at once by the rules, so the trail and the figures follow them today
  if (alertLines > 0) {
    const rb = await rebuildStatementMoves(db, hh);
    console.log(
      `Statement lines from bank alerts: ${alertLines}. Movements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}.`,
    );
  }
  if (report.errors > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('Inbox job failed:', (e as Error).message);
  process.exit(1);
});
