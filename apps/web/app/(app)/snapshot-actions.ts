'use server';

import { loadContext } from '@/lib/data';
import { recordSnapshot } from '@/lib/portfolio-data';

export async function recordTodaySnapshot() {
  const { supabase, householdId } = await loadContext();
  if (householdId) await recordSnapshot(supabase, householdId, 'daily');
}
