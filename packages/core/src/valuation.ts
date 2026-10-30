/**
 * The central valuation service: today's figures for every holding come from the position engine (position.ts), the same rule that
 * values any past day, so today and the history can never be worked out two ways. `buildPortfolio` (portfolio.ts) is a thin adapter
 * over this, keeping the shape every page, report, job and e-mail already reads (valued holdings, a status line per holding, net
 * worth by person, kind and liquidity).
 *
 * The input is built from database rows. A loader that has read the funds' ledgers, the savings accounts' confirmed movements and rate
 * history, and the confirmed placements of maturity proceeds passes them in `extras`; without them a fund is moved on from its last
 * value with its price and its SIP, a savings account earns its one rate, and maturity proceeds are found from the evidence on file.
 *
 * Pure: no I/O.
 */
import { DEFAULT_CONFIG } from './config';
import { contractOutOn, depositOn } from './deposit-contract';
import type { CurrentValueEstimate, ComponentKind, Basis } from './estimate';
import { classifyFreshness, type Freshness } from './freshness';
import { aggregateNetWorth, type ValuedAsset } from './networth';
import {
  contractOf,
  positionAsOf,
  type PosFund,
  type PositionAsset,
  type PositionConfig,
  type PositionInput,
  type ValuedHolding,
} from './position';
import { attachProceeds, positionAssetsFrom, type PositionObservation } from './position-build';
import type {
  AssetRow,
  AssetStatusLine,
  FdRow,
  ObservationRow,
  Portfolio,
  PortfolioDefaults,
} from './portfolio';
import type { RateStep, SavingsTxn } from './savings-accrual';

