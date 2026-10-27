/**
 * The Gmail statements scan: finds fund statements that CAMS, KFintech, NSDL, CDSL or MF Central e-mailed you anywhere in the mailbox
 * and imports them with the same rule-based importer as the label job. No AI is involved anywhere on this path: the scan has no AI
 * parameter at all, and a test keeps it that way.
 *
 * The mailbox sits behind `MailboxReader`, which can only search and read: there is no method to flag, label, move or delete a message,
 * so no code written against it can change the mailbox. The worker opens the mailbox read-only as well (workers/src/statements.ts).
 *
 * The rules (sender, size, PDF, forward) are in `statement-mail.ts`; what happens to a PDF (password, parser, the safe diff-based
 * write) is `importCasAttachments` in @fwos/data, passed in as `StatementIo.importPdf`.
 */
import type { InboxRow } from './inbox-run';
import {
  forwardedRegistrar,
  judgeHead,
  oldestFirst,
  searchPlan,
  type MailHead,
  type MailSearch,
} from './statement-mail';
import { emailExcerpt } from './email-excerpt';
import { senderDomain } from './bank-email';

/** A message once downloaded. */
export interface FullMessage {
  from: string;
  subject: string;
  text: string;
  date: Date;
  attachments: { filename: string; content: Uint8Array }[];
}

/** Read-only access to a mailbox. */
export interface MailboxReader {
  /** The ids of the messages the server finds for one search (From contains X, since a date). Nothing is downloaded. */
  search(q: MailSearch): Promise<number[]>;
  /** Envelope, size, structure and the sender-check header of these messages, without their bodies. */
  heads(uids: number[]): Promise<MailHead[]>;
  /** The whole message; null when it has vanished. */
  download(uid: number): Promise<FullMessage | null>;
}

export interface ImportedFromMail {
  outcome: 'imported' | 'partial' | 'failed';
  /** one line, never with a password or a PAN */
  reason: string;
  /** names of the people the statement belonged to */
  people: string[];
  funds: number;
  transactions: number;
}

export interface StatementIo {
  /** What is already recorded for this Message-ID, if anything. */
  seen(messageId: string): Promise<{ outcome: InboxRow['outcome'] } | null>;
  record(row: InboxRow): Promise<void>;
  importPdf(m: {
    messageId: string;
    receivedOn: string;
    attachments: { filename: string; content: Uint8Array }[];
  }): Promise<ImportedFromMail>;
}

export interface ScanConfig {
  senders: readonly string[];
  /** your own addresses (forwards from them are judged by the original sender) */
  ownAddresses: readonly string[];
  since: Date;
  maxBytes: number;
  /** at most this many statements are read in one scan */
  maxPerRun: number;
  /** read again the messages that could not be opened before (a person pressed Scan now, maybe after saving a password) */
  retryFailed: boolean;
}

export interface ScanItem {
  /** the day the e-mail was sent, YYYY-MM-DD */
  date: string;
  registrar: string;
  person: string | null;
  outcome: 'imported' | 'partial' | 'failed' | 'ignored';
  text: string;
}

