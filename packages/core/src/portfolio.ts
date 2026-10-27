/**
 * Turns database rows (assets, latest observations, fixed deposits) into valued assets for net worth.
 * Pure: no I/O. The web app fetches rows and calls buildPortfolio().
 */
import { DEFAULT_CONFIG } from './config';
import { fdEffectiveRate } from './fd';
import {
  carryForward,
  estimateFd,
  estimateForeign,
  estimateFundUnitsWithSip,
  estimateFundWithSip,
  estimateSavings,
  type CurrentValueEstimate,
} from './estimate';
import { effectiveDepositStatus } from './deposit-state';
import { classifyFreshness, type Confidence, type Freshness } from './freshness';
import {
  aggregateNetWorth,
  type AssetType,
  type NetWorthResult,
  type ValuedAsset,
} from './networth';

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

const dt = (s: string) => new Date(`${s}T00:00:00Z`);

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

export function buildPortfolio(
  assets: AssetRow[],
  observations: ObservationRow[],
  fds: FdRow[],
  today: Date,
  defaults: PortfolioDefaults = DEFAULT_ASSUMPTIONS,
): Portfolio {
  const latest = latestObservations(observations);
  const fdByAsset = new Map(fds.map((f) => [f.asset_id, f]));
  const todayIso = today.toISOString().slice(0, 10);
  const valued: ValuedAsset[] = [];
  const lines: Record<string, AssetStatusLine> = {};

  for (const a of assets) {
    const obs = latest.get(a.id) ?? null;
    let estimate: CurrentValueEstimate | null = null;
    let usedAssumption = false;
    let marketDate: string | null = null;
    let freshness: AssetStatusLine['freshness'] = 'missing';
    let ageDays: number | null = null;
    let status = a.status;

    const fd = a.type === 'fixed_deposit' ? fdByAsset.get(a.id) : undefined;
    if (fd) {
      // An FD is valued from its contract, so it is never "stale"; only a matured-but-unconfirmed FD needs attention.
      const eff = fdEffectiveRate({
        principal: fd.principal,
        annualRate: fd.rate,
        bookedOn: dt(fd.booked_on),
        maturityOn: dt(fd.maturity_on),
        compounding: fd.compounding,
        bankMaturityAmount: fd.bank_maturity_amount,
        maxGap: defaults.fdRateGap ?? DEFAULT_CONFIG.estimates.observedRateGap,
      });
      estimate = estimateFd({
        principal: fd.principal,
        annualRate: eff.rate,
        bookedOn: dt(fd.booked_on),
        today,
        maturityOn: dt(fd.maturity_on),
        compounding: fd.compounding,
      });
      // One rule for every total: once the date has passed the money has left the deposit (it went into a savings account or another
      // deposit, which are counted on their own), so a deposit still marked active is valued as matured and not confirmed. A deposit
      // maturing today still counts until tomorrow.
      status = effectiveDepositStatus(a.status, fd.maturity_on, todayIso);
      freshness = status === 'matured_unconfirmed' ? 'older_than_expected' : 'calculated';
    } else if (obs) {
      const asOf = dt(obs.as_of);
      const f = classifyFreshness({
        asOf,
        today,
        expectedDays:
          a.expected_freshness_days ??
          defaults.freshnessDays ??
          DEFAULT_CONFIG.estimates.freshnessDays,
        confidence: obs.confidence,
      });
      freshness = f.status;
      ageDays = f.ageDays;
      if (a.type === 'bank_account' && a.currency === 'INR') {
        usedAssumption = (a.interest_rate ?? null) === null && (a.listed_rate ?? null) === null;
        estimate = estimateSavings({
          balance: obs.amount,
          balanceAsOf: asOf,
          today,
          annualRate: a.interest_rate ?? a.listed_rate ?? defaults.savingsRate,
          tdsRate: a.tds_rate ?? defaults.tdsRate,
        });
      } else if (a.currency !== 'INR') {
        const anchor = obs.fx_rate;
        if (anchor && anchor > 0) {
          const today_ = defaults.fxToday?.[a.currency] ?? anchor;
          if (defaults.fxToday?.[a.currency]) marketDate = 'live';
          estimate = estimateForeign({
            nativeAmount: obs.amount,
            anchorRate: anchor,
            anchorAsOf: asOf,
            rateToday: today_,
            today,
          });
        }
      } else if (a.type === 'mutual_fund' && a.amfi_code && defaults.navs?.[a.amfi_code]?.length) {
        // No unit counts yet: scale the last recorded value by the NAV change since that date.
        const series = defaults.navs[a.amfi_code]!;
        const last = series[series.length - 1]!;
        const atAnchor = [...series].reverse().find((n) => n.date <= obs.as_of) ?? null;
        const near =
          atAnchor && (dt(obs.as_of).getTime() - dt(atAnchor.date).getTime()) / 86_400_000 <= 7;
        const unitsFresh =
          typeof a.units === 'number' &&
          a.units > 0 &&
          typeof a.units_as_of === 'string' &&
          a.units_as_of >= obs.as_of;
        estimate = unitsFresh
          ? estimateFundUnitsWithSip({
              units: a.units as number,
              unitsAsOf: dt(a.units_as_of as string),
              anchorAmount: obs.amount,
              anchorAsOf: asOf,
              navToday: last.nav,
              navOn: (d) => [...series].reverse().find((n) => n.date <= d)?.nav ?? null,
              sip: defaults.includeSip === false ? null : (a.sip ?? null),
              today,
            })
          : estimateFundWithSip({
              anchorAmount: obs.amount,
              anchorAsOf: asOf,
              navAtAnchor: near ? atAnchor!.nav : null,
              navToday: last.nav,
              navOn: (d) => [...series].reverse().find((n) => n.date <= d)?.nav ?? null,
              sip: defaults.includeSip === false ? null : (a.sip ?? null),
              today,
            });
        if (estimate.basis !== 'carried_forward') marketDate = last.date;
      } else {
        estimate = carryForward({ amount: obs.amount, asOf, today });
      }
    }
    valued.push({
      assetId: a.id,
      ownerId: a.owner_id,
      type: a.type,
      status,
      name: a.nickname,
      estimate,
    });
    lines[a.id] = {
      assetId: a.id,
      freshness,
      ageDays,
      asOf: fd ? fd.booked_on : (obs?.as_of ?? null),
      basis: estimate?.basis ?? null,
      usedAssumption,
      marketDate,
    };
  }
  return { valued, lines, netWorth: aggregateNetWorth(valued) };
}
