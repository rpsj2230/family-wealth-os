'use server';

import { revalidatePath } from 'next/cache';
import { parseAmount, parseRateNotes, sameBank } from '@fwos/core';
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
  const balFrom = String(f.get('balfrom') ?? '').trim()
    ? parseAmount(String(f.get('balfrom')))
    : null;
  const balTo = String(f.get('balto') ?? '').trim() ? parseAmount(String(f.get('balto'))) : null;
  if (product === 'savings' && balTo !== null && balTo <= (balFrom ?? 0))
    return { ok: false, message: 'The balance limit must be above the start of the slab.' };
  const row = {
    household_id: householdId,
    bank,
    product,
    account_kind: kind,
    tenure_from_months: product === 'savings' ? 0 : from,
    tenure_to_months: product === 'savings' ? 0 : to,
    balance_from: product === 'savings' ? balFrom : null,
    balance_to: product === 'savings' ? balTo : null,
    rate: Math.round(pct * 100) / 10_000,
    conditions:
      String(f.get('conditions') ?? '')
        .trim()
        .slice(0, 200) || null,
    source_kind: 'manual',
    source_url: null,
    checked_on: new Date().toISOString().slice(0, 10),
  };
  const err = await replaceSlot(supabase, row);
  if (err) return { ok: false, message: 'That could not be saved.' };
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

type Db = Awaited<ReturnType<typeof loadContext>>['supabase'];
interface OfferRow {
  household_id: string;
  bank: string;
  product: string;
  account_kind: string;
  tenure_from_months: number;
  tenure_to_months: number;
  balance_from: number | null;
  balance_to: number | null;
  [k: string]: unknown;
}

/** One rate per bank, product, account type, term and balance slab: saving it again replaces the earlier one. */
async function replaceSlot(db: Db, row: OfferRow): Promise<boolean> {
  let q = db
    .from('rate_offers')
    .delete()
    .eq('household_id', row.household_id)
    .eq('bank', row.bank)
    .eq('product', row.product)
    .eq('account_kind', row.account_kind)
    .eq('tenure_from_months', row.tenure_from_months)
    .eq('tenure_to_months', row.tenure_to_months);
  q =
    row.balance_from === null ? q.is('balance_from', null) : q.eq('balance_from', row.balance_from);
  q = row.balance_to === null ? q.is('balance_to', null) : q.eq('balance_to', row.balance_to);
  const del = await q;
  if (del.error) return true;
  const ins = await db.from('rate_offers').insert(row);
  return !!ins.error;
}

/**
 * Rates pasted as notes, one bank per line (see parseRateNotes). Each bank is matched to the bank name already in your accounts, and
 * a pasted bank's earlier typed rates for the same product are replaced, so pasting an updated list never leaves old slabs behind.
 */
export async function importRateNotes(_p: RateResult | null, f: FormData): Promise<RateResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const text = String(f.get('notes') ?? '').slice(0, 20_000);
  const { offers, problems } = parseRateNotes(text);
  if (offers.length === 0)
    return {
      ok: false,
      message: `No rates could be read. ${problems.slice(0, 3).join(' ')}`.trim(),
    };
  const inst = await supabase.from('institutions').select('name');
  const names = ((inst.data ?? []) as { name: string }[]).map((i) => i.name);
  const canon = (b: string) => names.find((n) => sameBank(n, b)) ?? b;
  const today = new Date().toISOString().slice(0, 10);
  const pairs = new Set(offers.map((o) => `${canon(o.bank)}|${o.product}`));
  for (const k of pairs) {
    const [bank, product] = k.split('|') as [string, string];
    const del = await supabase
      .from('rate_offers')
      .delete()
      .eq('household_id', householdId)
      .eq('bank', bank)
      .eq('product', product)
      .eq('source_kind', 'manual');
    if (del.error) return { ok: false, message: 'The earlier rates could not be replaced.' };
  }
  const rows = offers.map((o) => ({
    household_id: householdId,
    bank: canon(o.bank),
    product: o.product,
    account_kind: o.accountKind,
    tenure_from_months: o.tenureFromMonths,
    tenure_to_months: o.tenureToMonths,
    tenure_days: o.tenureDays,
    balance_from: o.balanceFrom,
    balance_to: o.balanceTo,
    rate: o.rate,
    conditions: null,
    source_kind: 'manual',
    source_url: null,
    checked_on: today,
  }));
  const ins = await supabase.from('rate_offers').insert(rows);
  if (ins.error) return { ok: false, message: 'The rates could not be saved.' };
  revalidatePath('/rates');
  revalidatePath('/accounts');
  return {
    ok: true,
    message: `Saved ${rows.length} rates for ${new Set(rows.map((r) => r.bank)).size} banks.${problems.length ? ` Could not read: ${problems.slice(0, 3).join('; ')}.` : ''}`,
  };
}
