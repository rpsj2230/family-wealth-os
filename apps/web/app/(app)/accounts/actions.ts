'use server';

import { revalidatePath } from 'next/cache';
import { isPastMaturity } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { loadTidyPlan } from '@/lib/tidy-notes';
import type { Change } from '@/lib/monthly';
import { saveMonthly } from '../monthly/actions';
import { saveAccountDetails } from './edit/actions';

export interface QuickSaveResult {
  ok: boolean;
  message: string;
}

const UUID = /^[0-9a-f-]{36}$/;

/**
 * Saves one account from the edit panel: its details (name, type, note, status, a deposit's terms) and, when typed, a new
 * balance or savings rate. Both go through the same database functions as the table and the monthly update, which check
 * membership and every value; nothing here widens what a member can already do.
 */
export async function saveQuickEdit(input: {
  details: Record<string, unknown> | null;
  monthly: Change | null;
}): Promise<QuickSaveResult> {
  const { householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const details = input?.details ?? null;
  const monthly = input?.monthly ?? null;
  if (!details && !monthly) return { ok: true, message: 'Nothing was changed.' };
  if (details && !UUID.test(String(details.id ?? '')))
    return { ok: false, message: 'That account could not be found.' };
  if (monthly && !UUID.test(String(monthly.assetId ?? '')))
    return { ok: false, message: 'That account could not be found.' };
  if (details) {
    const r = await saveAccountDetails([details]);
    if (!r.ok) return r;
  }
  if (monthly) {
    const r = await saveMonthly([monthly]);
    if (!r.ok)
      return {
        ok: false,
        message: details
          ? `The details were saved, but the balance or rate was not: ${r.message}`
          : r.message,
      };
  }
  revalidatePath('/accounts');
  revalidatePath('/monthly');
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Saved.' };
}

/**
 * "Confirm matured": a deposit whose date has passed (or that is marked matured, not confirmed) is set to matured, which takes it
 * off the lists. It uses the same database function as the edit panel (the member check and every value check are there); this
 * adds only the question "has this deposit really matured?", so the button cannot hide a deposit that is still running.
 */
export async function confirmMatured(assetId: string): Promise<QuickSaveResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!UUID.test(String(assetId ?? '')))
    return { ok: false, message: 'That deposit could not be found.' };
  const { data: asset } = await supabase
    .from('assets')
    .select('id, type, status')
    .eq('id', assetId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (!asset || asset.type !== 'fixed_deposit')
    return { ok: false, message: 'That deposit could not be found.' };
  if (asset.status === 'matured') return { ok: true, message: 'It was already marked as matured.' };
  if (asset.status !== 'active' && asset.status !== 'matured_unconfirmed')
    return {
      ok: false,
      message: 'Only a deposit that is still running or waiting to be confirmed can be confirmed.',
    };
  if (asset.status === 'active') {
    const { data: fd } = await supabase
      .from('fixed_deposits')
      .select('maturity_on')
      .eq('asset_id', assetId)
      .maybeSingle();
    const today = new Date().toISOString().slice(0, 10);
    if (!fd || !isPastMaturity(String(fd.maturity_on), today))
      return { ok: false, message: 'This deposit has not reached its maturity date yet.' };
  }
  const r = await saveAccountDetails([{ id: assetId, status: 'matured' }]);
  if (!r.ok) return r;
  revalidatePath('/deposits');
  return { ok: true, message: 'Marked as matured.' };
}

/** A note about a whole bank (minimum balance, cards, lounge access). */
export async function saveBankNote(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const id = String(f.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  // up to four short lines: each is trimmed and empty ones are dropped, so the note reads cleanly
  const note = String(f.get('note') ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join('\n')
    .slice(0, 500);
  await supabase
    .from('institutions')
    .update({ notes: note || null })
    .eq('id', id)
    .eq('household_id', householdId);
  revalidatePath('/accounts');
}

/** Moves bank-level facts (minimum balance, lounge cards, no debit card) from account notes to the bank's note. */
export async function applyTidyNotes(): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const plan = await loadTidyPlan(supabase);
  for (const b of plan.plan.banks)
    await supabase
      .from('institutions')
      .update({ notes: b.notes })
      .eq('id', b.institutionId)
      .eq('household_id', householdId);
  for (const a of plan.plan.assets)
    await supabase
      .from('assets')
      .update({ notes: a.notes })
      .eq('id', a.assetId)
      .eq('household_id', householdId);
  revalidatePath('/accounts');
  revalidatePath('/accounts/tidy-notes');
}
