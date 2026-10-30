/**
 * The inactivity alert (docs/USER-GUIDE.md, "If you stop using the portal"). When nobody from the household has used the portal for
 * `warnDays`, the members get an e-mail every `warnEveryDays` until the first trusted person is told: "Are you all right? Sign in to
 * postpone", with an "I'm fine — postpone" link and how many days are left. At
 * `alertDays` (the same number of days after which the read-only family login may open the handbook) the people the owner chose are
 * told, one at a time in the owner's order: the first person gets a message with an "I have received this" link; without a
 * confirmation they are reminded `reminders` times, `remindEveryDays` apart, and then the next person is told the same way. The chain
 * stops when anyone confirms (the members get a short note), when a member uses the portal again (a new absence starts a new chain),
 * or when the list is used up with nobody confirming.
 *
 * Pure: the daily job reads the row and this absence's log, asks `inactivityStep` for one step, builds the texts here, sends and
 * records. The texts carry no amounts, no account numbers and no password: only where the owner wrote the passwords are kept.
 */
import { esc, niceDate } from './digest-format';

export type InactivityMode = 'always' | 'inactive' | 'manual';

/** At most this many people are told, in order. */
export const MAX_ALERT_CONTACTS = 10;
export const WARN_DAYS_MIN = 3;
export const WARN_DAYS_MAX = 365;
export const DEFAULT_WARN_DAYS = 20;
export const REMINDERS_MAX = 10;
export const DEFAULT_REMINDERS = 3;
export const REMIND_EVERY_MIN = 1;
export const REMIND_EVERY_MAX = 14;
export const DEFAULT_REMIND_EVERY = 2;
export const WARN_EVERY_MIN = 1;
export const WARN_EVERY_MAX = 14;
export const DEFAULT_WARN_EVERY = 1;
export const ALERT_DAYS_MIN = 7;
export const ALERT_DAYS_MAX = 365;

const DAY = 86_400_000;
/** The daily job starts at 00:30 UTC (.github/workflows/digest.yml), 08:30 in Singapore. */
const JOB_MINUTE_UTC = 30;
/** A run that starts a few minutes earlier than yesterday's still counts as a day later. */
const GRACE = 6 * 3_600_000;

/** A person who is told, as kept in emergency_access.alert_contacts (in priority order). `whatsappKey` never goes to a page. */
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

/** The saved list, cleaned and in order: broken entries dropped, at most MAX_ALERT_CONTACTS. */
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

/** People the portal cannot reach at all: no e-mail and no activated WhatsApp. */
export const unreachable = (cs: readonly AlertContactView[]): string[] =>
  cs.filter((c) => !c.email && !(c.phone && c.keySaved)).map((c) => c.name);

/** One person's line in this absence's chain (emergency_alert_log). */
export interface ChainEntry {
  /** last_member_seen when the chain began */
  absenceFrom: string;
  /** 0 = the first person in the list */
  pos: number;
  /** messages sent to this person: 1 = the first, then one per reminder */
  sends: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  confirmedAt: string | null;
}

export interface InactivityState {
  /** when a member last used the portal (ISO timestamp) */
  lastMemberSeen: string;
  warnDays: number;
  /** days between the owner's warnings (1 = every day) */
  warnEveryDays: number;
  /** emergency_access.inactive_days: the first person is told then, the day the handbook opens to the family login */
  alertDays: number;
  reminders: number;
  remindEveryDays: number;
  /** the last warning to the members in this absence */
  warnedAt: string | null;
  /** when this absence's chain was closed (a confirmation noted, or the list used up); null while it runs */
  alertedAt: string | null;
  /** people in the list; with none saved the alert is off */
  contacts: number;
  /** now (ISO timestamp) */
  now: string;
}

export type InactivityStep =
  | { kind: 'none'; why: 'off' | 'active' | 'closed' | 'waiting' }
  | { kind: 'warn' }
  /** a message to the person at `pos`: send 1 is the first, 2 and up are reminders */
  | { kind: 'tell'; pos: number; send: number }
  /** someone confirmed: note it for the members once and close the chain */
  | { kind: 'confirmed'; pos: number; at: string }
  /** everybody was told and reminded and nobody confirmed: close the chain */
  | { kind: 'exhausted' };

