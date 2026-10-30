/* eslint-disable no-console */
/**
 * Fund statements from Gmail. Searches the WHOLE mailbox (Gmail's "All Mail", not one label) for messages from the registrars'
 * addresses listed in Settings, reads the PDF statements among them and imports them with the rule-based importer. No AI is used and
 * no AI key is read: this file does not import the AI code at all (a test checks that).
 *
 * Read-only on the mailbox: it is opened with EXAMINE (imapflow `readOnly`), messages are fetched with BODY.PEEK, and only the
 * methods search, fetch and list are called on the connection: nothing that flags, labels, moves, copies, appends or deletes (a test
 * checks the source for those). Only the messages the server finds for "From contains <allowed sender> since <date>" are listed, and
 * only those that pass the checks on their envelope are downloaded.
 *
 * Runs in GitHub Actions (.github/workflows/statements.yml) with the same Gmail app password as the other mail jobs. The rules are in
 * packages/ingest/src/statement-mail.ts and statement-scan.ts and are tested there with a pretend mailbox.
 */
import { ImapFlow, type MessageStructureObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import {
  importBankStatementMail,
  importCasAttachments,
  loadSettings,
  rebuildStatementMoves,
} from '@fwos/data';
import {
  lookBackDays,
  maskAddress,
  requestSentence,
  requestState,
  REGISTRAR_LABEL,
  runStatementScan,
  scanLine,
  sinceDate,
  type FullMessage,
  type MailboxReader,
  type MailHead,
  type RequestRegistrar,
  type StatementIo,
} from '@fwos/ingest';
import { connectDb, householdId, must, need, ownAddresses } from './shared';

const db = connectDb();
const today = new Date().toISOString().slice(0, 10);

/** Does the message structure contain a PDF attachment? Only the structure is looked at: nothing is downloaded. */
function hasPdf(node: MessageStructureObject | undefined): boolean {
  if (!node) return false;
  const name = String(node.dispositionParameters?.filename ?? node.parameters?.name ?? '');
  if (node.type === 'application/pdf' || /\.pdf$/i.test(name)) return true;
  return (node.childNodes ?? []).some(hasPdf);
}

/** Gmail's "All Mail", found by its role (its name depends on the account's language), with the English name as a fallback. */
async function allMailPath(client: ImapFlow): Promise<string> {
  const boxes = await client.list();
  return boxes.find((b) => b.specialUse === '\\All')?.path ?? '[Gmail]/All Mail';
}

/** The mailbox as the scan sees it: search, headers, download. Nothing else exists on this object. */
function readerOver(client: ImapFlow): MailboxReader {
  return {
    async search(q) {
      const found = await client.search({ from: q.from, since: q.since }, { uid: true });
      return found || [];
    },
    async heads(uids) {
      const out: MailHead[] = [];
      for (let i = 0; i < uids.length; i += 200) {
        const range = uids.slice(i, i + 200).join(',');
        for await (const m of client.fetch(
          range,
          {
            uid: true,
            envelope: true,
            bodyStructure: true,
            size: true,
            headers: ['authentication-results'],
          },
          { uid: true },
        )) {
          const from = m.envelope?.from?.[0];
          out.push({
            uid: m.uid,
            messageId: m.envelope?.messageId ?? null,
            from: from ? `${from.name ?? ''} <${from.address ?? ''}>` : '',
            subject: m.envelope?.subject ?? '',
            date: m.envelope?.date ? new Date(m.envelope.date) : new Date(0),
            size: m.size ?? 0,
            hasPdf: hasPdf(m.bodyStructure),
            authResults: m.headers ? m.headers.toString('utf8').trim() || null : null,
          });
        }
      }
      return out;
    },
    async download(uid): Promise<FullMessage | null> {
      const m = await client.fetchOne(String(uid), { source: true }, { uid: true });
      if (!m || !m.source) return null;
      const p = await simpleParser(m.source);
      return {
        from: p.from?.text ?? '',
        subject: p.subject ?? '',
        text: p.text ?? '',
        date: p.date ?? new Date(),
        attachments: p.attachments
          .filter((a) => /\.pdf$/i.test(a.filename ?? '') || a.contentType === 'application/pdf')
          .map((a) => ({
            filename: a.filename ?? 'attachment.pdf',
            content: new Uint8Array(a.content),
          })),
      };
    },
  };
}

/** A request for a full statement that has waited longer than the Settings number of days leaves one task, once. */
async function remindLateRequests(hh: string, waitDays: number) {
  const reqs = must(
    await db
      .from('statement_requests')
      .select('id, owner_id, registrar, requested_on, status, task_id')
      .eq('household_id', hh)
      .eq('status', 'asked')
      .is('task_id', null),
    'requests',
  ) as {
    id: string;
    owner_id: string;
    registrar: RequestRegistrar;
    requested_on: string;
    status: 'asked';
  }[];
  if (reqs.length === 0) return;
  const names = new Map(
    (
      must(await db.from('owners').select('id, display_name').eq('household_id', hh), 'people') as {
        id: string;
        display_name: string;
      }[]
    ).map((o) => [o.id, o.display_name]),
  );
  for (const r of reqs) {
    if (requestState({ status: r.status, requestedOn: r.requested_on }, today, waitDays) !== 'late')
      continue;
    const who = names.get(r.owner_id) ?? 'a family member';
    const task = must(
      await db
        .from('tasks')
        .insert({
          household_id: hh,
          title:
            `The fund statement requested from ${REGISTRAR_LABEL[r.registrar]} for ${who} on ${r.requested_on} has not arrived: check the e-mail address given, the spam folder, or ask again (Import > Fund statement)`.slice(
              0,
              300,
            ),
          due_on: today,
        })
        .select('id')
        .single(),
      'reminder task',
    ) as { id: string };
    must(
      await db.from('statement_requests').update({ task_id: task.id }).eq('id', r.id).select('id'),
      'request',
    );
    console.log(`Reminder task left for a request from ${REGISTRAR_LABEL[r.registrar]}.`);
  }
}

async function main() {
  const hh = await householdId(db);
  const cfg = (await loadSettings(db, hh)).config;
  const sm = cfg.statementMail;
  await remindLateRequests(hh, sm.requestWaitDays);

  const pending = must(
    await db
      .from('statement_scans')
      .select('id')
      .eq('household_id', hh)
      .not('requested_at', 'is', null)
      .is('started_at', null)
      .limit(1),
    'scan requests',
  ) as { id: string }[];
  const request = pending[0] ?? null;
  const finish = async (id: string, patch: Record<string, unknown>) =>
    must(
      await db
        .from('statement_scans')
        .update({ finished_at: new Date().toISOString(), ...patch })
        .eq('id', id)
        .select('id'),
      'finish scan',
    );

  if (!sm.enabled) {
    console.log('Gmail statements are switched off in Settings; the mailbox is not touched.');
    if (request)
      await finish(request.id, {
        started_at: new Date().toISOString(),
        ok: false,
        note: 'Gmail statements are switched off in Settings (Gmail statements card), so nothing was read.',
      });
    return;
  }

  const last = must(
    await db
      .from('statement_scans')
      .select('finished_at, ok')
      .eq('household_id', hh)
      .not('finished_at', 'is', null)
      .order('finished_at', { ascending: false })
      .limit(20),
    'earlier scans',
  ) as { finished_at: string; ok: boolean | null }[];
  const lastOk = last.find((s) => s.ok === true) ?? null;
  const forced = process.env.STATEMENTS_FORCE === '1';
  if (!request && !forced && last[0]) {
    const hours = (Date.now() - Date.parse(last[0].finished_at)) / 3_600_000;
    if (hours < sm.minGapHours) {
      console.log(
        `Last scan finished ${hours.toFixed(1)} hours ago (Settings: not more often than every ${sm.minGapHours}). Nothing to do.`,
      );
      return;
    }
  }

  // the first scan, or one after a long gap, looks far back; the regular ones a short way
  const daysSinceOk = lastOk
    ? (Date.now() - Date.parse(lastOk.finished_at)) / 86_400_000
    : Infinity;
  const days = lookBackDays(!lastOk || daysSinceOk > sm.regularDays, sm);
  const since = sinceDate(new Date(), days);
  const startedAt = new Date().toISOString();
  // only a masked form of the address is kept, so the app can say which mailbox it reads
  const mailbox = maskAddress(need('SMTP_USER'));
  const trigger = request ? 'requested' : forced ? 'manual' : 'schedule';
  let scanId: string;
  if (request) {
    scanId = request.id;
    must(
      await db
        .from('statement_scans')
        .update({ started_at: startedAt, look_back_days: days, mailbox })
        .eq('id', scanId)
        .select('id'),
      'start scan',
    );
  } else {
    scanId = (
      must(
        await db
          .from('statement_scans')
          .insert({
            household_id: hh,
            trigger,
            started_at: startedAt,
            look_back_days: days,
            mailbox,
          })
          .select('id')
          .single(),
        'start scan',
      ) as { id: string }
    ).id;
  }

  const names = new Map(
    (
      must(await db.from('owners').select('id, display_name').eq('household_id', hh), 'people') as {
        id: string;
        display_name: string;
      }[]
    ).map((o) => [o.id, o.display_name]),
  );
  const io: StatementIo = {
    async seen(messageId) {
      const r = must(
        await db
          .from('inbox_messages')
          .select('outcome')
          .eq('household_id', hh)
          .eq('message_id', messageId)
          .limit(1),
        'seen check',
      ) as { outcome: 'applied' | 'needs_review' | 'ignored' | 'error' }[];
      return r[0] ? { outcome: r[0].outcome } : null;
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
    async importPdf(m) {
      const r = await importCasAttachments(db, hh, m, today);
      return {
        outcome: r.outcome,
        reason: r.reason,
        people: r.ownerIds.map((id) => names.get(id) ?? 'someone'),
        funds: r.funds,
        transactions: r.transactions,
      };
    },
  };

  // the banks' statements, under their own key so a message the alert reader saw is still read here
  let bankLines = 0;
  const bankKey = (id: string) => `bank-statement:${id}`;
  const bankIo: StatementIo = {
    // one that waits for a password or an account's last four digits is tried again on every scan, so it goes in by itself once
    // they are saved
    async seen(id) {
      const r = must(
        await db
          .from('inbox_messages')
          .select('outcome, reason')
          .eq('household_id', hh)
          .eq('message_id', bankKey(id))
          .limit(1),
        'seen check',
      ) as { outcome: 'applied' | 'needs_review' | 'ignored' | 'error'; reason: string | null }[];
      if (!r[0]) return null;
      if (
        r[0].outcome === 'needs_review' &&
        /saved passwords|No account ending/i.test(r[0].reason ?? '')
      )
        return null;
      return { outcome: r[0].outcome };
    },
    record: (row) => io.record({ ...row, messageId: bankKey(row.messageId) }),
    async importPdf(m) {
      const r = await importBankStatementMail(db, hh, m);
      bankLines += r.lines;
      return {
        outcome: r.outcome,
        reason: r.reason,
        people: r.ownerIds.map((id) => names.get(id) ?? 'someone'),
        funds: r.accounts,
        transactions: r.lines,
      };
    },
  };

  const own = await ownAddresses(db, hh, cfg.inbox.trustedForwarders);
  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: need('SMTP_USER'), pass: need('SMTP_APP_PASSWORD') },
    logger: false,
  });
  try {
    await client.connect();
    let report;
    let bankReport: Awaited<ReturnType<typeof runStatementScan>> | null = null;
    try {
      const path = await allMailPath(client);
      // EXAMINE, not SELECT: the server itself refuses any change to this mailbox for as long as it is open
      const lock = await client.getMailboxLock(path, { readOnly: true });
      try {
        report = await runStatementScan(readerOver(client), io, {
          senders: sm.senders,
          ownAddresses: own,
          since,
          maxBytes: Math.round(sm.maxMb * 1_048_576),
          maxPerRun: sm.maxPerRun,
          retryFailed: trigger === 'requested' || trigger === 'manual',
        });
        if (sm.banksEnabled && sm.bankSenders.length > 0)
          bankReport = await runStatementScan(readerOver(client), bankIo, {
            senders: sm.bankSenders,
            ownAddresses: own,
            since,
            maxBytes: Math.round(sm.maxMb * 1_048_576),
            maxPerRun: sm.maxPerRun,
            retryFailed: trigger === 'requested' || trigger === 'manual',
            kind: 'bank',
          });
      } finally {
        lock.release();
      }
    } finally {
      await client.logout();
    }
    console.log(
      `Gmail statements (${trigger}, looked back ${days} days): ${scanLine(report)}; ${report.skipped} already handled.`,
    );
    for (const l of report.lines) console.log(' -', l);
    if (bankReport) {
      console.log(
        `Bank statements: ${scanLine(bankReport)}; ${bankReport.skipped} already handled; ${bankLines} new lines.`,
      );
      for (const l of bankReport.lines) console.log(' -', l);
    }
    // the new lines are sorted by the rules at once, so the trail and the figures follow them today
    if (bankLines > 0) {
      const rb = await rebuildStatementMoves(db, hh);
      console.log(
        `Movements from statements: ${rb.added} added, ${rb.removed} replaced. Lines to answer: ${rb.toAnswer}.`,
      );
    }
    await finish(scanId, {
      ok: true,
      found: report.found,
      imported: report.imported,
      skipped: report.skipped,
      problems: report.problems,
      note: `${scanLine(report)}${bankReport ? `; bank statements: ${scanLine(bankReport)}` : ''}`.slice(
        0,
        500,
      ),
      detail: [...report.items, ...(bankReport?.items ?? [])].slice(0, 60),
    });
  } catch (e) {
    const msg = (e as Error).message.slice(0, 400);
    await finish(scanId, { ok: false, note: `The scan stopped: ${msg}` }).catch(() => undefined);
    throw e;
  }
  // a plain sentence about the open requests, for the log
  const open = must(
    await db
      .from('statement_requests')
      .select('owner_id, registrar, requested_on, status')
      .eq('household_id', hh)
      .eq('status', 'asked'),
    'requests',
  ) as { owner_id: string; registrar: RequestRegistrar; requested_on: string; status: 'asked' }[];
  for (const r of open)
    console.log(
      requestSentence(
        {
          owner: names.get(r.owner_id) ?? 'someone',
          registrar: r.registrar,
          requestedOn: r.requested_on,
        },
        requestState({ status: r.status, requestedOn: r.requested_on }, today, sm.requestWaitDays),
        sm.requestWaitDays,
        (d) => d,
      ),
    );
}

main().catch((e) => {
  console.error('Gmail statements job failed:', (e as Error).message);
  process.exit(1);
});
