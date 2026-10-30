import { profileConfig } from './invest-perf';
import {
  avgCostPerUnit,
  buildIndex,
  buildLedger,
  cagr,
  chainPeriods,
  ledgerTotals,
  rebase,
  returnProfile,
  shownReturn,
  versus,
  trailingTable,
  type Flow,
  type IndexPoint,
  type LedgerRow,
  type LedgerTotals,
  type PeriodDef,
  type ReturnProfile,
  type TrailingReturn,
  type Versus,
  clipSeries,
  heldLine,
  ownPeriods,
  PERF_PERIODS,
  shadowLine,
  xirrTrail,
  type XirrPoint,
  type OwnPeriodRow,
  FUND_RANGE_WORDS,
  holdingProfile,
  monthlyContributions,
  navChart,
  periodChange,
  rangeStart,
  realisedSummary,
  singleInvestmentDate,
  sipCalendar,
  sipSummary,
  unitsOverTime,
  type AppConfig,
  type FundRangeKey,
  type HoldingProfile,
  type MonthContribution,
  type NavChartModel,
  type NavPoint,
  type PeriodChange,
  type RealisedSummary,
  type SeriesPoint,
  type SipCalendar,
  type SipSummary,
  type StatFund,
  type ValuePoint,
} from '@fwos/core';

/** The most points drawn on the price line: a daily price over many years is thinned to this. */
export const NAV_POINTS = 360;

export type DetailFund = StatFund & {
  history: SeriesPoint[];
  trend: SeriesPoint[];
  xirr: number | null;
  xirrEstimated: boolean;
  amfiCode: string | null;
  plan: 'direct' | 'regular' | 'unknown';
  perf: SeriesPoint[];
  flows: Flow[];
  flowsEstimated: boolean;
};

/** One view of the returns: the trailing table against the benchmark, the profile (months, years, falls, rolling) and growth of 100. */
export interface ReturnView {
  profile: ReturnProfile;
  /** the benchmark's returns over the same periods, and the difference */
  versus: {
    def: PeriodDef;
    yours: TrailingReturn | null;
    bench: TrailingReturn | null;
    v: Versus;
  }[];
  /** growth of 100 from one start for the fund and the benchmark, to draw */
  growth: { from: string; fund: IndexPoint[]; bench: IndexPoint[] } | null;
}

/**
 * The fund's returns: where they come from and every view of them. The top-level view (profile, versus, growth) covers only the time
 * the holder has had money in the fund (from the first purchase); `whole` is the fund's whole price history, for comparison.
 */
export interface FundReturns extends ReturnView {
  /** from the fund's published prices, or (when none are loaded) from the values recorded and the money put in */
  basis: 'price' | 'values';
  /** the cash flows behind a value-based line are worked out from the start date and SIP, not a statement */
  estimated: boolean;
  benchName: string | null;
  /** the first purchase (or the start date): the views of the holder's own money start here */
  since: string | null;
  /** the whole price history, from the fund's launch */
  whole: ReturnView;
  /** the holder's own money over each period: value at the start, money in and out, profit, money-weighted return */
  own: OwnPeriodRow[];
  /** the holder's value and money put in on each valuation day, and what the same purchases would be worth in the benchmark */
  shadow: {
    value: IndexPoint[];
    invested: IndexPoint[];
    bench: IndexPoint[];
    /** the XIRR up to each valuation day: yours, and the benchmark's on the same money */
    xirr: XirrPoint[];
  } | null;
}

