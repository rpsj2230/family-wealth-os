import type { SupabaseClient } from '@supabase/supabase-js';
import {
  alertContactsFromJson,
  DEFAULT_WARN_DAYS,
  profileFromJson,
  type FamilyAlertInput,
  type InactivityMode,
  type StoredAlertContact,
} from '@fwos/core';
import { columnExists } from './columns';

/**
 * The inactivity alert's data (packages/core/src/inactivity-alert.ts): the emergency_access row with its newer columns, and the
 * facts the family's message needs (who kept the records, the family login, where the password is kept, whom to call first).
 * Every read names the household, so the same code works through a member's client (Settings > "Send a test") and the daily job's
 * service-role client.
 */

export interface InactivityRow {
  householdId: string;
  mode: InactivityMode;
  inactiveDays: number;
  warnDays: number;
  released: boolean;
  lastMemberSeen: string;
  warnedAt: string | null;
  alertedAt: string | null;
  /** with the WhatsApp keys: server code only */
  contacts: StoredAlertContact[];
}

export const INACTIVITY_COLUMNS =
  'household_id, mode, inactive_days, released, last_member_seen, warn_days, alert_contacts, warned_at, alerted_at';

/** Whether the database update that adds the inactivity alert (20261030000100_emergency_guide.sql) has been applied. */
export async function inactivityReady(db: SupabaseClient): Promise<boolean> {
  return (
    (await columnExists(db, 'emergency_access', 'alert_contacts')) &&
    (await columnExists(db, 'emergency_access', 'warn_days')) &&
    (await columnExists(db, 'emergency_access', 'alerted_at'))
  );
}

const MODES: readonly InactivityMode[] = ['always', 'inactive', 'manual'];

export function inactivityRowOf(r: Record<string, unknown>): InactivityRow {
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) && v !== null ? Number(v) : d);
  const t = (v: unknown) => (typeof v === 'string' && v ? v : null);
  return {
    householdId: String(r.household_id ?? ''),
    mode: MODES.find((m) => m === r.mode) ?? 'always',
    inactiveDays: n(r.inactive_days, 30),
    warnDays: n(r.warn_days, DEFAULT_WARN_DAYS),
    released: r.released === true,
    lastMemberSeen: t(r.last_member_seen) ?? new Date().toISOString(),
    warnedAt: t(r.warned_at),
    alertedAt: t(r.alerted_at),
    contacts: alertContactsFromJson(r.alert_contacts),
  };
}

/** One household's row, or null when it has none yet (or the columns are not there: ask `inactivityReady` first). */
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
  const people = ((owners.data ?? []) as { display_name: string; plan_role: string | null; is_minor: boolean | null }[])
    .filter((o) => !o.is_minor && o.display_name)
    .map((o) => ({ name: o.display_name.trim(), role: o.plan_role }));
  const householdName = ((hh.data ?? []) as { name: string }[])[0]?.name?.trim() ?? '';
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
