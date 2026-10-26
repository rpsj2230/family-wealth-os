'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

export interface RateResult {
  ok: boolean;
  message: string;
}

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? '').replace(/[%\s,]/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
};

/** A rate typed by you. It is never overwritten by the automatic refresh. */
export async function addRateOffer(_p: RateResult | null, f: FormData): Promise<RateResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const bank = String(f.get('bank') ?? '')
    .trim()
    .slice(0, 80);
  const product = String(f.get('product') ?? '');
  const kind = String(f.get('kind') ?? 'any');
  const pct = num(f.get('rate'));
  const from = num(f.get('from')) ?? 0;
  const to = num(f.get('to')) ?? from;
  if (
    !bank ||
    !['savings', 'fd'].includes(product) ||
    !['NRE', 'NRO', 'resident', 'any'].includes(kind)
  )
    return { ok: false, message: 'Choose a bank, product and account type.' };
  if (pct === null || pct < 0.5 || pct > 20)
    return { ok: false, message: 'Rate is a percentage such as 7.25.' };
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 240)
    return { ok: false, message: 'Tenure is in whole months, from the shortest to the longest.' };
  const { error } = await supabase.from('rate_offers').upsert(
    {
      household_id: householdId,
      bank,
      product,
      account_kind: kind,
      tenure_from_months: product === 'savings' ? 0 : from,
      tenure_to_months: product === 'savings' ? 0 : to,
      rate: Math.round(pct * 100) / 10_000,
      conditions:
        String(f.get('conditions') ?? '')
          .trim()
          .slice(0, 200) || null,
      source_kind: 'manual',
      source_url: null,
      checked_on: new Date().toISOString().slice(0, 10),
    },
    { onConflict: 'household_id,bank,product,account_kind,tenure_from_months,tenure_to_months' },
  );
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/rates');
  return { ok: true, message: 'Saved.' };
}

export async function deleteRateOffer(f: FormData): Promise<void> {
  const id = String(f.get('id') ?? '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('rate_offers').delete().eq('id', id);
  revalidatePath('/rates');
}
