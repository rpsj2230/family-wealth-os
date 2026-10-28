/**
 * Turns database rows (assets, latest observations, fixed deposits) into valued assets for net worth.
 * Pure: no I/O. The web app fetches rows and calls buildPortfolio().
 */
import { DEFAULT_CONFIG } from './config';
import type { CurrentValueEstimate } from './estimate';
import type { Confidence, Freshness } from './freshness';
import type { AssetType, NetWorthResult, ValuedAsset } from './networth';
import { portfolioFromPosition, valuationInput, type ValuationExtras } from './valuation';

export interface AssetRow {
  id: string;
  owner_id: string;
  type: AssetType;
  status: string;
  nickname: string;
  currency: string;
  account_kind: string | null;
  /** null = use the household's setting */
  expected_freshness_days: number | null;
  institution_id?: string | null;
  identifier_last4?: string | null;
  holder_name?: string | null;
  label?: string | null;
  sort_order?: number | null;
  is_joint?: boolean | null;
  linked_last4?: string | null;
  notes?: string | null;
  /** annual interest rate (decimal) for savings-type accounts; null = use the default assumption */
  interest_rate?: number | null;
  /** the rate on file for this bank, kind and balance slab (decimal), used when the account has no rate of its own */
  listed_rate?: number | null;
  /** tax deducted at source on interest (decimal); null = use the default assumption */
  tds_rate?: number | null;
  /** AMFI scheme code once you have confirmed which scheme this fund is */
  amfi_code?: string | null;
  /** units held and the date they were counted (from a fund statement or the monthly update) */
  units?: number | null;
  units_as_of?: string | null;
  /** where the units come from when they were not counted: 'plan' = rebuilt from the start date, amount invested and SIP plan (an estimate) */
  units_source?: 'plan' | null;
  /** active SIP for this fund, if any (from the fund register) */
  sip?: {
    monthly: number;
    startedOn: string;
    stopped: boolean;
    changes?: { from: string; monthly: number }[];
  } | null;
}

export interface ObservationRow {
  id: string;
  asset_id: string;
  kind: string;
  amount: number;
  currency: string;
  fx_rate: number | null;
  as_of: string; // YYYY-MM-DD
  confidence: Confidence;
  source: string;
  created_at: string;
  superseded_by: string | null;
}

export interface FdRow {
  asset_id: string;
  principal: number;
  rate: number;
  booked_on: string;
  maturity_on: string;
  compounding: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'simple';
  bank_maturity_amount: number | null;
  fd_ref_last4?: string | null;
  /** the full deposit number, when it has been entered */
  fd_ref?: string | null;
  /** the day a deposit that is no longer held left (paid out or closed); null: its maturity date is used */
  ended_on?: string | null;
  /** the end date, or the booking date, was read from the monthly tabs rather than from the bank */
  ended_estimated?: boolean;
  start_estimated?: boolean;
  /** cumulative, or interest paid out monthly / quarterly / half-yearly / yearly */
  payout?: string | null;
  /** the deposit this one was renewed from */
  renewed_from?: string | null;
}

export interface PortfolioDefaults {
  /** assumed annual rate on savings balances until you set one per account */
  savingsRate: number;
  tdsRate: number;
  /** INR per unit of foreign currency today; when absent the anchor rate is reused (no FX movement shown) */
  fxToday?: Record<string, number>;
  /** public NAV data for the schemes you hold, newest last */
  navs?: Record<string, { date: string; nav: number }[]>;
  /** add SIP instalments due since the last recorded value to fund estimates (default true) */
  includeSip?: boolean;
  /** days after which a balance is out of date, unless the account has its own */
  freshnessDays?: number;
  /** a deposit grows at the rate that reaches the bank's maturity amount when that is within this many points of its stated rate (Settings) */
  fdRateGap?: number;
}

export const DEFAULT_ASSUMPTIONS: PortfolioDefaults = {
  savingsRate: DEFAULT_CONFIG.estimates.savingsRate,
  tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
};

export interface AssetStatusLine {
  assetId: string;
  freshness: Freshness | 'calculated';
  ageDays: number | null;
  asOf: string | null;
  basis: CurrentValueEstimate['basis'] | null;
  usedAssumption: boolean;
  /** date of the market price (NAV or FX) used for today's estimate, if any */
  marketDate: string | null;
}

export interface Portfolio {
  valued: ValuedAsset[];
  lines: Record<string, AssetStatusLine>;
  netWorth: NetWorthResult;
}

/** Latest usable observation per asset: newest as_of, then newest created_at; superseded rows are ignored. */
export function latestObservations(rows: ObservationRow[]): Map<string, ObservationRow> {
  const best = new Map<string, ObservationRow>();
  for (const o of rows) {
    if (o.superseded_by) continue;
    const cur = best.get(o.asset_id);
    if (!cur || o.as_of > cur.as_of || (o.as_of === cur.as_of && o.created_at > cur.created_at))
      best.set(o.asset_id, o);
  }
  return best;
}

/**
 * Today's portfolio: every holding valued by the central engine (valuation.ts over position.ts), the same rule that values any past
 * day. `extras` carries what a loader read beyond the rows (fund ledgers, savings movements and rate history, confirmed placements of
 * maturity proceeds); without it each holding is valued from its rows alone.
 */
export function buildPortfolio(
  assets: AssetRow[],
  observations: ObservationRow[],
  fds: FdRow[],
  today: Date,
  defaults: PortfolioDefaults = DEFAULT_ASSUMPTIONS,
  extras: ValuationExtras = {},
): Portfolio {
  const input = valuationInput(assets, observations, fds, today, defaults, extras);
  return portfolioFromPosition(input, assets, today, defaults);
}
