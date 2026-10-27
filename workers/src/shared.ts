/** Small helpers the mailbox jobs (inbox.ts, statements.ts) share. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** A required environment variable; the job stops with a clear message when it is missing. */
export const need = (n: string): string => {
  const v = process.env[n];
  if (!v) {
    console.error(`${n} is required`);
    process.exit(2);
  }
  return v;
};

/** The database, with the service role (the jobs have no signed-in person). */
export const connectDb = (): SupabaseClient =>
  createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false },
  });

export const must = <T>(
  r: { data: T | null; error: { message: string } | null },
  what: string,
): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

/** The one household of this installation (or the one named by INBOX_HOUSEHOLD_ID). */
export async function householdId(db: SupabaseClient): Promise<string> {
  if (process.env.INBOX_HOUSEHOLD_ID) return process.env.INBOX_HOUSEHOLD_ID;
  const rows = must(await db.from('households').select('id'), 'households');
  if (rows.length !== 1)
    throw new Error(
      `Expected exactly one household, found ${rows.length}; set INBOX_HOUSEHOLD_ID.`,
    );
  return rows[0]!.id as string;
}

/** Your own addresses: the ones listed in Settings as forwarders and every household member's login address. */
export async function ownAddresses(
  db: SupabaseClient,
  hh: string,
  listed: readonly string[],
): Promise<string[]> {
  const out = new Set<string>(listed.map((a) => a.toLowerCase()));
  const members = must(
    await db.from('household_members').select('user_id').eq('household_id', hh),
    'members',
  );
  for (const m of members) {
    const u = await db.auth.admin.getUserById(m.user_id as string);
    if (u.data.user?.email) out.add(u.data.user.email.toLowerCase());
  }
  return [...out];
}
