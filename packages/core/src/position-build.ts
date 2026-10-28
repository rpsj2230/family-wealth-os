/**
 * Turns database rows into the input of the position engine (position.ts). Pure: the loaders in packages/data read the rows, this
 * only arranges them, so the web app, the daily summary and the history rebuild all start from the same input.
 */
import type { AppConfig } from './config';
import type { SipPlan } from './estimate';
import { isEstimateLine, openingFlow, orderLines } from './ledger-check';
import { flowsOfFund } from './perf-inputs';
import type { AssetRow, FdRow, ObservationRow } from './portfolio';
import {
  SHEET_FUND_REF,
  type CurrentValue,
  type PosFund,
  type PosRecord,
  type PositionAsset,
  type PositionConfig,
  type PositionInput,
} from './position';
import type { Portfolio } from './portfolio';

export type PositionObservation = ObservationRow & { source_ref?: string | null };

/** The settings and market prices the engine reads. `fx` is the history of INR per unit by currency, oldest first. */
export function positionConfig(
  cfg: AppConfig,
  today: string,
  fx: PositionConfig['fx'] = {},
): PositionConfig {
  return {
    today,
    savingsRate: cfg.estimates.savingsRate,
    tdsRate: cfg.estimates.interestTdsRate,
    navGapDays: cfg.funds.navGapDays,
    includeSip: cfg.estimates.includeSip,
    planTolerance: cfg.funds.planTolerance,
    rateGap: cfg.estimates.observedRateGap,
    growth: {
      property: cfg.estimates.assumedGrowthProperty,
      retirement: cfg.estimates.assumedGrowthRetirement,
      other: cfg.estimates.assumedGrowthOther,
    },
    fx,
  };
}

/** What net worth says each holding is worth today: the figure the engine uses for the day `today` itself. */
export function currentValues(portfolio: Portfolio): Record<string, CurrentValue> {
  const out: Record<string, CurrentValue> = {};
  const excluded = new Set(portfolio.netWorth.excluded.map((e) => e.assetId));
  for (const v of portfolio.valued)
    if (v.estimate)
      out[v.assetId] = { value: v.estimate.estimatedAmount, counted: !excluded.has(v.assetId) };
  return out;
}

/** The records of an asset in the order they happened; a value copied from the monthly sheet to check a fund against is marked as such. */
export function recordsOf(observations: PositionObservation[]): Map<string, PosRecord[]> {
  const out = new Map<string, PosRecord[]>();
  const live = observations
    .filter((o) => !o.superseded_by)
    .sort((a, b) => a.as_of.localeCompare(b.as_of) || a.created_at.localeCompare(b.created_at));
  for (const o of live) {
    const list = out.get(o.asset_id) ?? out.set(o.asset_id, []).get(o.asset_id)!;
    list.push({
      date: o.as_of,
      amount: o.amount,
      currency: o.currency,
      fxRate: o.fx_rate,
      ...((o.source_ref ?? '').startsWith(SHEET_FUND_REF) ? { sheet: true } : {}),
    });
  }
  return out;
}

export function positionAssetsFrom(args: {
  assets: AssetRow[];
  observations: PositionObservation[];
  fds: FdRow[];
  funds?: Record<string, PosFund>;
}): PositionAsset[] {
  const recs = recordsOf(args.observations);
  const fd = new Map(args.fds.map((f) => [f.asset_id, f]));
  return args.assets.map((a) => {
    const f = a.type === 'fixed_deposit' ? fd.get(a.id) : undefined;
    return {
      assetId: a.id,
      ownerId: a.owner_id,
      type: a.type,
      status: a.status,
      name: a.nickname,
      currency: a.currency,
      rate: {
        own: a.interest_rate ?? null,
        listed: a.listed_rate ?? null,
        tds: a.tds_rate ?? null,
      },
      records: recs.get(a.id) ?? [],
      fd: f
        ? {
            principal: f.principal,
            rate: f.rate,
            bookedOn: f.booked_on,
            maturityOn: f.maturity_on,
            compounding: f.compounding,
            bankMaturityAmount: f.bank_maturity_amount,
            endedOn: f.ended_on ?? null,
          }
        : null,
      fund: args.funds?.[a.id] ?? null,
    };
  });
}

export function positionInputFrom(args: {
  assets: AssetRow[];
  observations: PositionObservation[];
  fds: FdRow[];
  funds?: Record<string, PosFund>;
  config: AppConfig;
  today: string;
  fx?: PositionConfig['fx'];
  portfolio?: Portfolio;
}): PositionInput {
  return {
    assets: positionAssetsFrom(args),
    config: positionConfig(args.config, args.today, args.fx),
    ...(args.portfolio ? { current: currentValues(args.portfolio) } : {}),
  };
}

/** One stored line of a fund's ledger. */
export interface PosFundLine {
  date: string;
  kind?: string | null;
  units: number;
  amount: number;
  nav?: number | null;
  balance?: number | null;
  source?: string | null;
  description?: string | null;
}

/**
 * A fund's ledger, prices and flows as the engine reads them. The lines are put in the order they happened; the units held before the
 * first line count as bought on its day; the flows are the statement's or (estimated) rebuilt from the plan, exactly as Investments
 * works them out, so its profit and the period figures start from the same money in and out.
 */
export function posFundFrom(args: {
  lines: PosFundLine[];
  navs: { date: string; nav: number }[];
  units: { units: number; asOf: string } | null;
  snapshots: { date: string; value: number }[];
  plan: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean;
  } | null;
  /** the SIP plan with its dated changes, for a fund with no ledger (instalments since its last value) */
  sip?: SipPlan | null;
  today: string;
  unitTolerance: number;
}): PosFund {
  const ordered = orderLines(args.lines, args.unitTolerance);
  const opening = openingFlow(args.lines, args.unitTolerance);
  const txns: PosFund['txns'] = [
    ...(opening
      ? [{ date: opening.date, units: opening.units, amount: opening.amount, estimated: false }]
      : []),
    ...ordered.map((l) => ({
      date: l.date,
      units: l.units,
      amount: l.amount,
      estimated: isEstimateLine(l),
    })),
  ];
  const fl = flowsOfFund({
    txns: args.lines.map((l) => ({
      date: l.date,
      units: l.units,
      amount: l.amount,
      nav: l.nav ?? null,
      balance: l.balance ?? null,
      kind: l.kind ?? null,
      source: l.source ?? null,
      description: l.description ?? null,
    })),
    plan: args.plan,
    today: args.today,
    unitTolerance: args.unitTolerance,
  });
  const hasStatement = args.lines.some((l) => !isEstimateLine(l));
  const assumed = args.lines
    .filter(isEstimateLine)
    .map((l) => l.date)
    .sort()[0];
  const planned = fl.estimated || !hasStatement;
  const first = [txns[0]?.date, args.plan?.startedOn ?? undefined]
    .filter((x): x is string => !!x)
    .sort()[0];
  return {
    txns,
    navs: args.navs,
    units: args.units,
    snapshots: args.snapshots,
    flows: fl.flows,
    hasStatement,
    estimatedSince: planned ? (first ?? '0000-01-01') : (assumed ?? null),
    ...(args.sip ? { sip: args.sip } : {}),
    ...(args.plan
      ? { plan: { invested: args.plan.invested, startedOn: args.plan.startedOn } }
      : {}),
  };
}
