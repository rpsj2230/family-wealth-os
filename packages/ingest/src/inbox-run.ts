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
 *
 * The AI is a chain of keys (see `ai-chain`): when one fails the next is asked, and a key refused earlier in the run is not asked again.
 */
import { answeredBy, callAi, type AiChain } from './ai-chain';
import {
  aiJson,
  buildAiRequest,
  matchAccount,
  parseAiResponse,
  mentionsBalance,
  parseBankEmail,
  senderDomain,
  senderMatchesBank,
  type BalanceReading,
  type KnownAccount,
} from './bank-email';
import { looksLikeCas } from './cas';
import { emailExcerpt } from './email-excerpt';
import { senderAddress, unwrapForward } from './forwarded';
import { looksLikeTaxFile } from './taxfiles';

export interface InboxMessage {
  messageId: string;
  from: string;
  subject: string;
  text: string;
  receivedOn: string; // YYYY-MM-DD
  attachments: { filename: string; content: Uint8Array }[];
  /**
   * You asked for this one to be read again: it is read even if it was seen before, the AI looks at it whether or not it mentions a
   * balance, the sender is taken as the bank's, and a reading is applied at once (you can correct the number afterwards).
   */
  reread?: boolean;
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
  /** the kept copy of the email text (see email-excerpt.ts) */
  bodyText: string;
}

export interface InboxIo {
  accounts(): Promise<KnownAccount[]>;
  /** the value now on record: its amount, its date and where it came from (email, statement, workbook, manual, ...) */
  latestObservation(
    assetId: string,
  ): Promise<{ amount: number; asOf: string; source?: string | null } | null>;
  alreadySeen(messageId: string): Promise<boolean>;
  record(row: InboxRow): Promise<void>;
  apply(args: {
    assetId: string;
    reading: BalanceReading;
    messageId: string;
    source: 'email' | 'statement';
    /** you asked for this reading, and a value you typed or imported has a later date: the reading replaces it and becomes the current balance */
    replaceNewer?: boolean;
  }): Promise<void>;
  /** Imports a fund statement (CAS) attached to the message; absent when this run cannot do it. */
  casImport?(
    m: InboxMessage,
  ): Promise<{ outcome: 'imported' | 'partial' | 'failed'; reason: string }>;
  /** Imports a Form 26AS or AIS attached to the message; absent when this run cannot do it. */
  taxImport?(m: InboxMessage): Promise<{ outcome: 'imported' | 'failed'; reason: string }>;
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

/** Where a value came from when the bank itself said it: such a value is only replaced by a newer one from the bank. */
const BANK_SOURCES = new Set(['email', 'statement', 'cas', 'api']);

export async function runInbox(
  messages: InboxMessage[],
  io: InboxIo,
  cfg: {
    today: string;
    ai: AiChain | null;
    /**
     * Your own mailboxes (the ones that forward the bank's mail to the app): a message from one of them is a forward, and the bank is
     * recognised by the original sender written inside it. A message from any other address is judged by its own sender.
     */
    trustedForwarders?: string[];
  },
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
  const chain = cfg.ai && !cfg.ai.empty ? cfg.ai : null;
  /** The AI's readings of one message's text; throws with every key's reason when none could answer. */
  const readWithAi = async (ai: AiChain, text: string, domain: string, youAsked = false) => {
    const res = await callAi(ai, {
      build: (provider, key, model) => buildAiRequest(provider, key, text, model),
      parse: (provider, json) =>
        aiJson(provider, json) === null
          ? null
          : parseAiResponse(provider, json, { today: cfg.today }),
    });
    if (!res.ok) throw new Error(`AI service: ${res.brief}`);
    report.lines.push(`ai: ${answeredBy(res)}`);
    // an email you asked to be read again is taken as the bank's own
    return res.value.map((r) => ({
      ...r,
      senderVerified: youAsked || senderMatchesBank(domain, r.bank),
    }));
  };

  for (const m of messages) {
    report.seen++;
    try {
      if (!m.reread && (await io.alreadySeen(m.messageId))) {
        report.skipped++;
        continue;
      }
      // a forward from one of your own mailboxes: judge the bank by the original sender inside it
      const own = (cfg.trustedForwarders ?? []).map((a) => a.toLowerCase());
      const fw = own.includes(senderAddress(m.from)) ? unwrapForward(m.subject, m.text) : null;
      const from = fw?.found && fw.originalFrom ? fw.originalFrom : m.from;
      const domain = senderDomain(from);
      const base = {
        messageId: m.messageId,
        receivedOn: m.receivedOn,
        fromDomain: domain,
        subject: m.subject.slice(0, 300),
        bodyText: emailExcerpt(m.text),
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

      if (io.taxImport && looksLikeTaxFile(m)) {
        const res = await io.taxImport(m);
        await log({
          outcome: res.outcome === 'imported' ? 'applied' : 'needs_review',
          reason: res.reason.slice(0, 300) || null,
          reading: null,
          assetId: null,
        });
        continue;
      }

      const parsed = parseBankEmail({
        from,
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
        if (!chain) {
          await log({
            outcome: 'needs_review',
            reason: 'statement found; add an AI key in Settings, or switch one on, to read it',
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
        readings = await readWithAi(chain, `${m.subject}\n${text}`, domain);
        if (readings.length === 0) note = 'the AI found no balance in the statement';
      } else if (!m.reread && !mentionsBalance(m.subject, m.text)) {
        await log({ outcome: 'ignored', reason: null, reading: null, assetId: null });
        continue;
      } else if (!chain) {
        // it looks like a balance alert in a format the rules do not know: say so instead of calling it "not a balance email"
        await log({
          outcome: 'needs_review',
          reason: m.reread
            ? 'add an AI key (or switch one on) in Settings to read this email'
            : 'balance email in a format the rules do not know; add an AI key (or switch one on) to read it',
          reading: null,
          assetId: null,
        });
        continue;
      } else {
        // an unfamiliar format: the AI reads it, and what it finds is still checked like any other reading (sender, account, size)
        readings = await readWithAi(
          chain,
          `${m.subject}
${m.text}`,
          domain,
          !!m.reread,
        );
        if (readings.length === 0) {
          await log({
            outcome: 'ignored',
            reason: 'the AI found no balance in this email',
            reading: null,
            assetId: null,
          });
          continue;
        }
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
        // a value from the bank that is newer is never replaced; a value you typed or imported that is newer is replaced when you asked for this reading
        const newerFromBank = !!latest && BANK_SOURCES.has(latest.source ?? '');
        if (latest && (m.reread ? r.asOf < latest.asOf && newerFromBank : r.asOf <= latest.asOf)) {
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
        if (!m.reread && r.source === 'ai' && latest && latest.amount > 0) {
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
        await io.apply({
          assetId: match.assetId,
          reading: r,
          messageId: m.messageId,
          source,
          ...(m.reread && latest && r.asOf < latest.asOf ? { replaceNewer: true } : {}),
        });
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
          bodyText: emailExcerpt(m.text),
        });
      } catch {
        /* the log itself failed; the report above still carries the line */
      }
    }
  }
  return report;
}
