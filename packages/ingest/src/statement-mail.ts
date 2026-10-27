/**
 * Fund statements from Gmail: the rules for deciding which messages in a whole mailbox may be statements. Pure: no mailbox, no database,
 * no AI. The scan that uses these rules is in `statement-scan.ts`; the IMAP connection is in `workers/src/statements.ts`.
 *
 * Who sends the statements (looked up on 27 Oct 2026; the list is a Setting, `statementMail.senders`, and can be edited):
 *   - CAMS            donotreply@camsonline.com            domain camsonline.com. Seen in a real mailbox the same day: display name
 *                                                           "CAMS Mailback Server", subject "Consolidated Account Statement - CAMS
 *                                                           Mailback Request", a PDF attached, sent straight to the investor; the body
 *                                                           is headed "CONSOLIDATED ACCOUNT STATEMENT - CAMS + KFintech" (a combined
 *                                                           statement, which may also list holdings kept in demat form).
 *   - KFintech        samfS@kfintech.com                   domain kfintech.com (the company was Karvy; karvy.com is kept for old mail)
 *   - NSDL e-CAS      NSDL-CAS@nsdl.co.in                  domains nsdl.co.in and nsdl.com (NSDL's own pages use both: its CAS
 *                                                           complaints address is nsdl-cascomplaints@nsdl.co.in on the FAQ page and
 *                                                           @nsdl.com on the e-CAS portal, https://nsdlcas.nsdl.com)
 *   - CDSL e-CAS      eCAS@cdslstatement.com               domain cdslstatement.com (CDSL's website is cdslindia.com, so that is listed too)
 *   - MF Central      no sender address could be found; mfcentral.com is listed because the service is run by CAMS and KFintech
 * Evidence: the CAMS sender and subject above from the user's own mailbox; for the others the sender table in
 * https://casparser.in/blog/import-nri-portfolio-without-otp/ (a third-party guide, the one place found that names all four addresses)
 * and NSDL's FAQ https://investor.nsdl.com/portal/en/kb/articles/faqs-on-cas-26-10-2023 for the NSDL domains. Neither NSDL's nor CDSL's
 * own FAQ names the sender of the e-mail, so those entries are a starting point: a real statement e-mail from another address is not
 * read. Add the domain in Settings once you have seen it in your Gmail.
 *
 * What makes a message safe to read, in this order:
 *   1. the address in the From line (never the display name) belongs to an allowed domain or is an allowed address; a look-alike such
 *      as camsonline.com.evil.example or evilcamsonline.com is not the domain;
 *   2. Gmail's own verdict, when the message carries it, is not "fail" (Authentication-Results: dmarc=fail);
 *   3. it has a PDF within the size limit; the subject is NOT required to match anything (CAMS' wording may change);
 *   4. the PDF opens with a PAN or a statement password saved in Settings and the statement parser recognises it as a fund statement
 *      (checked by the importer before anything is written).
 * A forwarded copy from one of your own addresses (Settings > Bank e-mail forwarding, and the household's login addresses) is judged by
 * the original sender written inside the forward, like the bank-email reader does (forwarded.ts).
 */
import { cleanSender } from '@fwos/core';
import { senderAddress, unwrapForward } from './forwarded';

/** One search sent to the mail server: only messages from this sender (a substring match on the From line) since this date. */
export interface MailSearch {
  from: string;
  since: Date;
}

/** What the mail server tells about a message before anything is downloaded. */
export interface MailHead {
  uid: number;
  /** the Message-ID with its angle brackets, as the bank-email reader also records it */
  messageId: string | null;
  from: string;
  subject: string;
  date: Date;
  /** the whole message in bytes */
  size: number;
  /** the message has a PDF attachment (taken from its structure, so nothing was downloaded) */
  hasPdf: boolean;
  /** the Authentication-Results header lines Gmail added, joined; null when there are none */
  authResults: string | null;
}

/** The domain of an address ("a@b.c" -> "b.c"); empty when there is none. */
export const addressDomain = (address: string): string => address.split('@')[1] ?? '';

/** An address with most of it hidden, for the screen: "asha.rao@mail.example.test" -> "a***@m***.test". Empty text when it is not an address. */
export function maskAddress(address: string): string {
  const [name, domain] = address.trim().split('@');
  if (!name || !domain || !domain.includes('.')) return '';
  const dot = domain.lastIndexOf('.');
  return `${name[0]}***@${domain[0]}***${domain.slice(dot)}`;
}

