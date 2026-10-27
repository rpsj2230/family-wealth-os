/**
 * The bank-email inbox in plain words: which queue a message belongs to, and a sentence for what was found, why it was
 * not recorded by itself and what to do. The reader job (packages/ingest) writes terse reasons; this turns them into
 * sentences a person can act on.
 */
import { formatInr } from './money';
import { suggestion, type Proposal } from './suggestion';

export interface InboxReading {
  bank: string;
  last4: string | null;
  amount: number;
  currency: string;
  asOf: string;
  source: 'rule' | 'ai';
  /** the number was corrected by you after it was read */
  editedByYou?: boolean;
}

export interface InboxEntry {
  id: string;
  receivedOn: string | null;
  fromDomain: string | null;
  subject: string | null;
  outcome: 'applied' | 'needs_review' | 'ignored' | 'error';
  reason: string | null;
  reading: InboxReading | null;
  assetId: string | null;
  resolvedAt: string | null;
  /** a balance was recorded from this message after you chose an account */
  recordedByYou: boolean;
  /** the kept copy of the email text; null for a message logged before copies were kept */
  bodyText?: string | null;
}

/** review: waiting for you. recorded: a balance or statement was taken in. skipped: nothing to record. problem: the reader failed. dismissed: you ignored it. */
export type InboxQueue = 'review' | 'recorded' | 'skipped' | 'problem' | 'dismissed';

export function queueOf(m: InboxEntry): InboxQueue {
  if (m.outcome === 'applied') return 'recorded';
  if (m.outcome === 'ignored') return 'skipped';
  if (m.outcome === 'error') return 'problem';
  if (!m.resolvedAt) return 'review';
  return m.recordedByYou ? 'recorded' : 'dismissed';
}

/** Whether the AI can be asked to read this message again: anything that did not end in a recorded balance. */
export function canReadAgain(m: InboxEntry): boolean {
  return queueOf(m) !== 'recorded' || !m.reading;
}

export interface TextPart {
  text: string;
  /** this part is the number that was read */
  hit: boolean;
}

/**
 * Splits the email text so the number that was read can be shown marked, like a highlighter on the original. Every figure in the
 * text is compared by value, so "1,23,456.78", "123456.78" and "INR 123,456.78" are all found.
 */
export function markAmount(text: string, amount: number | null): TextPart[] {
  if (amount === null || !text) return [{ text, hit: false }];
  const parts: TextPart[] = [];
  const figure = /\d[\d,]*(?:\.\d+)?/g;
  let at = 0;
  for (const m of text.matchAll(figure)) {
    const raw = m[0].replace(/,+$/, '');
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value) || Math.abs(value - amount) > 0.005) continue;
    if (m.index > at) parts.push({ text: text.slice(at, m.index), hit: false });
    parts.push({ text: raw, hit: true });
    at = m.index + raw.length;
  }
  if (at < text.length) parts.push({ text: text.slice(at), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** Why a message that recorded nothing was set aside, for the filter chips on the Skipped tab. */
export type SkipGroup = 'notbalance' | 'older' | 'dismissed' | 'problem';

export function skipGroup(m: InboxEntry): SkipGroup | null {
  const q = queueOf(m);
  if (q === 'problem') return 'problem';
  if (q === 'dismissed') return 'dismissed';
  if (q === 'skipped') return m.reading ? 'older' : 'notbalance';
  return null;
}

const D = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
export const longDate = (iso: string) => D.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));

