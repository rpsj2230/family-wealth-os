'use server';

import { revalidatePath } from 'next/cache';
import { buildHandbookDoc } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';

/** Rewrites the handbook from today's records. */
export async function refreshHandbook(): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const doc = await buildHandbookDoc(supabase as unknown as SupabaseClient);
  await supabase.rpc('save_emergency_document', { p_household: householdId, p_content: doc });
  revalidatePath('/emergency');
}
