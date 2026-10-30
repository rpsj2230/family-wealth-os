/**
 * The inactivity alert (docs/USER-GUIDE.md, "If you stop using the portal"). When nobody from the household has used the portal for
 * `warnDays`, the members get one e-mail: "Are you all right? Sign in to postpone". At `alertDays` (the same number of days after which
 * the read-only family login may open the handbook), the people the owner chose are told the portal exists and how to sign in, by
 * e-mail and, where they activated it, WhatsApp; the members get a copy. Each message goes at most once per absence: a member using
 * the portal again clears both stamps (touch_member_activity).
 *
 * Pure: the daily job reads the row, asks `inactivityDecision`, builds the texts here and stamps what it sent. The texts carry no
 * amounts, no account numbers and no password: only where the owner wrote the passwords are kept.
 */
import { esc, niceDate } from './digest-format';

export type InactivityMode = 'always' | 'inactive' | 'manual';
export type InactivityDecision = 'none' | 'warn' | 'alert';

/** At most this many people are told. */
export const MAX_ALERT_CONTACTS = 5;
/** The warning may come this early or this late. */
export const WARN_DAYS_MIN = 3;
export const WARN_DAYS_MAX = 365;
export const DEFAULT_WARN_DAYS = 20;

const DAY = 86_400_000;
/** The daily job starts at 00:30 UTC (.github/workflows/digest.yml), 08:30 in Singapore. */
const JOB_MINUTE_UTC = 30;

/** A person who is told, as kept in emergency_access.alert_contacts. `whatsappKey` is write-only: never sent to a page. */
export interface StoredAlertContact {
  /** a short id so a saved key stays with its person when rows are removed or reordered */
  id: string;
  name: string;
  email: string;
  /** WhatsApp number in international form, "+" and digits only ("" when none) */
  phone: string;
  /** the CallMeBot key this person received when they activated WhatsApp messages ("" when none) */
  whatsappKey: string;
}

/** The same person as a page may see it: whether a key is saved, never the key. */
export interface AlertContactView {
  id: string;
  name: string;
  email: string;
  phone: string;
  keySaved: boolean;
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;

/** "+65 9123 4567", "0065-9123-4567" -> "+6591234567"; "" when it is not a plausible international number. */
export function normalisePhone(raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  const intl = s.startsWith('+') || s.startsWith('00');
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  if (!intl || digits.length < 8 || digits.length > 15 || digits.startsWith('0')) return '';
  return `+${digits}`;
}

export const isEmail = (s: string): boolean => EMAIL.test(s.trim());

/** CallMeBot keys are short codes of letters and digits. */
export const isWhatsAppKey = (s: string): boolean => /^[A-Za-z0-9]{4,64}$/.test(s.trim());

/** The saved list, cleaned: unknown keys and broken entries dropped, at most MAX_ALERT_CONTACTS. */
export function alertContactsFromJson(raw: unknown): StoredAlertContact[] {
  if (!Array.isArray(raw)) return [];
  const out: StoredAlertContact[] = [];
  for (const [i, r] of raw.entries()) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const s = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const name = s(o.name, 80);
    if (!name) continue;
    const email = s(o.email, 200).toLowerCase();
    const key = s(o.whatsappKey, 64);
    out.push({
      id: s(o.id, 40) || `c${i + 1}`,
      name,
      email: isEmail(email) ? email : '',
      phone: normalisePhone(s(o.phone, 40)),
      whatsappKey: isWhatsAppKey(key) ? key : '',
    });
    if (out.length === MAX_ALERT_CONTACTS) break;
  }
  return out;
}

/** What Settings may show: the key itself is left out. */
export const alertContactView = (c: StoredAlertContact): AlertContactView => ({
  id: c.id,
  name: c.name,
  email: c.email,
  phone: c.phone,
  keySaved: !!c.whatsappKey,
});

/** People with a WhatsApp number but no key: they get the e-mail only. */
export const whatsAppNotActivated = (cs: readonly AlertContactView[]): string[] =>
  cs.filter((c) => c.phone && !c.keySaved).map((c) => c.name);

