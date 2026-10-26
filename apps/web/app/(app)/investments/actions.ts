'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

/**
 * Tags a fund with one goal: all of it counts towards that goal. Any earlier split of this fund between goals is replaced, so the
 * Goals page and this page always agree. An empty goal removes the tag.
 */
export async function tagFundGoal(
  assetId: string,
  goalId: string,
): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!uuid.test(assetId) || (goalId !== '' && !uuid.test(goalId)))
    return { ok: false, message: 'Not a valid choice.' };
  const del = await supabase
    .from('goal_allocations')
    .delete()
    .eq('asset_id', assetId)
    .eq('household_id', householdId);
  if (del.error) return { ok: false, message: 'That could not be saved.' };
  if (goalId !== '') {
    const ins = await supabase.from('goal_allocations').insert({
      goal_id: goalId,
      asset_id: assetId,
      household_id: householdId,
      method: 'percent',
      value: 100,
    });
    if (ins.error) return { ok: false, message: 'That could not be saved.' };
  }
  revalidatePath('/investments');
  revalidatePath('/goals');
  revalidatePath('/');
  return { ok: true, message: 'Saved' };
}
