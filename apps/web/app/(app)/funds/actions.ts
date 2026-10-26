'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import { parseExitLoad } from '@/lib/match-funds';

export interface MatchResult {
  ok: boolean;
  message: string;
}

const refresh = () => {
  revalidatePath('/investments');
  revalidatePath('/');
};

/** Ties a fund to the official scheme the person has checked, so its daily price can be used. */
export async function confirmMatch(_prev: MatchResult | null, f: FormData): Promise<MatchResult> {
  const asset = String(f.get('asset') ?? '');
  const code = String(f.get('code') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset) || !/^\d{3,8}$/.test(code))
    return { ok: false, message: 'That choice is not valid. Reload the page and try again.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase.rpc('confirm_scheme_match', {
    p_household: householdId,
    p_asset: asset,
    p_code: code,
  });
  if (error) return { ok: false, message: 'That could not be saved. Nothing was changed.' };
  refresh();
  return { ok: true, message: 'Matched. Its price now follows the market every day.' };
}

/** Removes the match so the fund can be matched again. */
export async function clearMatch(_prev: MatchResult | null, f: FormData): Promise<MatchResult> {
  const asset = String(f.get('asset') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset))
    return { ok: false, message: 'That choice is not valid. Reload the page and try again.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase.rpc('confirm_scheme_match', {
    p_household: householdId,
    p_asset: asset,
    p_code: null,
  });
  if (error) return { ok: false, message: 'That could not be saved. Nothing was changed.' };
  refresh();
  return { ok: true, message: 'Match removed. Choose the scheme again.' };
}

/** A fund's own exit load; leaving both fields empty goes back to the household default in Settings. */
export async function setExitLoad(_prev: MatchResult | null, f: FormData): Promise<MatchResult> {
  const asset = String(f.get('asset') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(asset)) return { ok: false, message: 'Choose the fund.' };
  const parsed = parseExitLoad(String(f.get('pct') ?? ''), String(f.get('days') ?? ''));
  if (!parsed)
    return {
      ok: false,
      message: 'Enter a percentage from 0 to 10 and a whole number of days up to 1095.',
    };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase
    .from('mf_positions')
    .update(
      parsed.clear
        ? { exit_load_pct: null, exit_load_days: null }
        : { exit_load_pct: parsed.fraction, exit_load_days: parsed.days },
    )
    .eq('asset_id', asset)
    .eq('household_id', householdId);
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/investments');
  revalidatePath('/tax');
  return {
    ok: true,
    message: parsed.clear ? 'Back to the default from Settings.' : 'Exit load saved.',
  };
}
