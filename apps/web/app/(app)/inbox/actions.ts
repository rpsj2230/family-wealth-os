'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

/** Apply a reading the reader could not apply alone, after you picked the account. */
export async function applyReading(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const asset = String(formData.get('asset') ?? '');
  if (!uuid.test(id) || !uuid.test(asset)) return;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('id, reading, message_id, resolved_at')
    .eq('id', id)
    .maybeSingle();
  const r = msg?.reading as {
    amount: number;
    currency: string;
    asOf: string;
    source: 'rule' | 'ai';
  } | null;
  if (
    !msg ||
    msg.resolved_at ||
    !r ||
    !(Number(r.amount) >= 0) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(r.asOf)
  )
    return;
  const { data: a } = await supabase
    .from('assets')
    .select('currency')
    .eq('id', asset)
    .maybeSingle();
  if (!a || a.currency !== r.currency) return; // never record a balance in the wrong currency
  let fx: number | null = null;
  if (r.currency !== 'INR') {
    const { data: f } = await supabase
      .from('fx_rates')
      .select('inr_per_unit')
      .eq('currency', r.currency)
      .lte('rate_date', r.asOf)
      .order('rate_date', { ascending: false })
      .limit(1);
    fx = f?.[0] ? Number(f[0].inr_per_unit) : null;
    if (!fx) return;
  }
  const { error } = await supabase.from('observations').insert({
    household_id: householdId,
    asset_id: asset,
    kind: 'balance',
    amount: Number(r.amount),
    currency: r.currency,
    fx_rate: fx,
    as_of: r.asOf,
    received_at: new Date().toISOString(),
    source: 'email',
    source_ref: String(msg.message_id).slice(0, 200),
    confidence: 'manual_confirmed',
    note: 'Confirmed by you from the bank-email inbox',
  });
  if (error) return;
  await supabase
    .from('inbox_messages')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/inbox');
  revalidatePath('/');
}

export async function dismissMessage(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase
    .from('inbox_messages')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath('/inbox');
}
