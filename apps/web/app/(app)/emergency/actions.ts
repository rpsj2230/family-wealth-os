'use server';

import { revalidatePath } from 'next/cache';
import { STEP_KEY } from '@fwos/core';
import { buildHandbookDoc } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess, loadContext } from '@/lib/data';

/** Rewrites the handbook from today's records. */
export async function refreshHandbook(): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const doc = await buildHandbookDoc(supabase as unknown as SupabaseClient);
  await supabase.rpc('save_emergency_document', { p_household: householdId, p_content: doc });
  revalidatePath('/emergency');
}

/**
 * Ticks or unticks one step of the handbook ("Bank informed", "Death certificate collected"). A tick is a row of emergency_progress,
 * shared by everyone who may open the handbook; row-level security allows it to members and, once the handbook is open to it, to the
 * read-only family login. Only keys the handbook writes are accepted. Before the database update that adds the table has run, the
 * tick is not saved and the page says so.
 */
export async function tickStep(key: string, done: boolean): Promise<{ ok: boolean }> {
  if (typeof key !== 'string' || !STEP_KEY.test(key) || typeof done !== 'boolean')
    return { ok: false };
  const { supabase, householdId } = await loadAccess();
  if (!householdId) return { ok: false };
  if (done) {
    const r = await supabase
      .from('emergency_progress')
      .insert({ household_id: householdId, step_key: key });
    // already ticked by someone else: that is what was wanted
    return { ok: !r.error || r.error.code === '23505' };
  }
  const r = await supabase
    .from('emergency_progress')
    .delete()
    .eq('household_id', householdId)
    .eq('step_key', key);
  return { ok: !r.error };
}
