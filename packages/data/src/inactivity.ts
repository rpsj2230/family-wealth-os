import type { SupabaseClient } from '@supabase/supabase-js';
import {
  alertContactsFromJson,
  DEFAULT_REMIND_EVERY,
  DEFAULT_REMINDERS,
  DEFAULT_WARN_DAYS,
  DEFAULT_WARN_EVERY,
  profileFromJson,
  type ChainEntry,
  type FamilyAlertInput,
  type InactivityMode,
  type StoredAlertContact,
} from '@fwos/core';
import type { InactivityStore } from '@fwos/ingest';
import { columnExists } from './columns';

/**
 * The inactivity alert's data (packages/core/src/inactivity-alert.ts): the emergency_access row with its newer columns, this
 * household's emergency_alert_log, and the facts the family's message needs (who kept the records, the family login, where the
 * password is kept, whom to call first). Every read names the household, so the same code works through a member's client
 * (Settings) and the daily job's service-role client; only the job writes the log.
 */

export interface InactivityRow {
  householdId: string;
  mode: InactivityMode;
  inactiveDays: number;
  warnDays: number;
  warnEveryDays: number;
  reminders: number;
  remindEveryDays: number;
  released: boolean;
  /** exactly as the database returned it: the conditional updates compare with it */
  lastMemberSeen: string;
  warnedAt: string | null;
  alertedAt: string | null;
  /** with the WhatsApp keys: server code only */
  contacts: StoredAlertContact[];
}

export const INACTIVITY_COLUMNS =
  'household_id, mode, inactive_days, released, last_member_seen, warn_days, warn_every_days, reminders, remind_every_days, alert_contacts, warned_at, alerted_at';

/** Whether the database update that adds the inactivity alert (20261030000100_emergency_guide.sql) has been applied. */
export async function inactivityReady(db: SupabaseClient): Promise<boolean> {
  for (const [t, c] of [
    ['emergency_access', 'alert_contacts'],
    ['emergency_access', 'warn_every_days'],
    ['emergency_access', 'remind_every_days'],
    ['emergency_alert_log', 'token_hash'],
  ] as const)
    if (!(await columnExists(db, t, c))) return false;
  return true;
}

const MODES: readonly InactivityMode[] = ['always', 'inactive', 'manual'];

export function inactivityRowOf(r: Record<string, unknown>): InactivityRow {
  const n = (v: unknown, d: number) =>
    v !== null && v !== undefined && Number.isFinite(Number(v)) ? Number(v) : d;
  const t = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    householdId: String(r.household_id ?? ''),
    mode: MODES.find((m) => m === r.mode) ?? 'always',
    inactiveDays: n(r.inactive_days, 30),
    warnDays: n(r.warn_days, DEFAULT_WARN_DAYS),
    warnEveryDays: n(r.warn_every_days, DEFAULT_WARN_EVERY),
    reminders: n(r.reminders, DEFAULT_REMINDERS),
    remindEveryDays: n(r.remind_every_days, DEFAULT_REMIND_EVERY),
    released: r.released === true,
    lastMemberSeen: t(r.last_member_seen) ?? new Date().toISOString(),
    warnedAt: t(r.warned_at),
    alertedAt: t(r.alerted_at),
    contacts: alertContactsFromJson(r.alert_contacts),
  };
}

/** One household's row, or null when it has none yet (ask `inactivityReady` first). */
export async function loadInactivityRow(
  db: SupabaseClient,
  householdId: string,
): Promise<InactivityRow | null> {
  const r = await db
    .from('emergency_access')
    .select(INACTIVITY_COLUMNS)
    .eq('household_id', householdId)
    .limit(1);
  if (r.error) throw new Error(`emergency_access: ${r.error.message}`);
  const row = (r.data as unknown as Record<string, unknown>[] | null)?.[0];
  return row ? inactivityRowOf(row) : null;
}

export function chainEntryOf(r: Record<string, unknown>): ChainEntry {
  const t = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    absenceFrom: String(r.absence_from ?? ''),
    pos: Number(r.contact_pos ?? 0),
    sends: Number(r.sends ?? 0),
    firstSentAt: t(r.first_sent_at),
    lastSentAt: t(r.last_sent_at),
    confirmedAt: t(r.confirmed_at),
  };
}

/** The household's emergency_alert_log, newest absences first (members may read it; the hashes are not selected). */
export async function loadAlertLog(
  db: SupabaseClient,
  householdId: string,
  limit = 60,
): Promise<ChainEntry[]> {
  const r = await db
    .from('emergency_alert_log')
    .select('absence_from, contact_pos, sends, first_sent_at, last_sent_at, confirmed_at')
    .eq('household_id', householdId)
    .order('absence_from', { ascending: false })
    .limit(limit);
  if (r.error) throw new Error(`emergency_alert_log: ${r.error.message}`);
  return ((r.data ?? []) as Record<string, unknown>[]).map(chainEntryOf);
}

export type AlertFacts = Pick<
  FamilyAlertInput,
  'ownerName' | 'familyLogins' | 'passwordWhere' | 'callFirst' | 'releaseBy'
>;

/**
 * What the family's message says besides the link. `loginEmails` turns user ids into e-mail addresses (only the service role can,
 * through auth.admin); without it the message says "the family login … set up for you".
 */