/** The allowed senders as clean, distinct entries (domains and full addresses). */
export function cleanSenders(list: readonly string[]): string[] {
  return [...new Set(list.map(cleanSender).filter((x): x is string => !!x))];
}

/** The allowed entry that this address matches, or null. A domain covers its sub-domains; an entry with "@" is one exact address. */
export function matchingSender(address: string, senders: readonly string[]): string | null {
  const addr = address.trim().toLowerCase();
  const domain = addressDomain(addr);
  if (!domain) return null;
  for (const raw of senders) {
    const s = cleanSender(raw);
    if (!s) continue;
    if (s.includes('@')) {
      if (addr === s) return s;
    } else if (domain === s || domain.endsWith(`.${s}`)) return s;
  }
  return null;
}

/**
 * Is this From line from an allowed registrar or depository? Only the address counts: "CAMS <donotreply@camsonline.com.evil.example>"
 * and "donotreply@camsonline.com <attacker@evil.example>" are both refused.
 */
export function isRegistrarSender(from: string, senders: readonly string[]): boolean {
  return matchingSender(senderAddress(from), senders) !== null;
}

/** A plain name for the sender, for the list on screen. Only a label: it never decides whether a message is read. */
export function registrarName(address: string): string {
  const d = addressDomain(address.toLowerCase());
  if (/(^|\.)camsonline\.com$/.test(d)) return 'CAMS';
  if (/(^|\.)(kfintech|karvy)\.com$/.test(d)) return 'KFintech';
  if (/(^|\.)nsdl\.(co\.in|com)$/.test(d)) return 'NSDL';
  if (/(^|\.)cdsl(india|statements?)\.com$/.test(d)) return 'CDSL';
  if (/(^|\.)mfcentral\.com$/.test(d)) return 'MF Central';
  return d || 'Unknown sender';
}

export type AuthVerdict = 'pass' | 'fail' | 'unknown';

/**
 * Gmail's own check of who really sent a message, from its Authentication-Results header. "fail" wins over "pass" (a sender can add a
 * header of its own saying pass but cannot remove the one Gmail added). No header means unknown, which is allowed: the password check
 * on the PDF still has to pass.
 */
export function authVerdict(results: string | null): AuthVerdict {
  if (!results) return 'unknown';
  if (/\bdmarc=(fail|reject|quarantine)\b/i.test(results)) return 'fail';
  if (/\bdmarc=pass\b/i.test(results)) return 'pass';
  return 'unknown';
}

/** A subject that suggests a statement: used only for a forwarded copy, where the original sender is not yet known. */
const STATEMENT_SUBJECT =
  /consolidated account statement|\bcas\b|e-?cas\b|account statement|mutual fund|folio|statement/i;

export type HeadDecision =
  | { kind: 'read'; via: 'registrar' | 'forward'; registrar: string }
  | {
      kind: 'ignore';
      /** record the reason so the message is not looked at again, or pass over it silently (it is not a statement mail at all) */
      record: boolean;
      why: 'not_sender' | 'no_pdf' | 'too_big' | 'failed_auth' | 'not_statement';
      reason: string;
    };

/** What to do with a message from what the server said about it (no download yet). */
export function judgeHead(
  head: MailHead,
  rules: { senders: readonly string[]; ownAddresses: readonly string[]; maxBytes: number },
): HeadDecision {
  const address = senderAddress(head.from);
  const match = matchingSender(address, rules.senders);
  const mine = rules.ownAddresses.map((a) => a.toLowerCase()).includes(address);
  if (!match && !mine)
    return {
      kind: 'ignore',
      record: false,
      why: 'not_sender',
      reason: 'Not from an allowed sender.',
    };
  if (!head.hasPdf)
    return { kind: 'ignore', record: false, why: 'no_pdf', reason: 'No PDF attached.' };
  if (head.size > rules.maxBytes)
    return {
      kind: 'ignore',
      record: true,
      why: 'too_big',
      reason: `Not read: larger than the ${Math.round(rules.maxBytes / 1_048_576)} MB limit in Settings.`,
    };
  if (match) {
    if (authVerdict(head.authResults) === 'fail')
      return {
        kind: 'ignore',
        record: true,
        why: 'failed_auth',
        reason:
          'Not read: Gmail could not confirm the sender (the message failed its sender check).',
      };
    return { kind: 'read', via: 'registrar', registrar: registrarName(address) };
  }
  // one of your own addresses: only a forward that looks like a statement is downloaded; its original sender is checked afterwards
  if (!STATEMENT_SUBJECT.test(head.subject))
    return {
      kind: 'ignore',
      record: false,
      why: 'not_statement',
      reason: 'Your own message with a PDF, but its subject does not suggest a statement.',
    };
  return { kind: 'read', via: 'forward', registrar: 'forwarded' };
}

