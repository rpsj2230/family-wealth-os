'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

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
    kind: ['education', 'marriage', 'retirement', 'emergency', 'property', 'other'].includes(kind)
      ? kind
      : 'other',
  });
  revalidatePath('/goals');
}

export async function updateGoal(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const amount = Number(String(formData.get('target') ?? '').replace(/[₹,\s]/g, ''));
  const date = String(formData.get('date') ?? '');
  const infl = Number(String(formData.get('inflation') ?? '').replace(/[%\s]/g, ''));
  const { supabase } = await loadContext();
  await supabase
    .from('goals')
    .update({
      target_amount: Number.isFinite(amount) && amount > 0 ? amount : null,
      target_date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      inflation_rate: Number.isFinite(infl) && infl >= 0 && infl < 50 ? infl / 100 : null,
    })
    .eq('id', id);
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