export interface InactivityState {
  /** when a member last used the portal (ISO timestamp) */
  lastMemberSeen: string;
  warnDays: number;
  /** emergency_access.inactive_days: the family is told then, the day the handbook opens to the family login */
  alertDays: number;
  warnedAt: string | null;
  alertedAt: string | null;
  mode: InactivityMode;
  released: boolean;
  /** now (ISO timestamp) */
  now: string;
  /** people to tell; with none saved the alert is switched off and nothing is sent */
  contacts: number;
}

/** Whole days since a member last used the portal. */
export function daysAbsent(lastMemberSeen: string, now: string): number {
  const ms = Date.parse(now) - Date.parse(lastMemberSeen);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

/** A stamp from an earlier absence (older than the last visit) does not count. */
const current = (stamp: string | null, seen: string): boolean =>
  !!stamp && Date.parse(stamp) >= Date.parse(seen);

/**
 * What today's run sends. At most one of each per absence. The alert needs more than `alertDays` full days, exactly when the
 * handbook opens to the family login in "inactive" mode (emergency_open), so the family can sign in when they are told. An alert
 * that is due goes even if the job missed days or the warning was never sent (then only the alert goes; the members get its copy).
 */
export function inactivityDecision(s: InactivityState): InactivityDecision {
  if (s.contacts <= 0) return 'none';
  const seen = Date.parse(s.lastMemberSeen);
  const now = Date.parse(s.now);
  if (!Number.isFinite(seen) || !Number.isFinite(now)) return 'none';
  if (current(s.alertedAt, s.lastMemberSeen)) return 'none';
  const gone = now - seen;
  if (gone > s.alertDays * DAY) return 'alert';
  if (s.warnDays < s.alertDays && gone > s.warnDays * DAY && !current(s.warnedAt, s.lastMemberSeen))
    return 'warn';
  return 'none';
}

/** The date (YYYY-MM-DD, UTC, the same day in Singapore) of the first daily run that sends the alert. */
export function alertDueDate(lastMemberSeen: string, alertDays: number): string {
  const due = Date.parse(lastMemberSeen) + alertDays * DAY;
  const d = new Date(due);
  let run = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, JOB_MINUTE_UTC);
  if (run <= due) run += DAY;
  return new Date(run).toISOString().slice(0, 10);
}

