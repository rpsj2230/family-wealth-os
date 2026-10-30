/**
 * The inactivity alert in the daily job (docs/USER-GUIDE.md, "If you stop using the portal"). For every household with an
 * emergency_access row it asks core `inactivityStep` for today's one step and carries it out:
 *
 * - warn: one e-mail to the members with an "I'm fine — postpone" link (its hash is stored first, with warned_at).
 * - tell: one message to one person on the list (e-mail when they have an address, WhatsApp when they activated it), with their
 *   "I have received this" link; the first message to each person is recorded in emergency_alert_log before it is sent, each
 *   reminder adds one to `sends`. The members get a copy of each person's first message.
 * - confirmed: a short note to the members, then the chain is closed (alerted_at).
 * - exhausted: the chain is closed and the log says "nobody confirmed".
 *
 * Recording comes before sending and is conditional, so a second run on the same day finds the step done and sends nothing. A message
 * that could not be delivered still counts as that person's message (they are reminded as usual), so a broken address never
 * stops the chain; only the owner's warning is taken back on failure and tried again next run.
 *
 * The log carries counts only ("inactivity: chain step=remind pos=1 sends=2"): never a name, an address, a number, a key, a token,
 * or a provider's error text (which can repeat an address). With `dryRun` it decides and logs, and records and sends nothing.
 */
import {
  daysAbsent,
  confirmedNote,
  familyAlert,
  inactivityStep,
  inactivityWarning,
  runDateAfter,
  type ChainEntry,
  type FamilyAlertInput,
  type InactivityMode,
  type InactivityStep,
  type StoredAlertContact,
} from '@fwos/core';
import { chainToken, hashToken, newToken } from './alert-tokens';

export interface InactivityRunRow {
  householdId: string;
  mode: InactivityMode;
  inactiveDays: number;
  warnDays: number;
  reminders: number;
  remindEveryDays: number;
  released: boolean;
  lastMemberSeen: string;
  warnedAt: string | null;
  alertedAt: string | null;
  contacts: StoredAlertContact[];
}

export type InactivityFacts = Pick<
  FamilyAlertInput,
  'ownerName' | 'familyLogins' | 'passwordWhere' | 'callFirst' | 'releaseBy'
>;

export interface InactivityStore {
  rows(): Promise<InactivityRunRow[]>;
  /** the household's emergency_alert_log entries (any absence; core keeps this absence's) */
  chain(householdId: string): Promise<ChainEntry[]>;
  memberEmails(householdId: string): Promise<string[]>;
  facts(householdId: string): Promise<InactivityFacts>;
  /** warned_at = at and the postpone link's hash, only while warned_at is empty and the last visit is still `seen` */
  claimWarn(householdId: string, seen: string, at: string, postponeHash: string): Promise<boolean>;
  /** takes the warning back (it could not be sent), so the next run tries again */
  unclaimWarn(householdId: string, at: string): Promise<void>;
  /** the first message to a person: a new log entry (sends 1); false when it exists already */
  startPerson(
    householdId: string,
    absenceFrom: string,
    pos: number,
    tokenHash: string,
    at: string,
  ): Promise<boolean>;
  /** a reminder: sends = fromSends + 1, only while sends is still fromSends and nobody confirmed */
  remindPerson(
    householdId: string,
    absenceFrom: string,
    pos: number,
    fromSends: number,
    tokenHash: string,
    at: string,
  ): Promise<boolean>;
  /** alerted_at = at: this absence's chain is over (only while the last visit is still `seen`) */
  close(householdId: string, seen: string, at: string): Promise<boolean>;
}

export interface InactivityMailer {
  send(m: { to: string[]; subject: string; text: string; html: string }): Promise<unknown>;
}

/** One channel to one person (e-mail, WhatsApp; Telegram or SMS can be added later). */
export interface AlertChannel {
  /** "email", "whatsapp", … (used in counts only) */
  readonly name: string;
  /** whether this person can be reached this way */
  reaches(c: StoredAlertContact): boolean;
  send(c: StoredAlertContact, m: ReturnType<typeof familyAlert>): Promise<boolean>;
}