export interface FundDetail {
  range: FundRangeKey;
  rangeWords: string;
  /** value and money put in inside the range */
  points: SeriesPoint[];
  startsLate: boolean;
  change: PeriodChange | null;
  nav: NavChartModel;
  returns: FundReturns | null;
  /** every transaction with running figures; empty without a statement */
  ledger: LedgerRow[];
  ledgerTotals: LedgerTotals;
  /** units held after each transaction; empty without a statement */
  units: ValuePoint[];
  contributions: MonthContribution[];
  sip: SipSummary;
  calendar: SipCalendar;
  /** how much is long-term: only for equity-oriented funds with known purchases */
  holding: HoldingProfile | null;
  holdingNote: string | null;
  avgCost: number | null;
  avgCostBasis: 'statement' | 'estimated' | 'invested over units' | null;
  /** how far today's price is above (positive) or below the average cost */
  priceVsCost: number | null;
  cagr: number | null;
  cagrFrom: string | null;
  unrealised: number;
  unrealisedPct: number | null;
  realised: RealisedSummary;
  firstOn: string | null;
}

export function buildFundDetail(args: {
  fund: DetailFund;
  /** every published price, oldest first */
  navs: NavPoint[];
  today: string;
  range: FundRangeKey;
  holdingMonths: number | null;
  config: AppConfig['funds'];
  /** the most points drawn on the price line */
  maxPoints: number;
  /** the benchmark proxy's prices, when loaded */
  benchmark?: { name: string | null; navs: IndexPoint[] } | null;
}): FundDetail {
  const f = args.fund;
  const clipped = clipSeries(f.trend, args.range, args.today);
  const profile =
    args.holdingMonths === null
      ? null
      : holdingProfile({
          lots: f.lots,
          basis: f.lotsBasis,
          value: f.value,
          today: args.today,
          holdingMonths: args.holdingMonths,
        });
  const fromLots = profile && profile.basis !== 'none' ? profile.avgCost : null;
  const avgCost = fromLots ?? avgCostPerUnit(f.invested, f.units);
  const nav = f.nav ?? args.navs[args.navs.length - 1]?.nav ?? null;
  const single = singleInvestmentDate(f.txns);
  const first = f.txns.length > 0 ? f.txns.map((t) => t.date).sort()[0]! : f.startedOn;
  const equity = f.taxClass === 'equity';
  const holding = equity && profile && profile.basis !== 'none' ? profile : null;
  const cfgP = profileConfig(args.config);
  const navLine: IndexPoint[] = args.navs.map((n) => ({ date: n.date, value: n.nav }));
  const ledger = buildLedger({
    txns: f.txns,
    navs: navLine,
    navNow: nav,
    today: args.today,
    holdingMonths: equity ? args.holdingMonths : null,
    gapDays: args.config.navGapDays,
  });
  let returns: FundReturns | null = null;
  if (navLine.length >= 2 || f.perf.length >= 3) {
    const byPrice = navLine.length >= 2;
    const line: IndexPoint[] = byPrice
      ? navLine
      : buildIndex(
          chainPeriods(
            f.perf.map((p) => ({ date: p.date, value: p.value })),
            f.flows,
          ),
        );
    const benchLine = args.benchmark?.navs ?? [];
    const buys = f.txns
      .filter((t) => t.units > 0)
      .map((t) => t.date)
      .sort();
    const since = buys[0] ?? f.startedOn ?? null;
    const view = (fundLine: IndexPoint[], bench: IndexPoint[], from: string | null): ReturnView => {
      const profile = returnProfile(fundLine, args.today, cfgP);
      const benchTable = bench.length >= 2 ? trailingTable(bench, args.today, cfgP) : [];
      const rows = profile.trailing.map(({ def, r }) => {
        const b = benchTable.find((x) => x.def.key === def.key)?.r ?? null;
        const [v] = versus(
          [{ key: def.key, ret: r ? shownReturn(r) : null }],
          [{ key: def.key, ret: b ? shownReturn(b) : null }],
        );
        return { def, yours: r, bench: b, v: v! };
      });
      // growth of 100 from the first day both lines exist (never before `from`)
      let growth: ReturnView['growth'] = null;
      if (byPrice && benchLine.length >= 2) {
        const start = [fundLine[0]!.date, benchLine[0]!.date, from ?? '']
          .filter(Boolean)
          .sort()
          .pop()!;
        const a = rebase(navLine, start);
        const b = rebase(benchLine, start);
        if (a.length >= 2 && b.length >= 2) growth = { from: start, fund: a, bench: b };
      }
      return { profile, versus: rows, growth };
    };
    // the holder's view starts with their first purchase; the benchmark is cut the same way so "All" means the same stretch
    const mine = byPrice
      ? view(heldLine(line, since), heldLine(benchLine, since), since)
      : view(line, benchLine, since);
    const whole = byPrice ? view(line, benchLine, null) : mine;
    const valuePts = f.perf.map((p) => ({ date: p.date, value: p.value }));
    const own = ownPeriods({
      points: valuePts,
      flows: f.flows,
      today: args.today,
      defs: PERF_PERIODS.filter((d) => d.key !== '1w'),
      annualiseAfterMonths: args.config.annualiseAfterMonths,
    });
    const benchMine =
      benchLine.length >= 2
        ? shadowLine(
            f.flows,
            benchLine,
            valuePts.map((p) => p.date),
          )
        : [];
    returns = {
      ...mine,
      basis: byPrice ? 'price' : 'values',
      estimated: !byPrice && f.flowsEstimated,
      benchName: args.benchmark?.name ?? null,
      since,
      whole,
      own,
      shadow:
        valuePts.length >= 2
          ? {
              value: valuePts,
              invested: f.perf
                .filter((p) => p.invested !== null)
                .map((p) => ({ date: p.date, value: p.invested as number })),
              bench: benchMine,
              xirr: xirrTrail(f.flows, valuePts, benchMine),
            }
          : null,
    };
  }
  return {
    returns,
    ledger,
    ledgerTotals: ledgerTotals(ledger),
    range: args.range,
    rangeWords: FUND_RANGE_WORDS[args.range],
    points: clipped.points,
    startsLate: clipped.startsLate,
    change: periodChange(clipped.points),
    nav: navChart({
      navs: args.navs,
      txns: f.txns,
      avgCost,
      // the price line starts with the first purchase (or the start of the range, when later): years before the money went in say
      // nothing about it
      from:
        [rangeStart(args.range, args.today), first]
          .filter((x): x is string => !!x)
          .sort()
          .pop() ?? null,
      maxPoints: args.maxPoints,
    }),
    units: unitsOverTime(
      f.txns.map((t) => ({ date: t.date, units: t.units, balance: t.balance ?? null })),
    ),
    contributions: monthlyContributions(f.txns, args.today, args.config.contributionMonths),
    sip: sipSummary({
      txns: f.txns,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
      startedOn: f.startedOn,
      today: args.today,
    }),
    calendar: sipCalendar(
      {
        txns: f.txns,
        sipMonthly: f.sipMonthly,
        sipStopped: f.sipStopped,
        startedOn: f.startedOn,
        today: args.today,
      },
      args.config.calendarMonths,
    ),
    holding,
    holdingNote: holding
      ? null
      : !equity
        ? 'The one-year rule applies to equity-oriented funds only. This fund is taxed another way; see the Tax page.'
        : args.holdingMonths === null
          ? 'No long-term period is set in the tax rules in Settings.'
          : 'The purchases are not known, so the long-term share cannot be worked out. Import a fund statement.',
    avgCost,
    avgCostBasis:
      avgCost === null
        ? null
        : fromLots !== null
          ? profile!.basis === 'statement'
            ? 'statement'
            : 'estimated'
          : 'invested over units',
    priceVsCost: avgCost !== null && nav !== null ? nav / avgCost - 1 : null,
    cagr:
      single !== null
        ? cagr({
            invested: f.invested,
            value: f.value,
            from: single,
            today: args.today,
            minMonths: args.config.annualiseAfterMonths,
          })
        : null,
    cagrFrom: single,
    unrealised: f.value - f.invested,
    unrealisedPct: f.invested > 0 ? f.value / f.invested - 1 : null,
    realised: realisedSummary([f], args.holdingMonths),
    firstOn: first,
  };
}