/** Whole days since a member last used the portal. */
export function daysAbsent(lastMemberSeen: string, now: string): number {
  const ms = Date.parse(now) - Date.parse(lastMemberSeen);
  return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / DAY) : 0;
}

/** A stamp from an earlier absence (older than the last visit) does not count. */
const current = (stamp: string | null, seen: string): boolean =>
  !!stamp && Date.parse(stamp) >= Date.parse(seen);

/** This absence's entries: the chain that began at `lastMemberSeen`, ordered by position. */
export function chainOf(log: readonly ChainEntry[], lastMemberSeen: string): ChainEntry[] {
  const key = Date.parse(lastMemberSeen);
  return log.filter((e) => Date.parse(e.absenceFrom) === key).sort((a, b) => a.pos - b.pos);
}

/**
 * The one thing today's run does for a household. At most one message to at most one person per run, so missed job days never
 * bunch messages together and never skip a person: each later run takes the next step.
 */
export function inactivityStep(s: InactivityState, log: readonly ChainEntry[]): InactivityStep {
  const seen = Date.parse(s.lastMemberSeen);
  const now = Date.parse(s.now);
  if (s.contacts <= 0 || !Number.isFinite(seen) || !Number.isFinite(now))
    return { kind: 'none', why: 'off' };
  if (current(s.alertedAt, s.lastMemberSeen)) return { kind: 'none', why: 'closed' };
  const chain = chainOf(log, s.lastMemberSeen);
  const yes = chain.find((e) => e.confirmedAt);
  if (yes) return { kind: 'confirmed', pos: yes.pos, at: yes.confirmedAt! };
  const gone = now - seen;
  if (chain.length === 0) {
    // more than alertDays: exactly when the handbook opens to the family login in "inactive" mode (emergency_open)
    if (gone > s.alertDays * DAY) return { kind: 'tell', pos: 0, send: 1 };
    // from warnDays on, a warning every warnEveryDays until the chain begins
    if (s.warnDays < s.alertDays && gone > s.warnDays * DAY) {
      if (!current(s.warnedAt, s.lastMemberSeen)) return { kind: 'warn' };
      const every = Math.max(1, s.warnEveryDays) * DAY - GRACE;
      return now - Date.parse(s.warnedAt!) >= every
        ? { kind: 'warn' }
        : { kind: 'none', why: 'waiting' };
    }
    return { kind: 'none', why: 'active' };
  }
  const last = chain[chain.length - 1]!;
  const since = Date.parse(last.lastSentAt ?? last.firstSentAt ?? '');
  const every = Math.max(1, s.remindEveryDays) * DAY - GRACE;
  if (Number.isFinite(since) && now - since < every) return { kind: 'none', why: 'waiting' };
  if (last.sends - 1 < Math.max(0, s.reminders))
    return { kind: 'tell', pos: last.pos, send: last.sends + 1 };
  if (last.pos + 1 < s.contacts) return { kind: 'tell', pos: last.pos + 1, send: 1 };
  return { kind: 'exhausted' };
}

/** Whole days from one run date (YYYY-MM-DD) to another. */
export const runDaysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY);