export async function loadAlertFacts(
  db: SupabaseClient,
  householdId: string,
  opts: { loginEmails?: (userIds: string[]) => Promise<string[]> } = {},
): Promise<AlertFacts> {
  const [hh, owners, profile, viewers] = await Promise.all([
    db.from('households').select('name').eq('id', householdId).limit(1),
    db
      .from('owners')
      .select('display_name, plan_role, is_minor')
      .eq('household_id', householdId)
      .order('created_at'),
    db.from('emergency_profile').select('content').eq('household_id', householdId).limit(1),
    db
      .from('household_members')
      .select('user_id')
      .eq('household_id', householdId)
      .eq('role', 'emergency_viewer'),
  ]);
  const people = (
    (owners.data ?? []) as {
      display_name: string | null;
      plan_role: string | null;
      is_minor: boolean | null;
    }[]
  )
    .filter((o) => !o.is_minor && o.display_name?.trim())
    .map((o) => ({ name: o.display_name!.trim(), role: o.plan_role }));
  const householdName = ((hh.data ?? []) as { name: string | null }[])[0]?.name?.trim() ?? '';
  const ownerName =
    people.find((o) => o.role === 'primary')?.name ?? people[0]?.name ?? householdName;
  const p = profileFromJson(((profile.data ?? []) as { content: unknown }[])[0]?.content);
  const first = p.contacts[0];
  const ids = ((viewers.data ?? []) as { user_id: string }[]).map((v) => v.user_id);
  const logins = ids.length && opts.loginEmails ? await opts.loginEmails(ids) : [];
  return {
    ownerName,
    familyLogins: [...new Set(logins.map((e) => e.trim().toLowerCase()).filter(Boolean))],
    passwordWhere: p.passwordManager,
    callFirst: first ? { name: first.name, relation: first.relation, phone: first.phone } : null,
    releaseBy: people.map((o) => o.name),
  };
}

/** How many read-only family logins the household has (Settings warns when there is none: the family could not sign in). */
export async function countFamilyLogins(db: SupabaseClient, householdId: string): Promise<number> {
  const r = await db
    .from('household_members')
    .select('user_id')
    .eq('household_id', householdId)
    .eq('role', 'emergency_viewer');
  return r.error ? 0 : (r.data ?? []).length;
}

/**
 * The daily job's store over the service-role client. `memberEmails` and `loginEmails` come from the job (auth.admin), as the
 * digest finds its recipients. Every write is conditional, so two runs cannot both send.
 */
export function supabaseInactivityStore(
  db: SupabaseClient,
  auth: {
    memberEmails(householdId: string): Promise<string[]>;
    loginEmails(userIds: string[]): Promise<string[]>;
  },
): InactivityStore {
  const fail = (what: string, e: { message: string } | null) => {
    if (e) throw new Error(`${what}: ${e.message}`);
  };
  return {
    async rows() {
      const r = await db.from('emergency_access').select(INACTIVITY_COLUMNS);
      fail('emergency_access', r.error);
      return ((r.data ?? []) as unknown as Record<string, unknown>[]).map(inactivityRowOf);
    },
    chain: (h) => loadAlertLog(db, h),
    memberEmails: (h) => auth.memberEmails(h),
    facts: (h) => loadAlertFacts(db, h, { loginEmails: auth.loginEmails }),
    async claimWarn(h, seen, prev, at, postponeHash) {
      let q = db
        .from('emergency_access')
        .update({ warned_at: at, postpone_token_hash: postponeHash })
        .eq('household_id', h)
        .eq('last_member_seen', seen);
      q = prev === null ? q.is('warned_at', null) : q.eq('warned_at', prev);
      const r = await q.select('household_id');
      fail('claim warning', r.error);
      return (r.data ?? []).length === 1;
    },
    async unclaimWarn(h, at, prev) {
      const r = await db
        .from('emergency_access')
        .update({ warned_at: prev })
        .eq('household_id', h)
        .eq('warned_at', at);
      fail('take back warning', r.error);
    },
    async startPerson(h, absenceFrom, pos, tokenHash, at) {
      const r = await db.from('emergency_alert_log').insert({
        household_id: h,
        absence_from: absenceFrom,
        contact_pos: pos,
        sends: 1,
        first_sent_at: at,
        last_sent_at: at,
        token_hash: tokenHash,
      });
      if (r.error?.code === '23505') return false;
      fail('alert log', r.error);
      return true;
    },
    async remindPerson(h, absenceFrom, pos, fromSends, tokenHash, at) {
      const r = await db
        .from('emergency_alert_log')
        .update({ sends: fromSends + 1, last_sent_at: at, token_hash: tokenHash })
        .eq('household_id', h)
        .eq('absence_from', absenceFrom)
        .eq('contact_pos', pos)
        .eq('sends', fromSends)
        .is('confirmed_at', null)
        .select('contact_pos');
      fail('alert log', r.error);
      return (r.data ?? []).length === 1;
    },
    async close(h, seen, at) {
      const r = await db
        .from('emergency_access')
        .update({ alerted_at: at })
        .eq('household_id', h)
        .eq('last_member_seen', seen)
        .select('household_id');
      fail('close chain', r.error);
      return (r.data ?? []).length === 1;
    },
  };
}
