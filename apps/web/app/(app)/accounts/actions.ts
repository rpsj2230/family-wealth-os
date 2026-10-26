'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';
import { loadTidyPlan } from '@/lib/tidy-notes';

/** A note about a whole bank (minimum balance, cards, lounge access). */
export async function saveBankNote(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const id = String(f.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  const note = String(f.get('note') ?? '')
    .trim()
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
