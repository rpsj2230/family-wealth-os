'use server';

import { settingsFromJson, type PlanSettings } from '@fwos/core';
import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

export async function savePlanSettings(
  raw: PlanSettings,
): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  // Re-validate on the server: the browser is not trusted.
  const clean = settingsFromJson(raw);
  const { error } = await supabase
    .from('plan_settings')
    .upsert({ household_id: householdId, settings: clean, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'Could not save. Nothing was changed.' };
  revalidatePath('/retire');
  return { ok: true, message: 'Saved. These assumptions will open next time.' };
}
