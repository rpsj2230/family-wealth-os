/**
 * How the whole portfolio (or one person's funds) has performed: the funds' values on common dates and their cash flows give a
 * time-weighted index, and every table and chart on the Performance tab comes from that index (see return-profile.ts). Also the
 * rupee gain behind each period and year, and the comparison with the benchmark.
 *
 * Funds with a fund statement have real cash flows. Funds without one have flows worked out from the start date and SIP plan; the
 * result says how much of the value rests on such estimates so the page can label it.
 */
import { benchmarkWhatIf, versus, type Versus, type WhatIf } from './benchmark';
import type { SeriesPoint } from './fund-series';
import { combineSeries } from './fund-series';
import {
  buildIndex,
  chainPeriods,
  returnProfile,
  shownReturn,
  trailingTable,
  type TrailingReturn,
  type Flow,
  type IndexPoint,
  type PerfPeriod,
  type PeriodDef,
  type PeriodKey,
  type ProfileConfig,
  type ReturnProfile,
  type YearKind,
  type YearReturn,
  PERF_PERIODS,
} from './return-profile';

export interface PerfFundIn {
  assetId: string;
  /** the fund valued on the common dates (month ends, the starts of the periods and today) */
  perf: SeriesPoint[];
  /** money in (positive) and out (negative) */
  flows: Flow[];
  /** the flows are worked out from the start date and SIP plan, not read from a statement */
  flowsEstimated: boolean;
  /**
   * The first day the figures about this fund rest on estimates, when that is not simply the start of its history (instalments
   * assumed from a SIP plan make only the days after them estimated). Left out, a fund with estimated flows is estimated throughout.
   * The same rule as `estimatedSince` of a fund in period-gains, so a period carries the same est. mark on every page.
   */
  estimatedSince?: string | null;
  value: number;
}

export interface PeriodGain {
  gain: number;
  netIn: number;
  startValue: number;
  endValue: number;
}

export interface YearRow extends YearReturn {
  gain: number;
  netIn: number;
  startValue: number;
  endValue: number;
}

export interface PortfolioPerformance {
  profile: ReturnProfile;
  index: IndexPoint[];
  periods: PerfPeriod[];
  /** rupee gain over each trailing period, where the history reaches back */
  periodGains: Partial<Record<PeriodKey, PeriodGain>>;
  calendar: YearRow[];
  financial: YearRow[];
  /** the share of current value in funds whose cash flows are estimated, 0 to 1 */
  estimatedShare: number;
  /** the first day an estimated cash flow could matter, or null */
  estimatedSince: string | null;
  /** the benchmark's returns for the same periods, and the difference */
  versus: { def: PeriodDef; v: Versus }[];
  whatIf: WhatIf | null;
}

/**
 * The periods of a set of funds together (their values added on common dates, their cash flows added) and the first day any
 * estimated cash flow could matter: the earliest valued day of a fund whose flows are worked out from its SIP plan.
 */
export function fundsPeriods(funds: PerfFundIn[]): {
  periods: PerfPeriod[];
  estimatedSince: string | null;
} {
  const value: IndexPoint[] = combineSeries(funds.map((f) => f.perf)).map((p) => ({
    date: p.date,
    value: p.value,
  }));
  const est = funds
    .map((f) =>
      f.estimatedSince !== undefined
        ? f.estimatedSince
        : f.flowsEstimated
          ? (f.perf[0]?.date ?? null)
          : null,
    )
    .filter((d): d is string => d !== null)
    .sort()[0];
  return {
    periods: chainPeriods(
      value,
      funds.flatMap((f) => f.flows),
    ),
    estimatedSince: est ?? null,
  };
}

const sumGain = (periods: PerfPeriod[], from: string, to: string): PeriodGain => {
  const inside = periods.filter((p) => p.from >= from && p.to <= to);
  return {
    gain: inside.reduce((a, p) => a + p.gain, 0),
    netIn: inside.reduce((a, p) => a + p.flow, 0),
    startValue: inside[0]?.startValue ?? 0,
    endValue: inside[inside.length - 1]?.endValue ?? 0,
  };
};

const yearRows = (periods: PerfPeriod[], years: YearReturn[]): YearRow[] =>
  years.map((y) => ({ ...y, ...sumGain(periods, y.from, y.to) }));

export function portfolioPerformance(args: {
  funds: PerfFundIn[];
  today: string;
  cfg: ProfileConfig;
  /** the benchmark's prices, oldest first; empty when none is loaded */
  benchmark: IndexPoint[];
}): PortfolioPerformance {
  const flows = args.funds.flatMap((f) => f.flows);
  const { periods, estimatedSince } = fundsPeriods(args.funds);
  const index = buildIndex(periods);
  const profile = returnProfile(index, args.today, args.cfg);
  const periodGains: PortfolioPerformance['periodGains'] = {};
  for (const t of profile.trailing)
    if (t.r) periodGains[t.def.key] = sumGain(periods, t.r.from, t.r.to);
  const totalValue = args.funds.reduce((a, f) => a + f.value, 0);
  const estimated = args.funds
    .filter((f) => f.flowsEstimated || (f.estimatedSince ?? null) !== null)
    .reduce((a, f) => a + f.value, 0);
  const bench = returnProfileLite(args.benchmark, args.today, args.cfg);
  const vs = profile.trailing.map(({ def, r }) => {
    const b = bench.find((x) => x.def.key === def.key)?.r ?? null;
    // compare like with like: both need a full period
    const [row] = versus(
      [{ key: def.key, ret: r ? shownReturn(r) : null }],
      [{ key: def.key, ret: b ? shownReturn(b) : null }],
    );
    return { def, v: row! };
  });
  return {
    profile,
    index,
    periods,
    periodGains,
    calendar: yearRows(periods, profile.calendar),
    financial: yearRows(periods, profile.financial),
    estimatedShare: totalValue > 0 ? estimated / totalValue : 0,
    estimatedSince,
    versus: vs,
    whatIf:
      args.benchmark.length >= 2
        ? benchmarkWhatIf({
            flows,
            navs: args.benchmark,
            today: args.today,
            gapDays: args.cfg.gapDays,
          })
        : null,
  };
}

/** The benchmark's trailing returns only (it needs no month grid or risk figures here). */
function returnProfileLite(
  series: IndexPoint[],
  today: string,
  cfg: ProfileConfig,
): { def: PeriodDef; r: TrailingReturn | null }[] {
  if (series.length < 2) return PERF_PERIODS.map((def) => ({ def, r: null }));
  return trailingTable(series, today, cfg);
}

export type { YearKind };
