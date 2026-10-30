/**
 * The inactivity alert in the daily job (docs/USER-GUIDE.md, "If you stop using the portal"). For every household with an
 * emergency_access row it asks core `inactivityStep` for today's one step and carries it out:
 *
 * - warn: an e-mail to the members with an "I'm fine — postpone" link, from warn_days every warn_every_days until the first
 *   trusted person is told. warned_at is the last warning; the link's hash is stored with it.
 * - tell: one message to one trusted person (an e-mail when they have an address, WhatsApp when they activated it), with their
 *   "I have received this" link. The first message to each person is recorded in emergency_alert_log before it is sent, each
 *   reminder adds one to `sends`. Every such message also goes to the members as a separate copy, headed "Copy for the household:
 *   sent to <name> (reminder 2 of 3)" and without the confirmation link (a member pressing it must not count as the person).
 *   A member who is also that trusted person gets the person's own e-mail only.
 * - confirmed: a short note to the members, then the chain is closed (alerted_at).
 * - exhausted: the chain is closed and the log says "nobody confirmed".
 *
 * Links: tokens are derived (alert-tokens.ts), so every warning and reminder of one absence carries a working link and only hashes
 * are stored. Recording comes before sending and is conditional, so a second run on the same day finds the step done and sends
 * nothing. A message to a trusted person that could not be delivered still counts as theirs (they are reminded as usual), so a
 * broken address never stops the chain; only the owner's warning is taken back on failure and tried again next run.
 *
 * The log carries counts only ("inactivity: chain step=remind pos=1 sends=2"): never a name, an address, a number, a key, a token,
 * or a provider's error text (which can repeat an address). With `dryRun` it decides and logs, and records and sends nothing.
 */
import {
  confirmedNote,
  daysAbsent,
  familyAlert,
  inactivityStep,
  inactivityWarning,
  runDateAfter,
  runDaysBetween,
  type ChainEntry,
  type FamilyAlert,
  type FamilyAlertInput,
  type InactivityMode,
  type InactivityStep,
  type StoredAlertContact,
} from '@fwos/core';
import { alertLinkKey, alertToken, hashToken } from './alert-tokens';

export interface InactivityRunRow {
  householdId: string;
  mode: InactivityMode;
  inactiveDays: number;
  warnDays: number;
  warnEveryDays: number;
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
  /**
   * warned_at = at and the postpone link's hash, only while warned_at is still `prevWarnedAt` (null: empty) and the last visit is
   * still `seen`. False when another run or a member's visit came first.
   */
  claimWarn(
    householdId: string,
    seen: string,
    prevWarnedAt: string | null,
    at: string,
    postponeHash: string,
  ): Promise<boolean>;
  /** puts warned_at back to `prevWarnedAt` (the warning could not be sent), so the next run tries again */
  unclaimWarn(householdId: string, at: string, prevWarnedAt: string | null): Promise<void>;
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

/** One way to reach a trusted person: e-mail, WhatsApp; Telegram or SMS can be added later with the same shape. */
export interface AlertChannel {
  /** "email", "whatsapp", … */
  readonly name: string;
  /** whether this person can be reached this way */
  reaches(c: StoredAlertContact): boolean;
  /** true when the provider accepted the message; never throws */
  send(c: StoredAlertContact, m: FamilyAlert): Promise<boolean>;
}

/** E-mail through the job's mailer, to every person who has an address. */
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

/** WhatsApp through a sender (CallMeBot), to every person with a number and a key. Only the trusted person, never the members. */
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
  step: 'none' | 'warn' | 'first' | 'remind' | 'confirmed' | 'exhausted' | 'error';
  /** position in the list (first, remind, confirmed) */
  pos?: number;
  /** messages accepted by a provider on this run (one per address or number) */
  sends: number;
  /** messages that could not be sent */
  failed: number;
  note: 'done' | 'dry_run' | 'already_done' | 'not_sent' | 'nobody_confirmed' | 'error';
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
/** Valid addresses, lower case, each once; members without an address are skipped. */
export const cleanEmails = (es: readonly string[]): string[] => [
  ...new Set(es.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e))),
];

export interface InactivityOptions {
  now: string;
  appUrl: string;
  /** a server secret the job already has (the service-role key); the link key is derived from it */
  serverSecret: string;
  dryRun?: boolean;
  log?: (line: string) => void;
}

export async function runInactivity(
  store: InactivityStore,
  deps: { mailer: InactivityMailer; channels: AlertChannel[] },
  opts: InactivityOptions,
): Promise<InactivityOutcome[]> {
  const log = opts.log ?? (() => {});
  const key = alertLinkKey(opts.serverSecret);
  const out: InactivityOutcome[] = [];
  for (const row of await store.rows()) {
    const o = await runOne(store, deps, opts, key, row).catch((): InactivityOutcome => ({
      householdId: row.householdId,
      step: 'error',
      sends: 0,
      failed: 0,
      note: 'error',
    }));
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
  key: Buffer,
  row: InactivityRunRow,
): Promise<InactivityOutcome> {
  const h = row.householdId;
  const seen = row.lastMemberSeen;
  const log = row.contacts.length > 0 ? await store.chain(h) : [];
  const step: InactivityStep = inactivityStep(
    {
      lastMemberSeen: seen,
      warnDays: row.warnDays,
      warnEveryDays: row.warnEveryDays,
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
    const members = cleanEmails(await store.memberEmails(h));
    if (members.length === 0) return { ...base, step: 'warn', failed: 1, note: 'not_sent' };
    const token = alertToken(key, 'postpone', h, seen, -1);
    const prev = row.warnedAt;
    // a warning from an earlier absence counts as none: the claim compares with what is stored
    if (!(await store.claimWarn(h, seen, prev, opts.now, hashToken(token))))
      return { ...base, step: 'warn', note: 'already_done' };
    const alertDate = runDateAfter(seen, row.inactiveDays);
    const m = inactivityWarning({
      daysAbsent: days,
      daysLeft: runDaysBetween(opts.now.slice(0, 10), alertDate),
      alertDate,
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
      await store.unclaimWarn(h, opts.now, prev);
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
    const members = cleanEmails(await store.memberEmails(h));
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
  const token = alertToken(key, 'confirm', h, seen, step.pos);
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
  const shape = { send: step.send, reminders: row.reminders };
  const msg = familyAlert(input, {
    ...shape,
    recipientName: person.name,
    confirmToken: token,
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
  // every message to a trusted person also goes to the members, as a copy without the confirmation link
  const copyTo = cleanEmails(await store.memberEmails(h)).filter((e) => e !== person.email);
  if (copyTo.length > 0) {
    const copy = familyAlert(input, { ...shape, copyOf: person.name });
    try {
      await deps.mailer.send({
        to: copyTo,
        subject: copy.subject,
        text: copy.text,
        html: copy.html,
      });
      sends += copyTo.length;
    } catch {
      failed++;
    }
  }
  return { ...base, step: kind, pos: step.pos, sends, failed, note: 'done' };
}