/** The date (YYYY-MM-DD, UTC, the same day in Singapore) of the first daily run after `days` full days from `from`. */
export function runDateAfter(from: string, days: number): string {
  const due = Date.parse(from) + days * DAY;
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

/** Days from telling one person to telling the next, when nobody confirms. */
export const escalationDays = (reminders: number, remindEveryDays: number): number =>
  (Math.max(0, reminders) + 1) * Math.max(1, remindEveryDays);

const whole = (n: number | null, lo: number, hi: number) =>
  n !== null && Number.isInteger(n) && n >= lo && n <= hi;

export interface AlertSettings {
  warnDays: number | null;
  alertDays: number | null;
  warnEveryDays: number | null;
  reminders: number | null;
  remindEveryDays: number | null;
}

/** Settings > Access: the numbers of the alert, as a message, or null when they are fine. */
export function alertSettingsProblem(v: AlertSettings): string | null {
  if (!whole(v.alertDays, ALERT_DAYS_MIN, ALERT_DAYS_MAX))
    return `Tell the first person after: a whole number of days from ${ALERT_DAYS_MIN} to ${ALERT_DAYS_MAX}.`;
  if (!whole(v.warnDays, WARN_DAYS_MIN, WARN_DAYS_MAX))
    return `Warn me from day: a whole number from ${WARN_DAYS_MIN} to ${WARN_DAYS_MAX}.`;
  if (v.warnDays! >= v.alertDays!)
    return `Warn me from day: it must be before day ${v.alertDays}, when the first person is told.`;
  if (!whole(v.warnEveryDays, WARN_EVERY_MIN, WARN_EVERY_MAX))
    return `Warn me every: a whole number of days from ${WARN_EVERY_MIN} to ${WARN_EVERY_MAX}.`;
  if (!whole(v.reminders, 0, REMINDERS_MAX))
    return `Reminders: a whole number from 0 to ${REMINDERS_MAX}.`;
  if (!whole(v.remindEveryDays, REMIND_EVERY_MIN, REMIND_EVERY_MAX))
    return `Days between reminders: a whole number from ${REMIND_EVERY_MIN} to ${REMIND_EVERY_MAX}.`;
  return null;
}

const everyDays = (n: number) => (n <= 1 ? 'daily' : `every ${n} days`);

/**
 * The one-line preview under the numbers: "With these: you are reminded daily from day 20; Ragini is told after 30 days; Amit after
 * 38 days if Ragini has not confirmed; Meera after 46 days if nobody has."
 */
export function alertSchedulePreview(
  v: {
    warnDays: number;
    alertDays: number;
    warnEveryDays: number;
    reminders: number;
    remindEveryDays: number;
  },
  names: readonly string[],
): string {
  const gap = escalationDays(v.reminders, v.remindEveryDays);
  const who = names.filter(Boolean);
  const first = who[0] ?? 'the first person on your list';
  const parts = [
    `you are reminded ${everyDays(v.warnEveryDays)} from day ${v.warnDays}`,
    `${first} is told after ${v.alertDays} days`,
    ...who
      .slice(1)
      .map(
        (n, i) =>
          `${n} after ${v.alertDays + (i + 1) * gap} days if ${i === 0 ? `${first} has not` : 'nobody has'} confirmed`,
      ),
  ];
  const reminded =
    v.reminders > 0
      ? ` Each person is reminded ${v.reminders === 1 ? 'once' : `${v.reminders} times`}, ${v.remindEveryDays === 1 ? 'a day' : `${v.remindEveryDays} days`} apart.`
      : ' Nobody is reminded: each person gets one message.';
  return `With these: ${parts.join('; ')}.${reminded}`;
}

export interface InactivityMail {
  subject: string;
  text: string;
  html: string;
}

const base = (u: string) => u.replace(/\/+$/, '');
export const signInUrl = (appUrl: string): string => `${base(appUrl)}/login`;
export const confirmUrl = (appUrl: string, token: string): string =>
  `${base(appUrl)}/confirm/${encodeURIComponent(token)}`;
export const postponeUrl = (appUrl: string, token: string): string =>
  `${base(appUrl)}/postpone/${encodeURIComponent(token)}`;

const htmlPage = (paras: string[]): string =>
  `<!doctype html><html><body style="margin:0;padding:16px;background:#f1f4f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2433">` +
  `<div style="max-width:560px;margin:0 auto;background:#f8f9fb;border-radius:8px;padding:20px;font-size:16px;line-height:1.5">` +
  paras.join('') +
  `</div></body></html>`;
const p = (inner: string, style = '') =>
  `<p style="margin:0 0 14px${style ? `;${style}` : ''}">${inner}</p>`;
const link = (u: string, label = u) =>
  `<a href="${esc(u)}" style="color:#1d4ed8">${esc(label)}</a>`;
const button = (u: string, label: string) =>
  `<p style="margin:0 0 14px"><a href="${esc(u)}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#f8f9fb;border-radius:6px;text-decoration:none;font-weight:600">${esc(label)}</a></p>`;

export interface WarningInput {
  daysAbsent: number;
  /** whole days until the first person is told (from today's run to the alert's run) */
  daysLeft: number;
  /** YYYY-MM-DD: when the first person is told */
  alertDate: string;
  /** the people in order; the first is told first */
  contactNames: string[];
  reminders: number;
  remindEveryDays: number;
  appUrl: string;
  /** the "I'm fine — postpone" link's token */
  postponeToken: string;
}

/** The e-mail to the members from `warnDays`, every `warnEveryDays`, until the first person is told. */
export function inactivityWarning(i: WarningInput): InactivityMail {
  const first = i.contactNames[0] || 'the first person on your list';
  const lead = 'Are you all right?';
  const body =
    `Nobody has used the family portal for ${i.daysAbsent} days. Sign in to postpone — otherwise ` +
    `${i.daysLeft <= 0 ? 'today' : i.daysLeft === 1 ? 'tomorrow' : `in ${i.daysLeft} days`}, on ${niceDate(i.alertDate)}, ` +
    `${first} will be told how to open the family handbook.`;
  const gap = escalationDays(i.reminders, i.remindEveryDays);
  const reminded =
    i.reminders > 0
      ? `is reminded ${i.reminders === 1 ? 'once' : `${i.reminders} times`}, ${i.remindEveryDays === 1 ? 'a day' : `${i.remindEveryDays} days`} apart, and `
      : '';
  const next = i.contactNames[1];
  const chain = next
    ? `If ${first} does not confirm receiving it, ${first} ${reminded}${gap} days after the first message ${next} is told the same way, and so on down your list.`
    : `If ${first} does not confirm receiving it, ${first} ${reminded || 'is told only once, and '}nobody else is told: the list has one person.`;
  const stop =
    'Everything stops as soon as someone confirms, or anyone from the household signs in or presses "I\'m fine — postpone".';
  const postpone = postponeUrl(i.appUrl, i.postponeToken);
  const url = signInUrl(i.appUrl);
  const foot =
    'You receive this because you are a member of the household. The days and the people are in Settings > Emergency and access.';
  return {
    subject: `Are you all right? Sign in to the family portal to postpone (${i.daysLeft <= 1 ? (i.daysLeft <= 0 ? 'today' : '1 day left') : `${i.daysLeft} days left`})`,
    text: [
      lead,
      '',
      body,
      '',
      `I'm fine — postpone: ${postpone}`,
      `Or sign in: ${url}`,
      '',
      chain,
      stop,
      '',
      foot,
    ].join('\n'),
    html: htmlPage([
      p(`<b>${esc(lead)}</b>`, 'font-size:18px'),
      p(esc(body)),
      button(postpone, "I'm fine — postpone"),
      p(`Or ${link(url, 'sign in')}.`),
      p(esc(chain)),
      p(esc(stop)),
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
  /** the person this message is for ("Dear Ragini") */
  recipientName?: string;
  /** the "I have received this" link's token */
  confirmToken?: string;
  /** 1 = the first message; 2 and up are reminders */
  send?: number;
  /** how many reminders there are in all */
  reminders?: number;
  /** the members' copy: the name of the person it went to */
  copyOf?: string;
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

/** The message to one person on the list. Short and calm: what this is, "I have received this", the link, how to sign in, who to call. */
export function familyAlert(i: FamilyAlertInput, o: FamilyAlertOptions = {}): FamilyAlert {
  const owner = i.ownerName.trim() || 'the household';
  const Owner = `${owner.charAt(0).toUpperCase()}${owner.slice(1)}`;
  const url = signInUrl(i.appUrl);
  const locked = i.mode === 'manual' && !i.released;
  const send = Math.max(1, o.send ?? 1);
  const reminder = send > 1;
  const greet = o.recipientName ? `Dear ${o.recipientName},` : 'Hello,';
  const nth = reminder
    ? `Reminder ${send - 1}${o.reminders ? ` of ${o.reminders}` : ''}: nobody has confirmed this message yet.`
    : '';
  const why =
    `This is an automatic message from ${owner}'s family portal. Nobody from the household has signed in to it for ` +
    `${i.daysAbsent} days, so it is sending the message ${owner} asked it to send. It may be nothing, such as a long trip, ` +
    'but please read it.';
  const what =
    `${Owner} kept the family's money records (bank accounts, deposits, investments, insurance) in a private portal, ` +
    'and wrote a family handbook there that tells you what to do, step by step.';
  // a copy for the members never carries the person's link: a member's press must not count as theirs
  const confirm = o.confirmToken && !o.copyOf ? confirmUrl(i.appUrl, o.confirmToken) : '';
  const ask = confirm
    ? `Please let the portal know you have received this: ${confirm} (press "I have received this" on that page). Until someone does, it reminds you and then tells the next person ${owner} chose.`
    : '';
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
    ? 'TEST: this is a test sent only to you. Nobody else received it. Below is exactly what the first person on your list will receive.'
    : o.copyOf
      ? `Copy for the household: sent to ${o.copyOf}${reminder ? ` (reminder ${send - 1}${o.reminders ? ` of ${o.reminders}` : ''})` : ''}. It is the same message without the "I have received this" link, which only ${o.copyOf} can press. Signing in stops any more messages.`
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
    ...(nth ? [nth, ''] : []),
    why,
    '',
    ...(ask ? [ask, ''] : []),
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
    ...(nth ? [p(`<b>${esc(nth)}</b>`)] : []),
    p(esc(why)),
    ...(confirm
      ? [
          button(confirm, 'I have received this'),
          p(
            esc(
              `Until someone presses it, the portal reminds you and then tells the next person ${owner} chose.`,
            ),
            'font-size:14px;color:#4b5565',
          ),
        ]
      : []),
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
    ...(nth ? [nth] : []),
    `This is an automatic message from ${owner}'s family portal: nobody from the household has signed in for ${i.daysAbsent} days.`,
    `${Owner} kept the family's money records there, with a handbook that says what to do, step by step.`,
    ...(confirm ? [`Please confirm you have received this: ${confirm}`] : []),
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
  const subject = `${o.test ? '[TEST] ' : o.copyOf ? 'Copy: ' : ''}${reminder ? 'Reminder: ' : ''}${Owner}'s family portal: how to open the family handbook`;
  return { subject, text, html, chat };
}

/** The note to the members when someone confirmed: the chain stops. */
export function confirmedNote(i: { name: string; at: string; appUrl: string }): InactivityMail {
  const day = niceDate(i.at.slice(0, 10));
  const lead = `${i.name} confirmed on ${day} that they received the message about the family handbook.`;
  const rest = 'Nobody else will be told during this absence.';
  const url = signInUrl(i.appUrl);
  const back = `When you can, sign in to the portal: the next long absence then starts afresh. ${url}`;
  return {
    subject: `${i.name} confirmed the family portal message`,
    text: ['For the record:', '', lead, rest, '', back].join('\n'),
    html: htmlPage([
      p('For the record:'),
      p(`<b>${esc(lead)}</b>`),
      p(esc(rest)),
      p(
        `When you can, ${link(url, 'sign in to the portal')}: the next long absence then starts afresh.`,
      ),
    ]),
  };
}

/** Settings > "Last alert": one line per person told in the latest chain. */
export interface ChainView {
  name: string;
  sends: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
  confirmedAt: string | null;
}

/** The latest chain with names from the current list ("no longer on the list" when a person was removed). */
export function lastChain(
  log: readonly ChainEntry[],
  names: readonly string[],
): { absenceFrom: string; people: ChainView[] } | null {
  if (log.length === 0) return null;
  const latest = log.reduce((a, b) =>
    Date.parse(b.absenceFrom) > Date.parse(a.absenceFrom) ? b : a,
  );
  return {
    absenceFrom: latest.absenceFrom,
    people: chainOf(log, latest.absenceFrom).map((e) => ({
      name: names[e.pos] ?? `Person ${e.pos + 1} (no longer on the list)`,
      sends: e.sends,
      firstSentAt: e.firstSentAt,
      lastSentAt: e.lastSentAt,
      confirmedAt: e.confirmedAt,
    })),
  };
}