export function readingAmount(r: InboxReading): string {
  return r.currency === 'INR'
    ? formatInr(r.amount, { decimals: r.amount % 1 ? 2 : 0 })
    : `${r.currency} ${r.amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export interface Explained {
  /** "Balance ₹12,000 read from an email" */
  headline: string;
  /** why it is here, in one sentence */
  why: string;
  /** what the person can do */
  next: string;
}

/** Explains a message in a queue. Unknown reasons are shown as written rather than hidden. */
export function explainEntry(m: InboxEntry): Explained {
  const r = m.reading;
  const reason = (m.reason ?? '').trim();
  const q = queueOf(m);
  const found = r
    ? `Balance ${readingAmount(r)} as of ${longDate(r.asOf)}${r.last4 ? `, account ending ${r.last4}` : ''}, read from ${r.source === 'ai' ? 'a statement by the AI reader' : 'an email'}`
    : null;

  if (q === 'recorded') {
    if (r)
      return {
        headline: found ?? 'Balance recorded',
        why: r.editedByYou
          ? 'You corrected this number after it was read.'
          : m.recordedByYou
            ? 'You applied this reading.'
            : 'It came from the bank’s own address and matched exactly one account, so it was recorded by itself.',
        next: 'Nothing to do.',
      };
    return {
      headline: 'Statement imported',
      why: reason || 'The attached statement was read and its figures were stored.',
      next: 'Nothing to do.',
    };
  }

  if (q === 'dismissed')
    return {
      headline: found ?? 'Message ignored',
      why: 'You chose to ignore this message.',
      next: 'Put it back in the queue if you ignored it by mistake.',
    };

  if (q === 'skipped') {
    const older = /not newer than the value on record(?: \((\d{4}-\d{2}-\d{2})\))?/.exec(reason);
    if (older)
      return {
        headline: found ?? 'Balance already known',
        why: `You already have a value${older[1] ? ` dated ${longDate(older[1])}` : ''} that is the same age or newer, so this one was not added.`,
        next: 'Nothing to do.',
      };
    return {
      headline: 'Not a balance email',
      why: 'No balance or statement was found in it, so nothing was recorded.',
      next: 'Nothing to do. If this email does have a balance, press Read again and the AI will read just this one.',
    };
  }

  if (q === 'problem')
    return {
      headline: 'The reader could not process this message',
      why: reason || 'An unexpected error stopped it.',
      next: 'It will not be retried by itself. Record the balance in Monthly update, or forward the email again.',
    };

  // review
  if (/no single account matches/.test(reason))
    return {
      headline: found ?? 'Balance found',
      why: 'None of your accounts matches this bank and these last digits, so the app does not know where to record it.',
      next: 'Choose the account and apply, or ignore.',
    };
  if (/more than one account matches/.test(reason))
    return {
      headline: found ?? 'Balance found',
      why: 'More than one of your accounts fits this bank and these digits.',
      next: 'Choose the right account and apply, or ignore.',
    };
  if (/sender is not confirmed/.test(reason))
    return {
      headline: found ?? 'Balance found',
      why: `It did not come from the bank’s own address${m.fromDomain ? ` (it came from ${m.fromDomain})` : ''}, so it is not recorded without your say-so.`,
      next: 'Apply it if you trust the message, or ignore.',
    };
  if (/far from the current value/.test(reason))
    return {
      headline: found ?? 'Balance found',
      why: 'The amount is very different from the value you have now, which can mean a misread number.',
      next: 'Check it against your bank, then apply or ignore.',
    };
  if (/balance email in a format the rules do not know/.test(reason))
    return {
      headline: 'A balance email in an unfamiliar format',
      why: 'The fixed rules do not know this bank’s wording, and the AI reader that can read it has no key switched on.',
      next: 'Add an AI key, or switch one on, in Settings (Bank e-mails and AI), then use Read again; or record the balance in Monthly update and ignore this.',
    };
  if (/add an AI key/.test(reason))
    return {
      headline: 'A statement is attached but was not read',
      why: 'Reading a PDF statement needs the AI reader and no key is switched on.',
      next: 'Add a free key, or switch one on, in Settings (Bank e-mails and AI), or record the balance in Monthly update, then ignore this.',
    };
  if (/PDF could not be opened/.test(reason))
    return {
      headline: 'The attached PDF could not be opened',
      why: 'It is password-protected or damaged.',
      next: 'Record the balance in Monthly update, then ignore this.',
    };
  if (/statement attachment not found/.test(reason))
    return {
      headline: 'The statement file was missing',
      why: 'The email mentions a statement but the file was not attached.',
      next: 'Forward the email again with the file, or ignore.',
    };
  if (/no balance found|found no balance/.test(reason))
    return {
      headline: 'No balance could be read',
      why: 'The message was looked at but no balance was found in it.',
      next: 'Record the balance in Monthly update, then ignore this.',
    };
  if (!r)
    return {
      headline: 'A statement could not be finished',
      why: reason || 'The reader could not finish this one by itself.',
      next: 'I suggest you open the Import page and compare its figures with the statement, then ignore this message.',
    };
  return {
    headline: found ?? 'Balance found',
    why: reason || 'It is not safe to record without you.',
    next: 'Choose the account and apply, or ignore.',
  };
}

export interface AccountChoice {
  id: string;
  label: string;
  currency: string;
  last4: string | null;
  bank: string;
}

/** How well an account fits a reading: the one already matched (8), the same last four digits (4), the same bank (2). */
export function accountScore(
  r: InboxReading,
  matchedAssetId: string | null,
  a: AccountChoice,
): number {
  return (
    (a.id === matchedAssetId ? 8 : 0) +
    (r.last4 && a.last4 === r.last4 ? 4 : 0) +
    (a.bank && r.bank && a.bank.toLowerCase().includes(r.bank.toLowerCase().slice(0, 4)) ? 2 : 0)
  );
}

/**
 * The accounts a reading could belong to, best first: the one already matched, then the same currency with the same last
 * four digits, then the same bank, then the rest of that currency. Other currencies are never offered.
 */
export function rankAccounts(
  r: InboxReading,
  matchedAssetId: string | null,
  accounts: AccountChoice[],
): AccountChoice[] {
  const score = (a: AccountChoice) => accountScore(r, matchedAssetId, a);
  return accounts
    .filter((a) => a.currency === r.currency)
    .map((a, i) => ({ a, i, s: score(a) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .map((x) => x.a);
}

/** The account to preselect for one-click apply: only the one the reader itself matched. Anything else must be chosen. */
export function certainAccount(
  r: InboxReading,
  matchedAssetId: string | null,
  accounts: AccountChoice[],
): AccountChoice | null {
  if (!matchedAssetId) return null;
  return accounts.find((a) => a.id === matchedAssetId && a.currency === r.currency) ?? null;
}

export interface InboxProposal {
  proposal: Proposal;
  /** the account to record on when the person approves; null when nothing points to one account */
  accountId: string | null;
}

/**
 * What I suggest for a balance waiting for review: the account it most likely belongs to (the one the reader matched, else the only
 * account with the same last four digits, else the only one of that bank) and the amount, with the reason, one-click Approve, and the
 * other choices (another account, a corrected amount, ignore). With no clear account it says it cannot tell. Only for a message that
 * has a balance read from it.
 */
export function inboxProposal(m: InboxEntry, accounts: AccountChoice[]): InboxProposal | null {
  const r = m.reading;
  if (!r || queueOf(m) !== 'review') return null;
  const e = explainEntry(m);
  const ranked = rankAccounts(r, m.assetId, accounts);
  const sure = certainAccount(r, m.assetId, accounts);
  const score = (a: AccountChoice) => accountScore(r, m.assetId, a);
  let pick: AccountChoice | null = sure;
  let because = sure
    ? `The reader matched it to this account (${r.bank ? `${r.bank}, ` : ''}${r.last4 ? `last four digits ${r.last4}` : 'same currency'}).`
    : '';
  if (!pick && ranked.length > 0) {
    const top = ranked[0]!;
    const second = ranked[1];
    const withDigits = ranked.filter((a) => !!r.last4 && a.last4 === r.last4);
    const withBank = ranked.filter(
      (a) => score(a) >= 2 && !(r.last4 && a.last4 && a.last4 !== r.last4),
    );
    if (withDigits.length === 1) {
      pick = withDigits[0]!;
      because = `It is the only ${r.currency} account ending ${r.last4}${top.id === pick.id && score(pick) >= 6 ? ' at that bank' : ''}.`;
    } else if (
      withDigits.length === 0 &&
      withBank.length === 1 &&
      (!second || score(top) > score(second))
    ) {
      pick = withBank[0]!;
      because = `It is the only ${r.currency} account at ${r.bank || 'that bank'}${r.last4 ? `, and none ends ${r.last4}, so check the digits` : ''}.`;
    }
  }
  const amount = readingAmount(r);
  const when = longDate(r.asOf);
  const caution = /sender is not confirmed/.test(m.reason ?? '')
    ? ` It did not come from the bank’s own address${m.fromDomain ? ` (it came from ${m.fromDomain})` : ''}, so approve only if you trust the message.`
    : /far from the current value/.test(m.reason ?? '')
      ? ' The amount is very different from the value you have now: compare it with your bank, and correct it below if it was misread.'
      : '';
  const options = [
    ...ranked.slice(0, 4).map((a) => ({
      id: `record:${a.id}`,
      label: `Record it on ${a.label}`,
      action: `record ${amount} on ${a.label}`,
    })),
    { id: 'ignore', label: 'Ignore this message', action: 'ignore this message' },
  ];
  const proposal = suggestion({
    found: e.headline,
    suggest: pick ? `Record ${amount} on ${pick.label}, as of ${when}.` : null,
    why: pick
      ? `${because}${caution}`
      : ranked.length === 0
        ? `You have no account in ${r.currency}. Add one in the Monthly update first.`
        : `More than one account could be this one, or none fits the bank and digits well enough to say.`,
    recommended: pick ? `record:${pick.id}` : null,
    options,
  });
  return { proposal, accountId: pick?.id ?? null };
}
