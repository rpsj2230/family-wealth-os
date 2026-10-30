/**
 * The inactivity alert in the daily job (docs/USER-GUIDE.md, "If you stop using the portal"). For every household with an
 * emergency_access row: decide (core `inactivityDecision`), stamp warned_at / alerted_at first so a second run cannot send twice,
 * send, and take the stamp back when nothing could be sent so tomorrow's run tries again.
 *
 * The log says only "inactivity: none", "inactivity: warn sent to N" or "inactivity: alert sent to N" (plus "N not sent"):
 * never a name, an e-mail address, a phone number or a key, and never a provider's error text (which can repeat an address).
 * With `dryRun` it decides and counts, and sends and stamps nothing.
 */
import {
  alertDueDate,
  daysAbsent,
  familyAlert,
  inactivityDecision,
  inactivityWarning,
  type FamilyAlertInput,
  type InactivityDecision,
  type InactivityMode,
  type StoredAlertContact,
} from '@fwos/core';
import type { WhatsAppSender } from './whatsapp';

export interface InactivityRunRow {
  householdId: string;
  mode: InactivityMode;
  inactiveDays: number;
  warnDays: number;
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
  memberEmails(householdId: string): Promise<string[]>;
  facts(householdId: string): Promise<InactivityFacts>;
  /**
   * Sets warned_at (kind 'warn') or alerted_at (kind 'alert', and warned_at when empty) to `at`, only while that stamp is empty and
   * the last visit is still `lastMemberSeen`. False when another run or a member's visit came first: then nothing is sent.
   */
  claim(
    householdId: string,
    kind: 'warn' | 'alert',
    lastMemberSeen: string,
    at: string,
  ): Promise<boolean>;
  /** Takes back a claim whose messages all failed, so the next run tries again. */
  unclaim(householdId: string, kind: 'warn' | 'alert', at: string): Promise<void>;
}

export interface InactivityMailer {
  send(m: { to: string[]; subject: string; text: string; html: string }): Promise<unknown>;
}

export interface InactivityOutcome {
  householdId: string;
  decision: InactivityDecision;
  /** people and addresses reached */
  sent: number;
  /** messages that could not be sent */
  failed: number;
  /** what happened in words, without personal data */
  note: 'none' | 'sent' | 'dry_run' | 'already_sent' | 'nobody_reached' | 'failed';
}

const EMAIL = /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/;
const clean = (es: string[]) => [
  ...new Set(es.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL.test(e))),
];

export async function runInactivity(
  store: InactivityStore,
  deps: { mailer: InactivityMailer; whatsapp: WhatsAppSender | null },
  opts: { now: string; appUrl: string; dryRun?: boolean; log?: (line: string) => void },
): Promise<InactivityOutcome[]> {
  const log = opts.log ?? (() => {});
  const out: InactivityOutcome[] = [];
  for (const row of await store.rows()) {
    const o = await runOne(store, deps, opts, row).catch(
      (): InactivityOutcome => ({
        householdId: row.householdId,
        decision: 'none',
        sent: 0,
        failed: 1,
        note: 'failed',
      }),
    );
    out.push(o);
    log(lineOf(o));
  }
  return out;
}

/** The one log line for a household. */
export function lineOf(o: InactivityOutcome): string {
  const miss = o.failed > 0 ? `, ${o.failed} not sent` : '';
  switch (o.note) {
    case 'none':
      return 'inactivity: none';
    case 'already_sent':
      return 'inactivity: none (already sent)';
    case 'dry_run':
      return `inactivity: ${o.decision} would be sent to ${o.sent} (dry run: nothing sent or stamped)`;
    case 'nobody_reached':
      return `inactivity: ${o.decision} not sent${miss}; it is tried again on the next run`;
    case 'failed':
      return 'inactivity: could not be checked for one household';
    default:
      return `inactivity: ${o.decision} sent to ${o.sent}${miss}`;
  }
}