export interface ValuationExtras {
  /** each fund as the engine reads it (ledger, prices, statement values, plan); without, the fund is moved on from its last value */
  funds?: Record<string, PosFund>;
  /** confirmed money in (+) and out (-) of each savings account */
  moves?: Record<string, SavingsTxn[]>;
  /** each savings account's rates by effective date, with slabs */
  rates?: Record<string, RateStep[]>;
  /** confirmed placements of each deposit's maturity proceeds */
  placements?: Record<string, { on: string; amount: number }[]>;
  /** settings the engine reads that the portfolio defaults do not carry */
  config?: Partial<PositionConfig>;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A fund with nothing but its row: its unit count and its SIP, moved on with the prices on file (never rebuilt from a plan). */
function rowFund(a: AssetRow, d: PortfolioDefaults): PosFund {
  const navs = a.amfi_code ? (d.navs?.[a.amfi_code] ?? []) : [];
  const counted =
    typeof a.units === 'number' && a.units > 0 && typeof a.units_as_of === 'string'
      ? { units: a.units, asOf: a.units_as_of }
      : null;
  return {
    txns: [],
    navs,
    units: counted,
    snapshots: [],
    flows: [],
    hasStatement: false,
    estimatedSince: null,
    sip: d.includeSip === false ? null : (a.sip ?? null),
    plan: null,
    noPlan: a.units_source !== 'plan',
  };
}

/** The engine's settings from the portfolio defaults and the household's Settings. */
export function valuationConfig(
  today: string,
  d: PortfolioDefaults,
  over: Partial<PositionConfig> = {},
): PositionConfig {
  const fx: PositionConfig['fx'] = {};
  for (const [c, rate] of Object.entries(d.fxToday ?? {})) fx[c] = [{ date: today, rate }];
  return {
    today,
    savingsRate: d.savingsRate,
    tdsRate: d.tdsRate,
    navGapDays: DEFAULT_CONFIG.funds.navGapDays,
    includeSip: d.includeSip ?? true,
    planTolerance: DEFAULT_CONFIG.funds.planTolerance,
    rateGap: d.fdRateGap ?? DEFAULT_CONFIG.estimates.observedRateGap,
    growth: { property: 0, retirement: 0, other: 0 },
    fx,
    hideMaturedAfterDays: DEFAULT_CONFIG.deposits.hideMaturedAfterDays,
    ...over,
  };
}

/** The engine's input for a household from its rows: every holding, with its records, terms, ledger, rates and movements. */
export function valuationInput(
  assets: AssetRow[],
  observations: (ObservationRow & { source_ref?: string | null })[],
  fds: FdRow[],
  today: Date,
  defaults: PortfolioDefaults,
  extras: ValuationExtras = {},
): PositionInput {
  const todayIso = iso(today);
  const config = valuationConfig(todayIso, defaults, extras.config);
  const funds: Record<string, PosFund> = {};
  for (const a of assets)
    if (a.type === 'mutual_fund') funds[a.id] = extras.funds?.[a.id] ?? rowFund(a, defaults);
  const built = positionAssetsFrom({
    assets,
    observations: observations as PositionObservation[],
    fds,
    funds,
    ...(extras.moves ? { moves: extras.moves } : {}),
    ...(extras.rates ? { rates: extras.rates } : {}),
  });
  return { assets: attachProceeds(built, config, extras.placements), config };
}

// ------------------------------------------------------------------------------------------------
// The portfolio shape, from the engine's holdings
// ------------------------------------------------------------------------------------------------
const COMPONENT: Record<string, ComponentKind> = {
  bank_account: 'interest',
  fixed_deposit: 'interest',
  mutual_fund: 'market',
};

/** How far a value can be trusted, in the words of the older estimate model the pages still read. */
function basisOf(h: ValuedHolding): Basis {
  switch (h.basis) {
    case 'terms':
    case 'bank_amount':
    case 'fx':
      return 'calculated';
    case 'units_nav':
      return h.estimated ? 'estimated' : 'calculated';
    case 'recorded':
      return 'carried_forward';
    default:
      return 'estimated';
  }
}

function methodOf(h: ValuedHolding): string {
  switch (h.basis) {
    case 'terms':
    case 'bank_amount':
      return h.deposit?.proceeds ? 'fd_proceeds' : 'fd_accrual';
    case 'rate':
      return 'savings_interest';
    case 'units_nav':
      return h.estimated ? 'units_nav_sip' : 'units_nav';
    case 'nav_scaled':
      return 'nav_ratio';
    case 'sheet':
      return 'nav_ratio';
    case 'fx':
      return 'fx';
    case 'assumed':
      return 'assumed_growth';
    default:
      return 'carry_forward';
  }
}

/** A holding's value as the estimate the pages read: the record it rests on, today's figure, and what lies between. */
function estimateOf(h: ValuedHolding, a: PositionAsset, today: Date): CurrentValueEstimate | null {
  if (h.state !== 'held' || h.value === null) return null;
  const anchorDate = h.savings?.baseline.date ?? (a.fd ? a.fd.bookedOn : h.asOf) ?? iso(today);
  const rec = a.records.filter((r) => !r.sheet && r.date === h.asOf).pop();
  const foreign = a.currency !== 'INR' && a.type !== 'fixed_deposit';
  const anchorAmount = h.savings
    ? h.savings.baseline.amount
    : a.fd
      ? a.fd.principal
      : rec
        ? foreign
          ? rec.amount * (rec.fxRate ?? 0)
          : rec.amount
        : h.value;
  const anchorAsOf = new Date(`${anchorDate}T00:00:00Z`);
  const kind: ComponentKind =
    a.currency !== 'INR' && a.type !== 'fixed_deposit' ? 'fx' : (COMPONENT[a.type] ?? 'market');
  const delta = h.value - anchorAmount;
  const components: CurrentValueEstimate['components'] = [];
  if (h.sipAssumed && h.sipAssumed.invested > 0) {
    components.push({
      kind: 'contribution',
      amount: h.sipAssumed.invested,
      note: `${h.sipAssumed.count} SIP instalments assumed`,
    });
    if (Math.abs(delta - h.sipAssumed.invested) > 1e-9)
      components.push({ kind, amount: delta - h.sipAssumed.invested, note: h.note });
  } else if (Math.abs(delta) > 1e-9) components.push({ kind, amount: delta, note: h.note });
  return {
    anchorAmount,
    anchorAsOf,
    estimatedAmount: h.value,
    estimatedOn: today,
    ageDays: Math.max(0, Math.round((today.getTime() - anchorAsOf.getTime()) / 86_400_000)),
    components,
    basis: basisOf(h),
    method: methodOf(h),
  };
}

/**
 * The portfolio on a day from the engine: each holding valued by its one rule, net worth summed from those values. A holding the engine
 * says is not held (a deposit that matured and was placed, a fund sold, nothing recorded yet) is listed as not counted, never as zero.
 */
export function portfolioFromPosition(
  input: PositionInput,
  rows: AssetRow[],
  today: Date,
  defaults: PortfolioDefaults,
): Portfolio {
  const todayIso = iso(today);
  const day = positionAsOf(input, todayIso);
  const byId = new Map(input.assets.map((a) => [a.assetId, a]));
  const rowOf = new Map(rows.map((r) => [r.id, r]));
  const valued: ValuedAsset[] = [];
  const lines: Record<string, AssetStatusLine> = {};
  for (const h of day.holdings) {
    const a = byId.get(h.assetId)!;
    const row = rowOf.get(h.assetId)!;
    let estimate = estimateOf(h, a, today);
    const proceeds = !!h.deposit?.proceeds;
    // proceeds awaiting confirmation are counted whatever the stored status says ("matured, not confirmed" from the sheet included)
    let status = proceeds ? 'active' : a.status;
    if (a.fd && h.state === 'ended' && a.status === 'active') {
      // matured or closed, its proceeds not counted (placed, probably placed, or assumed placed): on the list to confirm, out of the totals
      status = 'matured_unconfirmed';
      const con = contractOf(a.fd, input.config);
      const paid = depositOn(con, contractOutOn(con)).proceeds;
      estimate =
        paid !== null
          ? {
              anchorAmount: a.fd.principal,
              anchorAsOf: new Date(`${a.fd.bookedOn}T00:00:00Z`),
              estimatedAmount: paid,
              estimatedOn: today,
              ageDays: 0,
              components: [{ kind: 'interest', amount: paid - a.fd.principal, note: h.note }],
              basis: 'calculated',
              method: 'fd_accrual',
            }
          : null;
    }
    valued.push({
      assetId: h.assetId,
      ownerId: h.ownerId,
      type: h.type,
      status,
      name: h.name,
      estimate,
      ...(defaults.notCounted?.includes(h.type) ? { notCounted: 'setting' as const } : {}),
      ...(h.savings || h.fundSplit
        ? { detail: { savings: h.savings ?? null, fund: h.fundSplit ?? null } }
        : {}),
    });
    let freshness: AssetStatusLine['freshness'] = 'missing';
    let ageDays: number | null = null;
    const lastRec = a.records.filter((r) => !r.sheet).pop() ?? null;
    if (a.fd)
      freshness =
        status === 'matured_unconfirmed' || proceeds ? 'older_than_expected' : 'calculated';
    else if (lastRec) {
      const f = classifyFreshness({
        asOf: new Date(`${lastRec.date}T00:00:00Z`),
        today,
        expectedDays:
          row.expected_freshness_days ??
          defaults.freshnessDays ??
          DEFAULT_CONFIG.estimates.freshnessDays,
      });
      freshness = f.status as Freshness;
      ageDays = f.ageDays;
    } else if (h.state === 'held' && a.type === 'mutual_fund') freshness = 'calculated';
    const usedAssumption =
      a.type === 'bank_account' &&
      a.currency === 'INR' &&
      a.rate.own === null &&
      a.rate.listed === null &&
      !(a.rates && a.rates.length);
    const marketDate =
      a.type === 'mutual_fund' && h.basis && h.basis !== 'recorded' && h.asOf && h.basis !== 'sheet'
        ? a.fund?.navs.length
          ? a.fund.navs[a.fund.navs.length - 1]!.date
          : null
        : a.currency !== 'INR' && a.type !== 'fixed_deposit' && defaults.fxToday?.[a.currency]
          ? 'live'
          : null;
    lines[h.assetId] = {
      assetId: h.assetId,
      freshness,
      ageDays,
      asOf: a.fd ? a.fd.bookedOn : (lastRec?.date ?? null),
      basis: estimate?.basis ?? null,
      usedAssumption,
      marketDate,
    };
  }
  return { valued, lines, netWorth: aggregateNetWorth(valued) };
}