/** "Ragini", "Ragini and Ravi", "Ragini, Ravi and Meera". */
export function peopleList(names: readonly string[]): string {
  const n = names.filter(Boolean);
  if (n.length <= 1) return n[0] ?? '';
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** Settings > Access: the rules for the two numbers, as a message, or null when they are fine. */
export function warnDaysProblem(warnDays: number | null, alertDays: number): string | null {
  if (
    warnDays === null ||
    !Number.isInteger(warnDays) ||
    warnDays < WARN_DAYS_MIN ||
    warnDays > WARN_DAYS_MAX
  )
    return `Warn me after: a whole number of days from ${WARN_DAYS_MIN} to ${WARN_DAYS_MAX}.`;
  if (warnDays >= alertDays)
    return `Warn me after: it must be fewer than the ${alertDays} days after which the family is told.`;
  return null;
}

export interface InactivityMail {
  subject: string;
  text: string;
  html: string;
}

const base = (u: string) => u.replace(/\/+$/, '');
const signInUrl = (appUrl: string) => `${base(appUrl)}/login`;

const htmlPage = (paras: string[]): string =>
  `<!doctype html><html><body style="margin:0;padding:16px;background:#f1f4f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2433">` +
  `<div style="max-width:560px;margin:0 auto;background:#f8f9fb;border-radius:8px;padding:20px;font-size:16px;line-height:1.5">` +
  paras.join('') +
  `</div></body></html>`;
const p = (inner: string, style = '') =>
  `<p style="margin:0 0 14px${style ? `;${style}` : ''}">${inner}</p>`;
const link = (u: string, label = u) =>
  `<a href="${esc(u)}" style="color:#1d4ed8">${esc(label)}</a>`;

export interface WarningInput {
  daysAbsent: number;
  /** YYYY-MM-DD: when the family is told (alertDueDate) */
  alertDate: string;
  contactNames: string[];
  appUrl: string;
}

/** The e-mail to the members after `warnDays`. */
export function inactivityWarning(i: WarningInput): InactivityMail {
  const who = peopleList(i.contactNames) || 'the people you chose';
  const lead = 'Are you all right?';
  const body =
    `Nobody has used the family portal for ${i.daysAbsent} days. Sign in to postpone — otherwise on ` +
    `${niceDate(i.alertDate)} ${who} will be told how to open the family handbook.`;
  const url = signInUrl(i.appUrl);
  const after =
    'Signing in once is enough: nothing is sent to anyone, and this message does not come again until the next long absence.';
  const foot =
    'You receive this because you are a member of the household. The days and the people are in Settings > Emergency and access.';
  return {
    subject: 'Are you all right? Sign in to the family portal to postpone',
    text: [lead, '', body, '', `Sign in: ${url}`, '', after, '', foot].join('\n'),
    html: htmlPage([
      p(`<b>${esc(lead)}</b>`, 'font-size:18px'),
      p(esc(body)),
      p(link(url, 'Sign in to postpone')),
      p(esc(after)),
      p(esc(foot), 'font-size:13px;color:#4b5565'),
    ]),
  };
}

export interface FamilyAlertInput {
  /** the person who kept the records ("Asha"); the household name when no one is marked primary */
  ownerName: string;
  appUrl: string;
  /** the e-mail address(es) of the read-only family login; empty when none exists or it cannot be read */
  familyLogins: string[];
  /** where the owner wrote the passwords are kept (Settings > Emergency information, "Passwords and logins"); "" when empty */
  passwordWhere: string;
  /** the first person in "Call these people first" */
  callFirst: { name: string; relation: string; phone: string } | null;
  mode: InactivityMode;
  released: boolean;
  /** household members with a full login, who can release a handbook kept locked ("manual") */
  releaseBy: string[];
  daysAbsent: number;
}

export interface FamilyAlertOptions {
  /** the person this copy is for ("Dear Ragini") */
  recipientName?: string;
  /** the members' copy: the names of the people it went to */
  copyOf?: string[];
  /** Settings > "Send a test": the member's own copy, marked TEST */
  test?: boolean;
  /** the person also gets the e-mail: the WhatsApp version then leaves where the password is kept to the e-mail */
  emailToo?: boolean;
}

export interface FamilyAlert extends InactivityMail {
  /** the short WhatsApp version; it travels through a third-party service, so where the password is kept is left to the e-mail when one goes too */
  chat: string;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/** The message to the people the owner chose, at `alertDays`. Short and calm: what this is, the link, how to sign in, who to call. */
export function familyAlert(i: FamilyAlertInput, o: FamilyAlertOptions = {}): FamilyAlert {
  const owner = i.ownerName.trim() || 'the household';
  const url = signInUrl(i.appUrl);
  const locked = i.mode === 'manual' && !i.released;
  const greet = o.recipientName ? `Dear ${o.recipientName},` : 'Hello,';
  const why =
    `This is an automatic message from ${owner}'s family portal. Nobody from the household has signed in to it for ` +
    `${i.daysAbsent} days, so it is sending the message ${owner} asked it to send. It may be nothing, such as a long trip, ` +
    'but please read it.';
  const what =
    `${owner} kept the family's money records (bank accounts, deposits, investments, insurance) in a private portal, ` +
    'and wrote a family handbook there that tells you what to do, step by step.';
  const login =
    i.familyLogins.length === 0
      ? `Sign in with the family login ${owner} set up for you (an e-mail address and a password).`
      : i.familyLogins.length === 1
        ? `Sign in with the family login: ${i.familyLogins[0]}, and its password.`
        : `Sign in with one of the family logins: ${i.familyLogins.join(', ')}, and its password.`;
  const where = i.passwordWhere.trim()
    ? `Where the password is kept, in ${owner}'s words: ${clip(i.passwordWhere.trim().replace(/\s+/g, ' '), 300)}`
    : '';
  const forgot =
    'If you have the e-mail address but not the password, press "Forgot your password?" on the sign-in page: a link to set a new one is sent to that address.';
  const open = locked
    ? `The handbook is kept locked until a household member releases it${i.releaseBy.length ? `: ask ${peopleList(i.releaseBy)}` : ''} to sign in with their own login and press Release now under Settings > Emergency and access. Nothing opens by itself.`
    : 'After you sign in, the family handbook opens. It tells you what to do, step by step.';
  const call = i.callFirst
    ? `Call first: ${i.callFirst.name}${i.callFirst.relation ? ` (${i.callFirst.relation})` : ''}${i.callFirst.phone ? `, ${i.callFirst.phone}` : ''}.`
    : '';
  const fine = `If ${owner} is fine, nothing needs doing: as soon as anyone from the household signs in, these messages stop.`;
  const head = o.test
    ? 'TEST: this is a test sent only to you. Nobody else received it. Below is exactly what the people you chose will receive.'
    : o.copyOf
      ? `A copy for the household: the message below went to ${peopleList(o.copyOf) || 'the people you chose'} today. Signing in stops any more messages.`
      : '';
  const steps = [
    `1. Open the portal: ${url}`,
    `2. ${login}${where ? ` ${where}` : ''}`,
    `   ${forgot}`,
    `3. ${open}`,
  ];
  const text = [
    ...(head ? [head, '', '----', ''] : []),
    greet,
    '',
    why,
    '',
    what,
    '',
    ...steps,
    '',
    ...(call ? [call, ''] : []),
    fine,
  ].join('\n');
  const html = htmlPage([
    ...(head
      ? [
          p(
            `<b>${esc(head)}</b>`,
            'padding:10px;border:2px solid #b45309;border-radius:6px;color:#7c2d12',
          ),
        ]
      : []),
    p(esc(greet)),
    p(esc(why)),
    p(esc(what)),
    `<ol style="margin:0 0 14px;padding-left:22px">` +
      `<li style="margin-bottom:8px">Open the portal: ${link(url)}</li>` +
      `<li style="margin-bottom:8px">${esc(login)}${where ? `<br>${esc(where)}` : ''}<br><span style="font-size:14px;color:#4b5565">${esc(forgot)}</span></li>` +
      `<li>${esc(open)}</li></ol>`,
    ...(call ? [p(`<b>${esc(call)}</b>`)] : []),
    p(esc(fine), 'font-size:14px;color:#4b5565'),
  ]);
  const chat = [
    ...(o.test ? ['TEST (sent only to you)', ''] : []),
    greet,
    `This is an automatic message from ${owner}'s family portal: nobody from the household has signed in for ${i.daysAbsent} days.`,
    `${owner} kept the family's money records there, with a handbook that says what to do, step by step.`,
    `Open: ${url}`,
    i.familyLogins.length
      ? `Sign in with the family login ${i.familyLogins.join(' or ')}.`
      : `Sign in with the family login ${owner} set up for you.`,
    ...(where
      ? [o.emailToo ? 'The e-mail sent to you says where the password is kept.' : where]
      : []),
    ...(locked
      ? [
          `The handbook is locked until a household member releases it${i.releaseBy.length ? `: ask ${peopleList(i.releaseBy)}` : ''}.`,
        ]
      : []),
    ...(call ? [call] : []),
    fine,
  ].join('\n');
  const subject = `${o.test ? '[TEST] ' : o.copyOf ? 'Copy: ' : ''}${owner.charAt(0).toUpperCase()}${owner.slice(1)}'s family portal: how to open the family handbook`;
  return { subject, text, html, chat };
}