async function runOne(
  store: InactivityStore,
  deps: { mailer: InactivityMailer; whatsapp: WhatsAppSender | null },
  opts: { now: string; appUrl: string; dryRun?: boolean },
  row: InactivityRunRow,
): Promise<InactivityOutcome> {
  const decision = inactivityDecision({
    lastMemberSeen: row.lastMemberSeen,
    warnDays: row.warnDays,
    alertDays: row.inactiveDays,
    warnedAt: row.warnedAt,
    alertedAt: row.alertedAt,
    mode: row.mode,
    released: row.released,
    now: opts.now,
    contacts: row.contacts.length,
  });
  const base = { householdId: row.householdId, decision, sent: 0, failed: 0 };
  if (decision === 'none') return { ...base, note: 'none' };
  const members = clean(await store.memberEmails(row.householdId));
  const days = daysAbsent(row.lastMemberSeen, opts.now);

  if (decision === 'warn') {
    if (opts.dryRun) return { ...base, sent: members.length, note: 'dry_run' };
    if (members.length === 0) return { ...base, failed: 1, note: 'nobody_reached' };
    if (!(await store.claim(row.householdId, 'warn', row.lastMemberSeen, opts.now)))
      return { ...base, note: 'already_sent' };
    const m = inactivityWarning({
      daysAbsent: days,
      alertDate: alertDueDate(row.lastMemberSeen, row.inactiveDays),
      contactNames: row.contacts.map((c) => c.name),
      appUrl: opts.appUrl,
    });
    try {
      await deps.mailer.send({ to: members, ...m });
      return { ...base, sent: members.length, note: 'sent' };
    } catch {
      await store.unclaim(row.householdId, 'warn', opts.now);
      return { ...base, failed: 1, note: 'nobody_reached' };
    }
  }

  // the alert: each person on their own (nobody sees another's address), then one copy to the members
  const contacts = row.contacts;
  const reachable = contacts.filter((c) => c.email || (c.phone && c.whatsappKey && deps.whatsapp));
  const contactEmails = new Set(contacts.map((c) => c.email).filter(Boolean));
  const copyTo = members.filter((e) => !contactEmails.has(e));
  if (opts.dryRun) return { ...base, sent: reachable.length + copyTo.length, note: 'dry_run' };
  if (reachable.length === 0) return { ...base, failed: contacts.length, note: 'nobody_reached' };
  if (!(await store.claim(row.householdId, 'alert', row.lastMemberSeen, opts.now)))
    return { ...base, note: 'already_sent' };
  const facts = await store.facts(row.householdId);
  const input: FamilyAlertInput = {
    ...facts,
    appUrl: opts.appUrl,
    mode: row.mode,
    released: row.released,
    daysAbsent: days,
  };
  let reached = 0;
  let failed = 0;
  const told: string[] = [];
  for (const c of contacts) {
    const msg = familyAlert(input, { recipientName: c.name, emailToo: !!c.email });
    let ok = false;
    if (c.email) {
      try {
        await deps.mailer.send({ to: [c.email], subject: msg.subject, text: msg.text, html: msg.html });
        ok = true;
      } catch {
        failed++;
      }
    }
    if (c.phone && c.whatsappKey && deps.whatsapp) {
      const r = await deps.whatsapp
        .send({ phone: c.phone, key: c.whatsappKey }, msg.chat)
        .catch(() => ({ ok: false }));
      if (r.ok) ok = true;
      else failed++;
    }
    if (ok) {
      reached++;
      told.push(c.name);
    }
  }
  if (reached === 0) {
    await store.unclaim(row.householdId, 'alert', opts.now);
    return { ...base, failed, note: 'nobody_reached' };
  }
  if (copyTo.length > 0) {
    const copy = familyAlert(input, { copyOf: told });
    try {
      await deps.mailer.send({ to: copyTo, subject: copy.subject, text: copy.text, html: copy.html });
      reached += copyTo.length;
    } catch {
      failed++;
    }
  }
  return { ...base, sent: reached, failed, note: 'sent' };
}
