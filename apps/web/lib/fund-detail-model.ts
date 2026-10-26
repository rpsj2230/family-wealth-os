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

/** The fund's returns: where they come from and every view of them. */
export interface FundReturns {
  /** from the fund's published prices, or (when none are loaded) from the values recorded and the money put in */
  basis: 'price' | 'values';
  /** the cash flows behind a value-based line are worked out from the start date and SIP, not a statement */
  estimated: boolean;
  profile: ReturnProfile;
  /** the benchmark's returns over the same periods, and the difference */
  versus: {
    def: PeriodDef;
    yours: TrailingReturn | null;
    bench: TrailingReturn | null;
    v: Versus;
  }[];
  benchName: string | null;
  /** growth of 100 from one start for the fund and the benchmark, to draw */
  growth: { from: string; fund: IndexPoint[]; bench: IndexPoint[] } | null;
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
    const profile = returnProfile(line, args.today, cfgP);
    const benchLine = args.benchmark?.navs ?? [];
    const benchTable = benchLine.length >= 2 ? trailingTable(benchLine, args.today, cfgP) : [];
    const rows = profile.trailing.map(({ def, r }) => {
      const b = benchTable.find((x) => x.def.key === def.key)?.r ?? null;
      const [v] = versus(
        [{ key: def.key, ret: r ? shownReturn(r) : null }],
        [{ key: def.key, ret: b ? shownReturn(b) : null }],
      );
      return { def, yours: r, bench: b, v: v! };
    });
    // growth of 100 from the first day both lines exist (never before the first purchase)
    let growth: FundReturns['growth'] = null;
    if (byPrice && benchLine.length >= 2) {
      const buys = f.txns
        .filter((t) => t.units > 0)
        .map((t) => t.date)
        .sort();
      const from = [navLine[0]!.date, benchLine[0]!.date, buys[0] ?? f.startedOn ?? '']
        .filter(Boolean)
        .sort()
        .pop()!;
      const a = rebase(navLine, from);
      const b = rebase(benchLine, from);
      if (a.length >= 2 && b.length >= 2) growth = { from, fund: a, bench: b };
    }
    returns = {
      basis: byPrice ? 'price' : 'values',
      estimated: !byPrice && f.flowsEstimated,
      profile,
      versus: rows,
      benchName: args.benchmark?.name ?? null,
      growth,
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
      from: rangeStart(args.range, args.today),
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