/** The original sender of a message you forwarded yourself, when it is an allowed one: its address, or null. */
export function forwardedRegistrar(
  subject: string,
  text: string,
  senders: readonly string[],
): { address: string; registrar: string } | null {
  const fw = unwrapForward(subject, text);
  if (!fw.found || !fw.originalFrom) return null;
  const address = senderAddress(fw.originalFrom);
  return matchingSender(address, senders) ? { address, registrar: registrarName(address) } : null;
}

/**
 * The searches to send to the server. One per allowed sender (a full address, or a domain, which the server matches inside the From
 * line) and one per address of yours that may forward statements; each limited to messages since `since`, so the rest of the mailbox
 * is never listed, let alone downloaded.
 */
export function searchPlan(
  senders: readonly string[],
  forwarders: readonly string[],
  since: Date,
): MailSearch[] {
  const from = new Set<string>();
  for (const s of [...senders, ...forwarders]) {
    const c = cleanSender(s);
    if (c) from.add(c);
  }
  return [...from].map((f) => ({ from: f, since }));
}

/** Days to look back: the first scan (nothing read yet) goes far back, the later ones a short way. */
export const lookBackDays = (firstRun: boolean, cfg: { firstDays: number; regularDays: number }) =>
  firstRun ? cfg.firstDays : cfg.regularDays;

export const sinceDate = (now: Date, days: number): Date =>
  new Date(now.getTime() - days * 86_400_000);

/** Oldest first, so a later statement overwrites an earlier one; ties keep the server's order. */
export function oldestFirst<T extends { date: Date; uid: number }>(heads: readonly T[]): T[] {
  return [...heads].sort((a, b) => a.date.getTime() - b.date.getTime() || a.uid - b.uid);
}

/** A Gmail search link for the same senders, domains only: from:(camsonline.com OR kfintech.com ...) has:attachment. */
export function gmailSearchUrl(senders: readonly string[]): string {
  const list = cleanSenders(senders).join(' OR ');
  return `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:(${list}) has:attachment`)}`;
}

/**
 * Where to ask for a full statement: the registrars' own pages, which the person opens. Both put a security check on the form
 * (see docs/runbooks/gmail-statements.md), so the app never submits anything there.
 */
export const REQUEST_PAGES = {
  cams: {
    name: 'CAMS',
    url: 'https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement',
  },
  kfintech: {
    name: 'KFintech',
    url: 'https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement',
  },
  mfcentral: { name: 'MF Central', url: 'https://www.mfcentral.com' },
} as const;
export type RequestRegistrar = 'cams' | 'kfintech' | 'mfcentral';
export const REGISTRAR_LABEL: Record<RequestRegistrar, string> = {
  cams: 'CAMS',
  kfintech: 'KFintech',
  mfcentral: 'MF Central',
};

export type RequestState = 'waiting' | 'late' | 'arrived' | 'cancelled';

/** Where a requested statement stands: waiting, late (not arrived after `waitDays`), arrived or cancelled. */
export function requestState(
  r: { status: 'asked' | 'arrived' | 'cancelled'; requestedOn: string },
  today: string,
  waitDays: number,
): RequestState {
  if (r.status === 'arrived') return 'arrived';
  if (r.status === 'cancelled') return 'cancelled';
  const days = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.requestedOn}T00:00:00Z`)) / 86_400_000,
  );
  return days >= waitDays ? 'late' : 'waiting';
}

/** One plain sentence for a request: "Requested from CAMS for Asha on 27 Oct 2026: waiting." */
export function requestSentence(
  r: { owner: string; registrar: RequestRegistrar; requestedOn: string; arrivedOn?: string | null },
  state: RequestState,
  waitDays: number,
  dateText: (iso: string) => string,
): string {
  const head = `Requested from ${REGISTRAR_LABEL[r.registrar]} for ${r.owner} on ${dateText(r.requestedOn)}`;
  if (state === 'arrived')
    return `${head}: arrived${r.arrivedOn ? ` on ${dateText(r.arrivedOn)}` : ''} and imported.`;
  if (state === 'cancelled') return `${head}: cancelled.`;
  if (state === 'late')
    return `${head}: not arrived after ${waitDays} day${waitDays === 1 ? '' : 's'}. Check the e-mail address you gave and your spam folder, or ask again.`;
  return `${head}: waiting. Your Gmail is scanned daily; it is imported when it arrives.`;
}
