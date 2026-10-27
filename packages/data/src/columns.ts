import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Whether a column exists yet. A deploy can reach the app before the database update that adds a column has run (the update is applied by a
 * separate job), and a query that names a missing column fails the whole page. Readers of a newer column ask here first and fall back.
 * A failure that is not "the column does not exist" (a network error, a permission) counts as "it exists", so nothing else changes.
 * The answer is remembered for half a minute.
 */
const seen = new Map<string, { ok: boolean; at: number }>();
const TTL_MS = 30_000;

export async function columnExists(
  db: SupabaseClient,
  table: string,
  column: string,
): Promise<boolean> {
  const key = `${table}.${column}`;
  const hit = seen.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ok;
  const { error } = await db.from(table).select(column).limit(1);
  const missing = !!error && (error.code === '42703' || /does not exist/i.test(error.message));
  seen.set(key, { ok: !missing, at: Date.now() });
  return !missing;
}

/**
 * The filter that leaves out fund lines a statement has replaced (`superseded_on` is empty), for `.or(...)`. While the column is not
 * there yet nothing has been set aside, so every line counts (`id` is never empty).
 */
export async function liveLinesFilter(db: SupabaseClient): Promise<string> {
  return (await columnExists(db, 'mf_transactions', 'superseded_on'))
    ? 'superseded_on.is.null'
    : 'id.not.is.null';
}
