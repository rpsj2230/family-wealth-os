'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || String(v).trim() === '') return null;
  const n = Number(String(v).replace(/[,\s₹]/g, ''));
  return Number.isFinite(n) ? n : NaN;
};

export interface FundUpdateRow {
  assetId: string;
  units: string;
  nav: string;
  value: string;
  invested: string;
  sipMonthly: string;
}

/** Saves the monthly fund figures in one go: units, price, value (units × price unless typed), amount put in and the SIP. */
export async function saveFundUpdate(
  asOf: string,
  rows: FundUpdateRow[],
): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    return { ok: false, message: 'Choose the date of these figures.' };
  const out: Record<string, unknown>[] = [];
  for (const r of rows) {
    if (!uuid.test(r.assetId)) return { ok: false, message: 'A fund in the list is not valid.' };
    const units = num(r.units);
    const nav = num(r.nav);
    let value = num(r.value);
    const invested = num(r.invested);
    const sip = num(r.sipMonthly);
    if ([units, nav, value, invested, sip].some((x) => x !== null && Number.isNaN(x)))
      return { ok: false, message: 'Some figures are not numbers.' };
    if (value === null && units !== null && nav !== null)
      value = Math.round(units * nav * 100) / 100;
    // an untouched row (no value at all) is skipped
    if (value === null) continue;
    out.push({
      assetId: r.assetId,
      asOf,
      units,
      nav,
      value,
      invested,
      ...(r.sipMonthly.trim() !== '' || sip === null ? { sipMonthly: sip } : {}),
    });
  }
  if (out.length === 0)
    return {
      ok: false,
      message: 'Nothing to save: enter units and a price (or a value) for at least one fund.',
    };
  const res = await supabase.rpc('save_fund_update', { p_household: householdId, p_rows: out });
  if (res.error) return { ok: false, message: res.error.message };
  revalidatePath('/investments');
  revalidatePath('/');
  return { ok: true, message: `Saved ${out.length} fund${out.length === 1 ? '' : 's'}.` };
}

/** One purchase, SIP instalment, switch or sale entered by hand. */
export async function addFundTransaction(
  _prev: { ok: boolean; message: string } | null,
  f: FormData,
): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const asset = String(f.get('asset') ?? '');
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the fund.' };
  const amount = num(f.get('amount'));
  const units = num(f.get('units'));
  const nav = num(f.get('nav'));
  if (amount === null || Number.isNaN(amount) || amount <= 0)
    return { ok: false, message: 'Enter the amount.' };
  const all = String(f.get('all') ?? '') === '1' || f.get('all') === 'on';
  if (!all && (units === null || Number.isNaN(units)) && (nav === null || Number.isNaN(nav)))
    return { ok: false, message: 'Enter the units or the price per unit.' };
  const res = await supabase.rpc('add_fund_transaction', {
    p_household: householdId,
    p_asset: asset,
    p: {
      date: String(f.get('date') ?? ''),
      kind: String(f.get('kind') ?? ''),
      amount,
      units: all || Number.isNaN(units) ? null : units,
      nav: nav === null || Number.isNaN(nav) ? null : nav,
      all,
    },
  });
  if (res.error) return { ok: false, message: res.error.message };
  revalidatePath('/investments');
  revalidatePath(`/asset/${asset}`);
  revalidatePath('/');
  return {
    ok: true,
    message: all
      ? 'Sale of every unit added: the fund is closed and its SIP stopped from that day. The gain is in the fund’s sales.'
      : 'Transaction added; units and amount invested updated.',
  };
}
