/**
 * Processes forwarded bank emails into balance readings. All side effects go through `InboxIo`, so the rules are
 * tested without a mailbox, a database or an AI service.
 *
 * What is applied automatically (and recorded as a new observation):
 *   - the sender domain belongs to the bank named in the reading,
 *   - exactly one of your accounts matches that bank, currency and last four digits,
 *   - the reading is newer than the value on record,
 *   - an AI-read amount is within a plausible range of the current value (0.1x to 10x).
 * Everything else is logged for review with the reason. A failure on one message never stops the others.
 */
import {
  buildAiRequest,
  matchAccount,
  parseAiResponse,
  parseBankEmail,
  senderDomain,
  senderMatchesBank,
  type AiProvider,
  type BalanceReading,
  type KnownAccount,
} from './bank-email';
import { looksLikeCas } from './cas';

export interface InboxMessage {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  receivedOn: string; // YYYY-MM-DD
  attachments: { filename: string; content: Uint8Array }[];
}

export interface InboxRow {
  messageId: string;
  receivedOn: string;
  fromDomain: string;
  subject: string;
  outcome: 'applied' | 'needs_review' | 'ignored' | 'error';
  reason: string | null;
  reading: BalanceReading | null;
  assetId: string | null;
}

export interface InboxIo {
  accounts(): Promise<KnownAccount[]>;
  latestObservation(assetId: string): Promise<{ amount: number; asOf: string } | null>;
  alreadySeen(messageId: string): Promise<boolean>;
  record(row: InboxRow): Promise<void>;
  apply(args: {
    assetId: string;
    reading: BalanceReading;
    messageId: string;
    source: 'email' | 'statement';
  }): Promise<void>;
  fetchJson(
    url: string,
    init: { method: 'POST'; headers: Record<string, string>; body: string },
  ): Promise<unknown>;
  /** Imports a fund statement (CAS) attached to the message; absent when this run cannot do it. */
  casImport?(
    m: InboxMessage,
  ): Promise<{ outcome: 'imported' | 'partial' | 'failed'; reason: string }>;
  /** Text of a PDF; throws if it is encrypted or unreadable. */
  pdfText(content: Uint8Array): Promise<string>;
}

export interface InboxReport {
  seen: number;
  skipped: number;
  applied: number;
  needsReview: number;
  ignored: number;
  errors: number;
  lines: string[];
}

