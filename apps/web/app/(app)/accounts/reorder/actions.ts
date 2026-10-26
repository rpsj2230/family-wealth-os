'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const UUID = /^[0-9a-f-]{36}$/;

/** Saves the order of banks and rows: the full list of asset ids, in order. */
export async function saveOrder(ids: string[]): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (
    !Array.isArray(ids) ||
    ids.length === 0 ||
    ids.length > 500 ||
    !ids.every((i) => typeof i === 'string' && UUID.test(i))
  )
    return { ok: false, message: 'That order could not be read.' };
  const { error } = await supabase.rpc('reorder_assets', { p_household: householdId, p_ids: ids });
  if (error) return { ok: false, message: 'The order could not be saved.' };
  revalidatePath('/accounts');
  revalidatePath('/monthly', 'layout');
  revalidatePath('/');
  return { ok: true, message: 'Saved. Accounts and the monthly update now follow this order.' };
}
