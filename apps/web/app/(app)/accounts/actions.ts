'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

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
