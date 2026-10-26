'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function recordRepayment(formData: FormData) {
  const asset = String(formData.get('asset') ?? '');
  const amount = Number(String(formData.get('amount') ?? '').replace(/[₹,\s]/g, ''));
  const on = String(formData.get('on') ?? '');
  if (
    !uuid.test(asset) ||
    !(amount > 0) ||
    !isoDate.test(on) ||
    on > new Date().toISOString().slice(0, 10)
  )
    return;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  await supabase
    .from('receivable_payments')
    .insert({ household_id: householdId, asset_id: asset, amount, paid_on: on });
  revalidatePath('/others');
  revalidatePath('/');
}

export async function setExpectedDate(formData: FormData) {
  const asset = String(formData.get('asset') ?? '');
  const on = String(formData.get('on') ?? '');
  if (!uuid.test(asset)) return;
  const { supabase } = await loadContext();
  await supabase
    .from('receivables')
    .update({ expected_on: isoDate.test(on) ? on : null })
    .eq('asset_id', asset);
  revalidatePath('/others');
}

export async function updatePolicy(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const d = (k: string) =>
    isoDate.test(String(formData.get(k) ?? '')) ? String(formData.get(k)) : null;
  const t = (k: string) =>
    String(formData.get(k) ?? '')
      .trim()
      .slice(0, 500) || null;
  const { supabase } = await loadContext();
  await supabase
    .from('policies')
    .update({
      renewal_on: d('renewal'),
      expires_on: d('expires'),
      nominee_note: t('nominee'),
      documents_note: t('documents'),
    })
    .eq('id', id);
  revalidatePath('/others');
  revalidatePath('/emergency');
}

export async function addLoan(formData: FormData) {
  const owner = String(formData.get('owner') ?? '');
  const who = String(formData.get('who') ?? '')
    .trim()
    .slice(0, 120);
  const lent = Number(String(formData.get('lent') ?? '').replace(/[₹,\s]/g, ''));
  const lentOn = String(formData.get('lent_on') ?? '');
  const expected = String(formData.get('expected') ?? '');
  const today = new Date().toISOString().slice(0, 10);
  if (!uuid.test(owner) || !who || !(lent > 0)) return;
  if (lentOn && (!isoDate.test(lentOn) || lentOn > today)) return;
  if (expected && !isoDate.test(expected)) return;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const { data: asset, error } = await supabase
    .from('assets')
    .insert({
      household_id: householdId,
      type: 'receivable',
      owner_id: owner,
      nickname: `Loan to ${who}`,
    })
    .select('id')
    .single();
  if (error || !asset) return;
  const { error: e2 } = await supabase.from('receivables').insert({
    asset_id: asset.id,
    household_id: householdId,
    counterparty: who,
    lent,
    lent_on: lentOn || null,
    expected_on: expected || null,
  });
  // do not leave an orphan asset behind if the second insert is refused
  if (e2) await supabase.from('assets').delete().eq('id', asset.id);
  revalidatePath('/others');
  revalidatePath('/');
}
