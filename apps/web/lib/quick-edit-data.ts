import type { SupabaseClient } from '@supabase/supabase-js';

/** The second name of each joint account, by asset id (the person on record is the first name). */
export async function loadJointHolders(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase
    .from('assets')
    .select('id, joint_holder_id')
    .not('joint_holder_id', 'is', null);
  return Object.fromEntries((data ?? []).map((j) => [j.id as string, j.joint_holder_id as string]));
}

/** The latest rupee value of each foreign currency, to suggest when a foreign balance is typed. */
export async function loadFxHint(supabase: SupabaseClient): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('fx_rates')
    .select('currency, rate_date, inr_per_unit')
    .order('rate_date', { ascending: false })
    .limit(20);
  const out: Record<string, number> = {};
  for (const r of data ?? [])
    if (!((r.currency as string) in out)) out[r.currency as string] = Number(r.inr_per_unit);
  return out;
}
