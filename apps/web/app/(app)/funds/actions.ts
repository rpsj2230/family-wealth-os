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
