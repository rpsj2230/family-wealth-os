'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

/** Marks which banks are foreign banks outside the Indian deposit insurance scheme: their money is left out of the cover. */
export async function saveForeignBanks(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const outside = new Set(
    f
      .getAll('foreign')
      .map(String)
      .filter((id) => /^[0-9a-f-]{36}$/.test(id)),
  );
  const { data } = await supabase.from('institutions').select('id').eq('household_id', householdId);
  for (const b of data ?? []) {
    const id = b.id as string;
    await supabase
      .from('institutions')
      .update({ deposit_insured: !outside.has(id) })
      .eq('id', id)
      .eq('household_id', householdId);
  }
  revalidatePath('/deposits');
  revalidatePath('/');
}
