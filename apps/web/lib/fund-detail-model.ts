import {
  avgCostPerUnit,
  cagr,
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
};

export interface FundDetail {
  range: FundRangeKey;
  rangeWords: string;
  /** value and money put in inside the range */
  points: SeriesPoint[];
  startsLate: boolean;
  change: PeriodChange | null;
  nav: NavChartModel;
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
  return {
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