/** E-mail through the job's mailer: every person who has an address. */
export function emailChannel(mailer: InactivityMailer): AlertChannel {
  return {
    name: 'email',
    reaches: (c) => !!c.email,
    async send(c, m) {
      try {
        await mailer.send({ to: [c.email], subject: m.subject, text: m.text, html: m.html });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** WhatsApp through a sender (CallMeBot): every person with a number and a key. */
export function whatsappChannel(sender: {
  send(to: { phone: string; key: string }, text: string): Promise<{ ok: boolean }>;
}): AlertChannel {
  return {
    name: 'whatsapp',
    reaches: (c) => !!c.phone && !!c.whatsappKey,
    async send(c, m) {
      const r = await sender.send({ phone: c.phone, key: c.whatsappKey }, m.chat).catch(() => null);
      return !!r?.ok;
    },
  };
}

export interface InactivityOutcome {
  householdId: string;
  step: InactivityStep['kind'] | 'first' | 'remind' | 'error';
  /** position in the list (tell, confirmed) */
  pos?: number;
  /** messages accepted by a provider on this run */
  sends: number;
  /** messages that could not be sent */
  failed: number;
  note: 'done' | 'dry_run' | 'already_done' | 'not_sent' | 'nobody_confirmed' | 'error';
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const clean = (es: string[]) => [
  ...new Set(es.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e))),
];

export interface InactivityOptions {
  now: string;
  appUrl: string;
  /** the secret the confirmation links are derived from (at least 16 characters) */
  linkSecret: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function runInactivity(
  store: InactivityStore,
  deps: { mailer: InactivityMailer; channels: AlertChannel[] },
  opts: InactivityOptions,
): Promise<InactivityOutcome[]> {
  const log = opts.log ?? (() => {});
  const out: InactivityOutcome[] = [];
  for (const row of await store.rows()) {
    const o = await runOne(store, deps, opts, row).catch(
      (): InactivityOutcome => ({
        householdId: row.householdId,
        step: 'error',
        sends: 0,
        failed: 0,
        note: 'error',
      }),
    );
    out.push(o);
    log(lineOf(o));
  }
  return out;
}

/** The one log line for a household: counts only. */
export function lineOf(o: InactivityOutcome): string {
  if (o.note === 'error') return 'inactivity: could not be checked for one household';
  if (o.step === 'none') return 'inactivity: none';
  const pos = o.pos === undefined ? '' : ` pos=${o.pos}`;
  const head = o.step === 'warn' ? 'inactivity: warn' : `inactivity: chain step=${o.step}${pos}`;
  const tail =
    o.note === 'dry_run'
      ? ' (dry run: nothing sent or recorded)'
      : o.note === 'already_done'
        ? ' (already done by another run)'
        : o.note === 'nobody_confirmed'
          ? ' nobody confirmed'
          : o.note === 'not_sent'
            ? ' not sent; tried again next run'
            : '';
  return `${head} sends=${o.sends}${o.failed ? ` failed=${o.failed}` : ''}${tail}`;
}

async function runOne(
  store: InactivityStore,
  deps: { mailer: InactivityMailer; channels: AlertChannel[] },
  opts: InactivityOptions,
  row: InactivityRunRow,
): Promise<InactivityOutcome> {
  const h = row.householdId;
  const seen = row.lastMemberSeen;
  const log = row.contacts.length > 0 ? await store.chain(h) : [];
  const step = inactivityStep(
    {
      lastMemberSeen: seen,
      warnDays: row.warnDays,
      alertDays: row.inactiveDays,
      reminders: row.reminders,
      remindEveryDays: row.remindEveryDays,
      warnedAt: row.warnedAt,
      alertedAt: row.alertedAt,
      contacts: row.contacts.length,
      now: opts.now,
    },
    log,
  );
  const base = { householdId: h, sends: 0, failed: 0 };
  if (step.kind === 'none') return { ...base, step: 'none', note: 'done' };
  const days = daysAbsent(seen, opts.now);

  if (step.kind === 'warn') {
    if (opts.dryRun) return { ...base, step: 'warn', note: 'dry_run' };
    const members = clean(await store.memberEmails(h));
    if (members.length === 0) return { ...base, step: 'warn', failed: 1, note: 'not_sent' };
    const token = newToken();
    if (!(await store.claimWarn(h, seen, opts.now, hashToken(token))))
      return { ...base, step: 'warn', note: 'already_done' };
    const m = inactivityWarning({
      daysAbsent: days,
      alertDate: runDateAfter(seen, row.inactiveDays),
      contactNames: row.contacts.map((c) => c.name),
      reminders: row.reminders,
      remindEveryDays: row.remindEveryDays,
      appUrl: opts.appUrl,
      postponeToken: token,
    });
    try {
      await deps.mailer.send({ to: members, ...m });
      return { ...base, step: 'warn', sends: members.length, note: 'done' };
    } catch {
      await store.unclaimWarn(h, opts.now);
      return { ...base, step: 'warn', failed: 1, note: 'not_sent' };
    }
  }

  if (step.kind === 'exhausted') {
    if (opts.dryRun) return { ...base, step: 'exhausted', note: 'dry_run' };
    await store.close(h, seen, opts.now);
    return { ...base, step: 'exhausted', note: 'nobody_confirmed' };
  }

  if (step.kind === 'confirmed') {
    if (opts.dryRun) return { ...base, step: 'confirmed', pos: step.pos, note: 'dry_run' };
    const members = clean(await store.memberEmails(h));
    const name = row.contacts[step.pos]?.name ?? 'Someone on your list';
    let sends = 0;
    if (members.length > 0) {
      try {
        await deps.mailer.send({
          to: members,
          ...confirmedNote({ name, at: step.at, appUrl: opts.appUrl }),
        });
        sends = members.length;
      } catch {
        // the chain stays open for the note alone: the next run tries the note again and sends nobody else anything
        return { ...base, step: 'confirmed', pos: step.pos, failed: 1, note: 'not_sent' };
      }
    }
    await store.close(h, seen, opts.now);
    return { ...base, step: 'confirmed', pos: step.pos, sends, note: 'done' };
  }

  // tell: the first message to a person, or a reminder
  const kind = step.send === 1 ? 'first' : 'remind';
  const person = row.contacts[step.pos];
  if (!person) return { ...base, step: kind, pos: step.pos, note: 'not_sent' };
  if (opts.dryRun) return { ...base, step: kind, pos: step.pos, note: 'dry_run' };
  const token = chainToken(opts.linkSecret, h, seen, step.pos);
  const recorded =
    step.send === 1
      ? await store.startPerson(h, seen, step.pos, hashToken(token), opts.now)
      : await store.remindPerson(h, seen, step.pos, step.send - 1, hashToken(token), opts.now);
  if (!recorded) return { ...base, step: kind, pos: step.pos, note: 'already_done' };
  const input: FamilyAlertInput = {
    ...(await store.facts(h)),
    appUrl: opts.appUrl,
    mode: row.mode,
    released: row.released,
    daysAbsent: days,
  };
  const msg = familyAlert(input, {
    recipientName: person.name,
    confirmToken: token,
    send: step.send,
    reminders: row.reminders,
    emailToo: !!person.email,
  });
  let sends = 0;
  let failed = 0;
  const ways = deps.channels.filter((c) => c.reaches(person));
  for (const ch of ways) {
    if (await ch.send(person, msg)) sends++;
    else failed++;
  }
  if (ways.length === 0) failed++;
  // the members' copy of each person's first message (never with the person's link: a member's press must not count as theirs)
  if (step.send === 1) {
    const copyTo = clean(await store.memberEmails(h)).filter((e) => e !== person.email);
    if (copyTo.length > 0) {
      const copy = familyAlert(input, { copyOf: person.name, send: 1, reminders: row.reminders });
      try {
        await deps.mailer.send({ to: copyTo, subject: copy.subject, text: copy.text, html: copy.html });
        sends += copyTo.length;
      } catch {
        failed++;
      }
    }
  }
  return { ...base, step: kind, pos: step.pos, sends, failed, note: 'done' };
}
