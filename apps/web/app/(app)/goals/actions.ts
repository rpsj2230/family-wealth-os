'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

const KINDS = ['education', 'marriage', 'retirement', 'emergency', 'property', 'other'];
const money = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? '').replace(/[₹,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const isoDate = (v: FormDataEntryValue | null) => {
  const d = String(v ?? '');
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
};

/** A new goal: a name and a kind are enough; a target and a date can be given now or later. */
export async function createGoal(formData: FormData) {
  const name = String(formData.get('name') ?? '')
    .trim()
    .slice(0, 80);
  const kind = String(formData.get('kind') ?? 'other');
  const { supabase, householdId } = await loadContext();
  if (!householdId || !name) return;
  await supabase.from('goals').insert({
    household_id: householdId,
    name,
    kind: KINDS.includes(kind) ? kind : 'other',
    target_amount: money(formData.get('target')),
    target_date: isoDate(formData.get('date')),
  });
  revalidatePath('/goals');
}

/** Changes a goal's target and assumptions; the name and kind too, when they are sent. */
export async function updateGoal(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const inflRaw = String(formData.get('inflation') ?? '').trim();
  const infl = Number(inflRaw.replace(/[%\s]/g, ''));
  const patch: Record<string, unknown> = {
    target_amount: money(formData.get('target')),
    target_date: isoDate(formData.get('date')),
    inflation_rate:
      inflRaw !== '' && Number.isFinite(infl) && infl >= 0 && infl < 50 ? infl / 100 : null,
  };
  const name = String(formData.get('name') ?? '')
    .trim()
    .slice(0, 80);
  if (name) patch.name = name;
  const kind = String(formData.get('kind') ?? '');
  if (KINDS.includes(kind)) patch.kind = kind;
  const { supabase } = await loadContext();
  await supabase.from('goals').update(patch).eq('id', id);
  revalidatePath('/goals');
}

/** Removes a goal and, with it, the earmarks on it. The holdings themselves are untouched. */
export async function deleteGoal(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('goals').delete().eq('id', id);
  revalidatePath('/goals');
}

export async function setAllocation(formData: FormData) {
  const goal = String(formData.get('goal') ?? '');
  const asset = String(formData.get('asset') ?? '');
  const pct = Number(String(formData.get('percent') ?? '').replace(/[%\s]/g, ''));
  if (!uuid.test(goal) || !uuid.test(asset) || !Number.isFinite(pct) || pct <= 0 || pct > 100)
    redirect('/goals?e=invalid');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const { error } = await supabase
    .from('goal_allocations')
    .upsert(
      { goal_id: goal, asset_id: asset, household_id: householdId, method: 'percent', value: pct },
      { onConflict: 'goal_id,asset_id' },
    );
  revalidatePath('/goals');
  if (error) redirect('/goals?e=over');
}

export async function removeAllocation(formData: FormData) {
  const goal = String(formData.get('goal') ?? '');
  const asset = String(formData.get('asset') ?? '');
  if (!uuid.test(goal) || !uuid.test(asset)) return;
  const { supabase } = await loadContext();
  await supabase.from('goal_allocations').delete().eq('goal_id', goal).eq('asset_id', asset);
  revalidatePath('/goals');
}
