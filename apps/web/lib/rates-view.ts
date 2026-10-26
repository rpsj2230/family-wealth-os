import { savingsRateFor, type RateKind, type RateOffer } from '@fwos/core';
import type { Ctx } from './data';

/** Every rate on file, in the shape the comparison functions use. */
export async function loadOffers(supabase: Ctx['supabase']): Promise<RateOffer[]> {
  const r = await supabase
    .from('rate_offers')
    .select(
      'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to, tenure_days, source_note, source_url',
    );
  return ((r.data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({
    id: o.id as string,
    bank: o.bank as string,
    product: o.product as 'savings' | 'fd',
    accountKind: o.account_kind as RateKind,
    tenureFrom: o.tenure_from_months as number,
    tenureTo: o.tenure_to_months as number,
    rate: Number(o.rate),
    conditions: (o.conditions as string | null) ?? null,
    sourceKind: o.source_kind as 'manual' | 'ai',
    checkedOn: o.checked_on as string,
    balanceFrom: o.balance_from === null ? null : Number(o.balance_from),
    balanceTo: o.balance_to === null ? null : Number(o.balance_to),
    tenureDays: (o.tenure_days as number | null) ?? null,
    sourceNote: (o.source_note as string | null) ?? null,
    sourceUrl: (o.source_url as string | null) ?? null,
  }));
}

export interface CashRate {
  rate: number;
  /** where the figure comes from: set on the account, read from the bank's rates, or the household's assumed rate */
  tag: 'own' | 'market' | 'assumed';
  note: string;
}

/**
 * The interest rate each savings account earns today: the rate set on the account, else the slab it falls in on the bank's
 * rates on file, else the assumed savings rate (marked as such).
 */
export function cashRatesFor(
  rows: {
    assetId: string;
    kind: string;
    status: string;
    accountKind: 'NRE' | 'NRO' | null;
    current: number | null;
    bank: string;
  }[],
  own: Map<string, number | null>,
  offers: RateOffer[],
  assumed: number,
): Record<string, CashRate> {
  const out: Record<string, CashRate> = {};
  for (const r of rows) {
    if (r.kind !== 'cash' || r.status !== 'active') continue;
    const mine = own.get(r.assetId);
    if (mine !== null && mine !== undefined) {
      out[r.assetId] = { rate: mine, tag: 'own', note: 'Rate set on this account' };
      continue;
    }
    const m = savingsRateFor(offers, r.bank, r.accountKind, Math.max(0, r.current ?? 0));
    if (m)
      out[r.assetId] = {
        rate: m.rate,
        tag: 'market',
        note: `${r.bank} savings rate${m.slab ? ` for balances ${m.slab}` : ''}, checked ${m.checkedOn}`,
      };
    else
      out[r.assetId] = {
        rate: assumed,
        tag: 'assumed',
        note: 'No rate on file for this bank: the assumed savings rate from Settings is used',
      };
  }
  return out;
}
