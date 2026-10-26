'use server';

import { revalidatePath } from 'next/cache';
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
