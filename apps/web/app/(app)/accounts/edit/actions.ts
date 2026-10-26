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
  // the deposit number field takes the whole number: the last four digits go with the details, the whole number is stored beside it
  const full: { assetId: string; fdRef: string }[] = [];
  const clean = rows.map((r) => {
    const v = typeof r.fdRefLast4 === 'string' ? r.fdRefLast4.trim() : '';
    if (v.length <= 4) return r;
    if (!/^[A-Za-z0-9-]{4,40}$/.test(v)) return { ...r, fdRefLast4: v.slice(-4) };
    full.push({ assetId: String(r.id ?? ''), fdRef: v });
    return { ...r, fdRefLast4: v.split('-')[0]!.replace(/\D/g, '').slice(-4) || v.slice(-4) };
  });
  const { data, error } = await supabase.rpc('save_account_details', {
    p_household: householdId,
    p_rows: clean,
  });
  if (error) return { ok: false, message: error.message.replace(/^.*ERROR:\s*/, '').slice(0, 300) };
  if (full.length > 0)
    await supabase.rpc('set_fd_numbers', { p_household: householdId, p_rows: full });
  revalidatePath('/accounts');
  revalidatePath('/monthly');
  revalidatePath('/', 'layout');
  const n = (data as { accounts?: number } | null)?.accounts ?? rows.length;
  return { ok: true, message: `Saved ${n} row${n === 1 ? '' : 's'}.` };
}
