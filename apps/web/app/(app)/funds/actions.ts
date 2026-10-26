'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

export async function confirmMatch(formData: FormData) {
  const asset = String(formData.get('asset') ?? '');
  const code = String(formData.get('code') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset) || !/^\d{3,8}$/.test(code)) return;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  await supabase.rpc('confirm_scheme_match', {
    p_household: householdId,
    p_asset: asset,
    p_code: code,
  });
  revalidatePath('/funds');
  revalidatePath('/');
}

export async function clearMatch(formData: FormData) {
  const asset = String(formData.get('asset') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset)) return;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  await supabase.rpc('confirm_scheme_match', {
    p_household: householdId,
    p_asset: asset,
    p_code: null,
  });
  revalidatePath('/funds');
  revalidatePath('/');
}

/** A fund's own exit load; leaving both fields empty goes back to the household default in Settings. */
export async function setExitLoad(formData: FormData) {
  const asset = String(formData.get('asset') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset)) return;
  const pctRaw = String(formData.get('pct') ?? '').replace(/[%\s]/g, '');
  const daysRaw = String(formData.get('days') ?? '').trim();
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const clear = pctRaw === '' && daysRaw === '';
  const pct = Number(pctRaw);
  const days = Number(daysRaw);
  if (!clear && (!(pct >= 0 && pct <= 10) || !Number.isInteger(days) || days < 0 || days > 1095))
    return;
  await supabase
    .from('mf_positions')
    .update(
      clear
        ? { exit_load_pct: null, exit_load_days: null }
        : { exit_load_pct: pct / 100, exit_load_days: days },
    )
    .eq('asset_id', asset)
    .eq('household_id', householdId);
  revalidatePath('/funds');
  revalidatePath('/tax');
}
