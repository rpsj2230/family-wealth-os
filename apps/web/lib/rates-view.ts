import {
  sameBank,
  savingsRateFor,
  type BoardOffer,
  type RateEventRow,
  type RateKind,
  type RateOffer,
  type RateSourceRow,
} from '@fwos/core';
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

// ---- the Rates pages: offers with their correction state, the change log, the rate pages and the learned rules ----------

const BOARD_COLS =
  'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to, tenure_days, source_note, source_url, ai_rate, correction_reason, page_rate, page_seen_on, misread_count';

/** Every rate on file with what the refresh and your corrections have recorded about it. */
export async function loadBoardOffers(supabase: Ctx['supabase']): Promise<BoardOffer[]> {
  const r = await supabase.from('rate_offers').select(BOARD_COLS).order('bank');
  return ((r.data ?? []) as unknown as Record<string, unknown>[]).map((o) => ({
    id: o.id as string,
    bank: o.bank as string,
    product: o.product as 'savings' | 'fd',
    accountKind: o.account_kind as RateKind,
    tenureFrom: Number(o.tenure_from_months),
    tenureTo: Number(o.tenure_to_months),
    rate: Number(o.rate),
    conditions: (o.conditions as string | null) ?? null,
    sourceKind: o.source_kind as 'manual' | 'ai',
    checkedOn: o.checked_on as string,
    balanceFrom: o.balance_from === null ? null : Number(o.balance_from),
    balanceTo: o.balance_to === null ? null : Number(o.balance_to),
    tenureDays: (o.tenure_days as number | null) ?? null,
    sourceNote: (o.source_note as string | null) ?? null,
    sourceUrl: (o.source_url as string | null) ?? null,
    aiRate: o.ai_rate === null || o.ai_rate === undefined ? null : Number(o.ai_rate),
    correctionReason: (o.correction_reason as string | null) ?? null,
    pageRate: o.page_rate === null || o.page_rate === undefined ? null : Number(o.page_rate),
    pageSeenOn: (o.page_seen_on as string | null) ?? null,
    misreadCount: Number(o.misread_count ?? 0),
  }));
}

/** The change log, newest first. A bank name narrows it (matched the way banks are matched everywhere). */
export async function loadRateEvents(
  supabase: Ctx['supabase'],
  bank?: string,
  limit = 600,
): Promise<RateEventRow[]> {
  const r = await supabase
    .from('rate_events')
    .select(
      'at, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, kind, old_rate, new_rate, source, reason',
    )
    .order('at', { ascending: false })
    .limit(limit);
  return ((r.data ?? []) as unknown as Record<string, unknown>[])
    .map((e) => ({
      at: e.at as string,
      bank: e.bank as string,
      product: e.product as 'savings' | 'fd',
      accountKind: e.account_kind as string,
      tenureFrom: Number(e.tenure_from_months),
      tenureTo: Number(e.tenure_to_months),
      balanceFrom: e.balance_from === null ? null : Number(e.balance_from),
      balanceTo: e.balance_to === null ? null : Number(e.balance_to),
      kind: e.kind as RateEventRow['kind'],
      oldRate: e.old_rate === null ? null : Number(e.old_rate),
      newRate: e.new_rate === null ? null : Number(e.new_rate),
      source: e.source as 'manual' | 'ai',
      reason: (e.reason as string | null) ?? null,
    }))
    .filter((e) => !bank || sameBank(e.bank, bank));
}

/** The pages the monthly refresh reads, with how the last read went. */
export async function loadRateSources(supabase: Ctx['supabase']): Promise<RateSourceRow[]> {
  const r = await supabase
    .from('rate_sources')
    .select('bank, url, enabled, last_run_on, last_result');
  return ((r.data ?? []) as unknown as Record<string, unknown>[]).map((s) => ({
    bank: s.bank as string,
    url: s.url as string,
    enabled: !!s.enabled,
    lastRunOn: (s.last_run_on as string | null) ?? null,
    lastResult: (s.last_result as string | null) ?? null,
  }));
}

export interface RateHint {
  id: string;
  bank: string;
  cause: string;
  hint: string;
  createdOn: string;
  active: boolean;
}

/** Rules the refresh has learned (or you wrote) for a bank, newest first. */
export async function loadRateHints(supabase: Ctx['supabase'], bank?: string): Promise<RateHint[]> {
  const r = await supabase
    .from('rate_hints')
    .select('id, bank, cause, hint, created_on, active')
    .order('created_on', { ascending: false });
  return ((r.data ?? []) as unknown as Record<string, unknown>[])
    .map((h) => ({
      id: h.id as string,
      bank: h.bank as string,
      cause: h.cause as string,
      hint: h.hint as string,
      createdOn: h.created_on as string,
      active: !!h.active,
    }))
    .filter((h) => !bank || sameBank(h.bank, bank));
}
