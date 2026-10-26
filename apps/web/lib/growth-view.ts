import {
  clipSeries,
  FUND_RANGE_WORDS,
  monthlyContributions,
  periodChange,
  rangeStart,
  returnSeries,
  xirrOverTime,
  type AppConfig,
  type FundRangeKey,
  type MonthContribution,
  type PeriodChange,
  type SeriesPoint,
  type StatTxn,
  type ValuePoint,
} from '@fwos/core';

/** What the Growth tab needs from each fund. */
export interface GrowthFundIn {
  assetId: string;
  name: string;
  hasStatement: boolean;
  txns: StatTxn[];
  /** month by month, all time: used to value the fund at past dates */
  history: SeriesPoint[];
}

export interface Marker {
  date: string;
  kind: 'lump' | 'sale';
  amount: number;
  /** funds involved, for the hover text */
  funds: string[];
}

export interface Growth {
  range: FundRangeKey;
  rangeWords: string;
  /** value and money put in inside the range */
  points: SeriesPoint[];
  startsLate: boolean;
  change: PeriodChange | null;
  /** one-off purchases and sales inside the range, from fund statements */
  markers: Marker[];
  /** gain over money put in, inside the range */
  returns: ValuePoint[];
  /** annual return (XIRR) at each month end, from the transactions; empty until there is enough history */
  xirr: ValuePoint[];
  contributions: MonthContribution[];
  statementFunds: number;
  totalFunds: number;
}

const LUMP = new Set(['purchase', 'other']);

/** Markers for one-off buys and sales: the same day and kind across funds are added together. */
export function growthMarkers(funds: GrowthFundIn[], from: string | null): Marker[] {
  const by = new Map<string, Marker>();
  for (const f of funds)
    for (const t of f.txns) {
      if (t.amount === 0 || t.units === 0 || (from !== null && t.date < from)) continue;
      const kind: Marker['kind'] | null =
        t.units < 0 && t.kind === 'redeem'
          ? 'sale'
          : t.units > 0 && LUMP.has(t.kind)
            ? 'lump'
            : null;
      if (!kind) continue;
      const key = `${t.date}|${kind}`;
      const m = by.get(key) ?? { date: t.date, kind, amount: 0, funds: [] };
      m.amount += Math.abs(t.amount);
      if (!m.funds.includes(f.name)) m.funds.push(f.name);
      by.set(key, m);
    }
  return [...by.values()]
    .map((m) => ({ ...m, amount: Math.round(m.amount) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function buildGrowth(args: {
  funds: GrowthFundIn[];
  /** all funds together for the range (every day, week or month end) */
  trend: SeriesPoint[];
  /** all funds together, month ends, all time */
  monthly: SeriesPoint[];
  today: string;
  range: FundRangeKey;
  config: AppConfig['funds'];
}): Growth {
  const clipped = clipSeries(args.trend, args.range, args.today);
  const from = rangeStart(args.range, args.today);
  const dates = clipSeries(args.monthly, args.range, args.today).points.map((p) => p.date);
  const withTxns = args.funds.filter((f) => f.txns.length > 0);
  return {
    range: args.range,
    rangeWords: FUND_RANGE_WORDS[args.range],
    points: clipped.points,
    startsLate: clipped.startsLate,
    change: periodChange(clipped.points),
    markers: growthMarkers(args.funds, from),
    returns: returnSeries(clipped.points),
    xirr: xirrOverTime({
      funds: withTxns.map((f) => ({
        txns: f.txns,
        series: f.history.map((p) => ({ date: p.date, value: p.value })),
      })),
      dates,
      minMonths: args.config.annualiseAfterMonths,
    }),
    contributions: monthlyContributions(
      args.funds.flatMap((f) => f.txns),
      args.today,
      args.config.contributionMonths,
    ),
    statementFunds: withTxns.length,
    totalFunds: args.funds.length,
  };
}
