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
import { alertMovement } from './alert-line';
import { answeredBy, callAi, type AiChain } from './ai-chain';
import type { AiPurpose } from './ai-usage';
import {
  aiJson,
  buildAiRequest,
  matchAccount,
  parseAiResponse,
  mentionsBalance,
  movementAlertAccount,
  bankForDomain,
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
  /** the recipients (To, Delivered-To, and the To line of a forwarded mail): whose mailbox it came to */
  to?: string;
  subject: string;
  text: string;
  receivedOn: string; // YYYY-MM-DD
  /** when the email arrived (ISO); for a forward, the original's time is read from the forward header instead */
  receivedAt?: string | null;
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
  latestObservation(assetId: string): Promise<{
    amount: number;
    asOf: string;
    source?: string | null;
    /** when the email or file behind it arrived (ISO), when known */
    receivedAt?: string | null;
  } | null>;
  alreadySeen(messageId: string): Promise<boolean>;
  record(row: InboxRow): Promise<void>;
  apply(args: {
    assetId: string;
    reading: BalanceReading;
    messageId: string;
    source: 'email' | 'statement';
    /** you asked for this reading, and a value you typed or imported has a later date: the reading replaces it and becomes the current balance */
    replaceNewer?: boolean;
    /** when the email arrived (ISO), kept with the value so two alerts of one day can be told apart */
    receivedAt?: string | null;
    /** a later alert of the same day: the earlier same-day value from an email stops counting (it stays in the history, as replaced) */
    replaceSameDay?: boolean;
  }): Promise<void>;
  /** Imports a fund statement (CAS) attached to the message; absent when this run cannot do it. */
  casImport?(
    m: InboxMessage,
  ): Promise<{ outcome: 'imported' | 'partial' | 'failed'; reason: string }>;
  /** Imports a Form 26AS or AIS attached to the message; absent when this run cannot do it. */
  taxImport?(m: InboxMessage): Promise<{ outcome: 'imported' | 'failed'; reason: string }>;
  /**
   * Imports a bank's account statement attached to the message, opened with the statement passwords saved per person, as lines of
   * the account it names; absent when this run cannot do it.
   */
  bankStatementImport?(
    m: InboxMessage,
  ): Promise<{ outcome: 'imported' | 'partial' | 'failed'; reason: string }>;
  /** Text of a PDF; throws if it is encrypted or unreadable. */
  pdfText(content: Uint8Array): Promise<string>;
  /** Saves the movement a bank alert reports as a statement line of the account; absent when this run does not keep lines. */
  addAlertLine?(line: {
    assetId: string;
    date: string;
    /** + in, − out */
    amount: number;
    /** the balance after it, from the same alert; null when the alert gives none */
    balance: number | null;
    words: string;
    messageId: string;
  }): Promise<void>;
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
    /** Settings: the time zone, in hours from UTC, that a forward header's Date line is written in */
    forwardUtcOffsetHours?: number;
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
  const readWithAi = async (
    ai: AiChain,
    text: string,
    domain: string,
    purpose: AiPurpose,
    youAsked = false,
  ) => {
    const res = await callAi(ai, {
      purpose,
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

  // oldest first, so of two alerts of one day the later one is applied last and is the balance that counts
  const own0 = (cfg.trustedForwarders ?? []).map((a) => a.toLowerCase());
  const timeOf = (m: InboxMessage): string | null => {
    const fw0 = own0.includes(senderAddress(m.from))
      ? unwrapForward(m.subject, m.text, cfg.forwardUtcOffsetHours ?? 0)
      : null;
    return (fw0?.found ? fw0.originalAt : null) ?? m.receivedAt ?? null;
  };
  const ordered = messages
    .map((m, i) => ({ m, i, at: timeOf(m) }))
    .sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.i - b.i);

  for (const { m, at } of ordered) {
    report.seen++;
    try {
      if (!m.reread && (await io.alreadySeen(m.messageId))) {
        report.skipped++;
        continue;
      }
      // a forward from one of your own mailboxes: judge the bank by the original sender inside it
      const fw = own0.includes(senderAddress(m.from))
        ? unwrapForward(m.subject, m.text, cfg.forwardUtcOffsetHours ?? 0)
        : null;
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

      // a movement alert that gives no balance (many UPI and card alerts): the movement still becomes a line of the account, by rule
      if (parsed.kind === 'unknown' && io.addAlertLine) {
        const mv = alertMovement(m.text);
        const at = mv
          ? movementAlertAccount({
              from,
              subject: m.subject,
              text: m.text,
              receivedOn: m.receivedOn,
            })
          : null;
        const match = at ? matchAccount(at, accounts) : null;
        if (mv && at && match?.status === 'matched' && match.autoApply) {
          await io.addAlertLine({
            assetId: match.assetId,
            date: at.asOf,
            amount: mv.amount,
            balance: null,
            words: mv.words,
            messageId: m.messageId,
          });
          await log({
            outcome: 'applied',
            reason: `money ${mv.amount < 0 ? 'out' : 'in'} saved as a line of the account (this alert gives no balance)`,
            reading: null,
            assetId: match.assetId,
          });
          continue;
        }
      }

      let readings: BalanceReading[] = [];
      let source: 'email' | 'statement' = 'email';
      let note: string | null = null;

      if (parsed.kind === 'balance') {
        readings = [parsed.reading];
      } else if (parsed.kind === 'statement' && io.bankStatementImport && bankForDomain(domain)) {
        // the bank's own statement: every line goes in (not only the balance), opened with the saved passwords, by rule
        const res = await io.bankStatementImport(m);
        if (res.outcome !== 'failed' || /password|No account ending/i.test(res.reason)) {
          await log({
            outcome: res.outcome === 'imported' ? 'applied' : 'needs_review',
            reason: res.reason.slice(0, 300) || 'bank statement imported',
            reading: null,
            assetId: null,
          });
          continue;
        }
        // not a statement of transactions the reader knows: read for its balance below, as before
        source = 'statement';
        const pdf = m.attachments.find((a) => a.filename === parsed.hint);
        if (!pdf || !chain) {
          await log({
            outcome: 'needs_review',
            reason: res.reason.slice(0, 300),
            reading: null,
            assetId: null,
          });
          continue;
        }
        try {
          readings = await readWithAi(
            chain,
            `${m.subject}\n${await io.pdfText(pdf.content)}`,
            domain,
            'inbox_statement',
          );
        } catch {
          readings = [];
        }
        if (readings.length === 0) note = res.reason || 'the AI found no balance in the statement';
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
        readings = await readWithAi(chain, `${m.subject}\n${text}`, domain, 'inbox_statement');
        if (readings.length === 0) note = 'the AI found no balance in the statement';
      } else if (!chain) {
        // every email under the label is shown, never dropped: with no AI to read an unknown format, it waits for you to type the number
        await log({
          outcome: 'needs_review',
          reason: m.reread
            ? 'add an AI key (or switch one on) in Settings to read this email'
            : 'no rule knows this format; type the balance in, or add an AI key (or switch one on) to read it',
          reading: null,
          assetId: null,
        });
        continue;
      } else {
        // a format the rules do not know (or one a bank changed): the AI reads it, and what it finds is still checked like any other
        // reading (sender, account, size)
        readings = await readWithAi(
          chain,
          `${m.subject}
${m.text}`,
          domain,
          'inbox_email',
          !!m.reread,
        );
        if (readings.length === 0) {
          await log({
            outcome: 'needs_review',
            reason: mentionsBalance(m.subject, m.text)
              ? 'neither the rules nor the AI found a balance; type it in if this email has one'
              : 'this email does not seem to carry a balance; type it in if it does, or ignore it',
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
        // the movement the alert reports becomes a statement line the day it arrives (a later statement takes its place): only from
        // the bank's own rule-read alert, matched to one account, never from an AI reading or a statement
        if (io.addAlertLine && r.source === 'rule' && match.autoApply && source === 'email') {
          const mv = alertMovement(m.text);
          if (mv)
            await io.addAlertLine({
              assetId: match.assetId,
              date: r.asOf,
              amount: mv.amount,
              balance: r.amount,
              words: mv.words,
              messageId: m.messageId,
            });
        }
        const latest = await io.latestObservation(match.assetId);
        // a value from the bank that is newer is never replaced; a value you typed or imported that is newer is replaced when you asked for this reading
        const newerFromBank = !!latest && BANK_SOURCES.has(latest.source ?? '');
        // two alerts of one day: the later email is the balance at the end of it. A value of that day that came from an email is
        // replaced by a later one; one you typed, imported or took from a statement is not.
        const sameDayLater =
          !!latest &&
          r.asOf === latest.asOf &&
          latest.source === 'email' &&
          !!at &&
          (!latest.receivedAt || at > latest.receivedAt);
        if (
          latest &&
          (m.reread
            ? r.asOf < latest.asOf && newerFromBank
            : r.asOf < latest.asOf || (r.asOf === latest.asOf && !sameDayLater))
        ) {
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
          receivedAt: at,
          ...(latest && r.asOf === latest.asOf && latest.source === 'email'
            ? { replaceSameDay: true }
            : {}),
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
