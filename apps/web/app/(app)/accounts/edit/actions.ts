'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

export interface SaveResult {
  ok: boolean;
  message: string;
}

/** Saves the changed rows of the "edit many accounts" table in one go; the database function checks every value. */
export async function saveAccountDetails(rows: Record<string, unknown>[]): Promise<SaveResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!Array.isArray(rows) || rows.length === 0) return { ok: true, message: 'Nothing to save.' };
  if (rows.length > 500)
    return { ok: false, message: 'Too many rows at once: save in smaller parts.' };
  const { data, error } = await supabase.rpc('save_account_details', {
    p_household: householdId,
    p_rows: rows,
  });
  if (error) return { ok: false, message: error.message.replace(/^.*ERROR:\s*/, '').slice(0, 300) };
  revalidatePath('/accounts');
  revalidatePath('/monthly');
  revalidatePath('/', 'layout');
  const n = (data as { accounts?: number } | null)?.accounts ?? rows.length;
  return { ok: true, message: `Saved ${n} row${n === 1 ? '' : 's'}.` };
}