export async function runInbox(
  messages: InboxMessage[],
  io: InboxIo,
  cfg: { today: string; ai: { provider: AiProvider; key: string } | null },
): Promise<InboxReport> {
  const report: InboxReport = {
    seen: 0,
    skipped: 0,
    applied: 0,
    needsReview: 0,
    ignored: 0,
    errors: 0,
    lines: [],
  };
  const accounts = await io.accounts();

  for (const m of messages) {
    report.seen++;
    try {
      if (await io.alreadySeen(m.messageId)) {
        report.skipped++;
        continue;
      }
      const domain = senderDomain(m.from);
      const base = {
        messageId: m.messageId,
        receivedOn: m.receivedOn,
        fromDomain: domain,
        subject: m.subject.slice(0, 300),
      };
      const log = async (row: Omit<InboxRow, keyof typeof base>) => {
        await io.record({ ...base, ...row });
        if (row.outcome === 'applied') report.applied++;
        else if (row.outcome === 'needs_review') report.needsReview++;
        else if (row.outcome === 'ignored') report.ignored++;
        else report.errors++;
        report.lines.push(
          `${row.outcome}: ${domain} "${base.subject}"${row.reason ? ` (${row.reason})` : ''}`,
        );
      };

      if (io.casImport && m.attachments.length > 0 && looksLikeCas(m)) {
        const res = await io.casImport(m);
        await log({
          outcome: res.outcome === 'imported' ? 'applied' : 'needs_review',
          reason: res.reason.slice(0, 300) || null,
          reading: null,
          assetId: null,
        });
        continue;
      }

      const parsed = parseBankEmail({
        from: m.from,
        subject: m.subject,
        text: m.text,
        attachments: m.attachments.map((a) => a.filename),
        receivedOn: m.receivedOn,
      });

      let readings: BalanceReading[] = [];
      let source: 'email' | 'statement' = 'email';
      let note: string | null = null;

      if (parsed.kind === 'balance') {
        readings = [parsed.reading];
      } else if (parsed.kind === 'statement') {
        source = 'statement';
        const pdf = m.attachments.find((a) => a.filename === parsed.hint);
        if (!pdf) {
          await log({
            outcome: 'needs_review',
            reason: 'statement attachment not found',
            reading: null,
            assetId: null,
          });
          continue;
        }
        if (!cfg.ai) {
          await log({
            outcome: 'needs_review',
            reason: 'statement found; add an AI key in Settings to read it',
            reading: null,
            assetId: null,
          });
          continue;
        }
        let text: string;
        try {
          text = await io.pdfText(pdf.content);
        } catch (e) {
          await log({
            outcome: 'needs_review',
            reason: `PDF could not be opened (${(e as Error).message}); it may be password-protected`,
            reading: null,
            assetId: null,
          });
          continue;
        }
        const req = buildAiRequest(cfg.ai.provider, cfg.ai.key, `${m.subject}\n${text}`);
        const json = await io.fetchJson(req.url, req.init);
        readings = parseAiResponse(cfg.ai.provider, json, { today: cfg.today }).map((r) => ({
          ...r,
          senderVerified: senderMatchesBank(domain, r.bank),
        }));
        if (readings.length === 0) note = 'the AI found no balance in the statement';
      } else {
        await log({ outcome: 'ignored', reason: null, reading: null, assetId: null });
        continue;
      }

      if (readings.length === 0) {
        await log({
          outcome: 'needs_review',
          reason: note ?? 'no balance found',
          reading: null,
          assetId: null,
        });
        continue;
      }

      for (const r of readings) {
        const match = matchAccount(r, accounts);
        if (match.status === 'none') {
          await log({
            outcome: 'needs_review',
            reason: 'no single account matches this bank and last four digits',
            reading: r,
            assetId: null,
          });
          continue;
        }
        if (match.status === 'ambiguous') {
          await log({
            outcome: 'needs_review',
            reason: 'more than one account matches',
            reading: r,
            assetId: null,
          });
          continue;
        }
        const latest = await io.latestObservation(match.assetId);
        if (latest && r.asOf <= latest.asOf) {
          await log({
            outcome: 'ignored',
            reason: `not newer than the value on record (${latest.asOf})`,
            reading: r,
            assetId: match.assetId,
          });
          continue;
        }
        if (!match.autoApply) {
          await log({
            outcome: 'needs_review',
            reason: 'sender is not confirmed as the bank',
            reading: r,
            assetId: match.assetId,
          });
          continue;
        }
        if (r.source === 'ai' && latest && latest.amount > 0) {
          const ratio = r.amount / latest.amount;
          if (ratio < 0.1 || ratio > 10) {
            await log({
              outcome: 'needs_review',
              reason: 'amount is far from the current value; please confirm',
              reading: r,
              assetId: match.assetId,
            });
            continue;
          }
        }
        await io.apply({ assetId: match.assetId, reading: r, messageId: m.messageId, source });
        await log({ outcome: 'applied', reason: null, reading: r, assetId: match.assetId });
      }
    } catch (e) {
      report.errors++;
      report.lines.push(`error: ${m.messageId}: ${(e as Error).message}`);
      try {
        await io.record({
          messageId: m.messageId,
          receivedOn: m.receivedOn,
          fromDomain: senderDomain(m.from),
          subject: m.subject.slice(0, 300),
          outcome: 'error',
          reason: (e as Error).message.slice(0, 400),
          reading: null,
          assetId: null,
        });
      } catch {
        /* the log itself failed; the report above still carries the line */
      }
    }
  }
  return report;
}