export interface ScanReport {
  /** messages from allowed senders with a PDF that the server returned */
  considered: number;
  /** statements read in this scan (new ones, or failed ones tried again) */
  found: number;
  /** read and written (including those with something to check) */
  imported: number;
  /** already handled in an earlier scan */
  skipped: number;
  /** could not be read, were too large, or failed the sender check */
  problems: number;
  /** left for the next scan because of the limit per scan */
  waiting: number;
  items: ScanItem[];
  lines: string[];
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The sentence recorded for a statement that was read. */
export function describeRead(registrar: string, r: ImportedFromMail): string {
  if (r.outcome === 'failed')
    return /^Could not/.test(r.reason) ? r.reason : `Could not read: ${r.reason}`;
  const base = `Fund statement from ${registrar}: ${plural(r.funds, 'fund')}, ${
    r.transactions === 0 ? 'no new transactions' : `${plural(r.transactions, 'transaction')} added`
  }`;
  return r.outcome === 'partial' && r.reason ? `${base} (${r.reason})` : base;
}

/** Searches the mailbox, reads the new statements oldest first and records each. A failure on one message never stops the others. */
export async function runStatementScan(
  mail: MailboxReader,
  io: StatementIo,
  cfg: ScanConfig,
): Promise<ScanReport> {
  const report: ScanReport = {
    considered: 0,
    found: 0,
    imported: 0,
    skipped: 0,
    problems: 0,
    waiting: 0,
    items: [],
    lines: [],
  };

  // 1. the server does the filtering: one search per sender and per forwarding address, always limited by date
  const uids = new Set<number>();
  for (const q of searchPlan(cfg.senders, cfg.ownAddresses, cfg.since))
    for (const uid of await mail.search(q)) uids.add(uid);
  const heads = await mail.heads([...uids]);

  // 2. from the envelopes alone: which are candidates, which are to be noted, which are not statement mail at all
  const rules = { senders: cfg.senders, ownAddresses: cfg.ownAddresses, maxBytes: cfg.maxBytes };
  type Candidate = { head: MailHead; id: string; via: 'registrar' | 'forward'; registrar: string };
  const candidates: Candidate[] = [];
  for (const head of oldestFirst(heads)) {
    const d = judgeHead(head, rules);
    const id = head.messageId ?? `uid-${head.uid}@all-mail`;
    if (d.kind === 'ignore') {
      if (!d.record) continue;
      report.considered++;
      const seen = await io.seen(id);
      if (seen) {
        report.skipped++;
        continue;
      }
      await io.record({
        messageId: id,
        receivedOn: isoDay(head.date),
        fromDomain: senderDomain(head.from),
        subject: head.subject.slice(0, 300),
        outcome: 'ignored',
        reason: d.reason,
        reading: null,
        assetId: null,
        bodyText: '',
      });
      report.problems++;
      report.found++;
      report.items.push({
        date: isoDay(head.date),
        registrar: 'Unknown',
        person: null,
        outcome: 'ignored',
        text: d.reason,
      });
      report.lines.push(
        `ignored: ${senderDomain(head.from)} "${head.subject.slice(0, 80)}" (${d.reason})`,
      );
      continue;
    }
    report.considered++;
    candidates.push({ head, id, via: d.via, registrar: d.registrar });
  }

  // 3. skip what was handled before (a failed one is tried again when asked), then keep the oldest up to the limit
  const todo: Candidate[] = [];
  for (const c of candidates) {
    const seen = await io.seen(c.id);
    const again =
      !!seen && (seen.outcome === 'error' || (cfg.retryFailed && seen.outcome === 'needs_review'));
    if (seen && !again) {
      report.skipped++;
      continue;
    }
    todo.push(c);
  }
  report.waiting = Math.max(0, todo.length - cfg.maxPerRun);
  const batch = todo.slice(0, cfg.maxPerRun);

  // 4. read each one, oldest first, so a later statement overwrites an earlier one
  for (const c of batch) {
    const receivedOn = isoDay(c.head.date);
    const base = {
      messageId: c.id,
      receivedOn,
      fromDomain: senderDomain(c.head.from),
      subject: c.head.subject.slice(0, 300),
    };
    try {
      const msg = await mail.download(c.head.uid);
      if (!msg) {
        report.lines.push(`gone: ${c.id}`);
        continue;
      }
      let registrar = c.registrar;
      if (c.via === 'forward') {
        const fw = forwardedRegistrar(msg.subject, msg.text, cfg.senders);
        if (!fw) {
          await io.record({
            ...base,
            outcome: 'ignored',
            reason: 'A forwarded PDF, but the original sender is not an allowed one.',
            reading: null,
            assetId: null,
            bodyText: emailExcerpt(msg.text),
          });
          report.skipped++;
          continue;
        }
        registrar = fw.registrar;
      }
      const pdfs = msg.attachments.filter((a) => a.content.length <= cfg.maxBytes);
      if (pdfs.length === 0) {
        await io.record({
          ...base,
          outcome: 'ignored',
          reason: 'No PDF within the size limit was found in the message.',
          reading: null,
          assetId: null,
          bodyText: '',
        });
        report.skipped++;
        continue;
      }
      report.found++;
      const res = await io.importPdf({ messageId: c.id, receivedOn, attachments: pdfs });
      const text = describeRead(registrar, res);
      await io.record({
        ...base,
        bodyText: emailExcerpt(msg.text),
        outcome: res.outcome === 'imported' ? 'applied' : 'needs_review',
        reason: text.slice(0, 300),
        reading: null,
        assetId: null,
      });
      if (res.outcome === 'failed') report.problems++;
      else report.imported++;
      report.items.push({
        date: receivedOn,
        registrar,
        person: res.people.length ? res.people.join(', ') : null,
        outcome: res.outcome,
        text,
      });
      report.lines.push(`${res.outcome}: ${registrar} ${receivedOn} (${text})`);
    } catch (e) {
      report.problems++;
      const text = `Error: ${(e as Error).message}`.slice(0, 300);
      report.items.push({
        date: receivedOn,
        registrar: c.registrar,
        person: null,
        outcome: 'failed',
        text,
      });
      report.lines.push(`error: ${c.id}: ${text}`);
      try {
        await io.record({
          ...base,
          outcome: 'error',
          reason: text,
          reading: null,
          assetId: null,
          bodyText: '',
        });
      } catch {
        /* the log itself failed; the report still carries the line */
      }
    }
  }
  return report;
}

/** The one line shown after a scan: "2 statements found, 2 imported, 0 problems". */
export function scanLine(
  r: Pick<ScanReport, 'found' | 'imported' | 'problems' | 'waiting'>,
): string {
  const base = `${plural(r.found, 'statement')} found, ${r.imported} imported, ${plural(r.problems, 'problem')}`;
  return r.waiting > 0 ? `${base}, ${r.waiting} more waiting for the next scan` : base;
}
