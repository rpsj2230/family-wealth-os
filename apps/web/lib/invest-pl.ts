import {
  alignSeries,
  compareWithPrevious,
  fundsPeriods,
  lastBuckets,
  periodPL,
  type PerfFundIn,
  type PlBucket,
  type PlCompare,
  type PlKind,
  type PlRow,
  type PlSeries,
  type PortfolioPerformance,
} from '@fwos/core';
import type { FundRow, InvestmentView } from './investments';
import type { Styles } from './invest-perf';

/** What the profit and loss section compares: nothing, the latest period with the one before, one person with another, or fund with fund. */
export type PlCompareMode = 'none' | 'prev' | 'person' | 'fund';
export const PL_COMPARES: { key: PlCompareMode; label: string }[] = [
  { key: 'none', label: 'No comparison' },
  { key: 'prev', label: 'This period and the one before' },
  { key: 'person', label: 'Person against person' },
  { key: 'fund', label: 'Fund against fund' },
];
export const parseCompareMode = (v: string | null | undefined): PlCompareMode =>
  PL_COMPARES.some((c) => c.key === v) ? (v as PlCompareMode) : 'none';

export interface PlView {
  kind: PlKind;
  mode: PlCompareMode;
  /** the series drawn: one for the whole, or one per person or fund */
  series: PlSeries[];
  /** the whole, with running totals, for the chart and table (the latest `plRows` buckets) */
  main: PlBucket[];
  rows: PlRow[];
  prev: PlCompare | null;
  /** more buckets exist than are shown */
  cut: boolean;
  estimated: boolean;
  /** every period shown includes estimated flows, so one note says so instead of a tag on each */
  allEstimated: boolean;
}

const toIn = (f: FundRow): PerfFundIn => ({
  assetId: f.assetId,
  perf: f.perf,
  flows: f.flows,
  flowsEstimated: f.flowsEstimated,
  value: f.value,
});

export function buildPl(
  view: InvestmentView,
  perf: PortfolioPerformance,
  styles: Styles,
  kind: PlKind,
  want: PlCompareMode,
): PlView {
  const opts = { weeks: view.config.weeksShown };
  const limit = view.config.plRows;
  const all = periodPL(perf.periods, kind, view.today, {
    ...opts,
    estimatedSince: perf.estimatedSince,
  });
  const main = lastBuckets(all, limit);
  let mode = want;
  let series: PlSeries[] = [
    { id: 'all', label: 'All funds shown', colour: 'var(--viz-1)', buckets: main },
  ];
  if (mode === 'person') {
    if (view.groups.length < 2) mode = 'none';
    else
      series = view.groups.map((g) => {
        const p = fundsPeriods(g.funds.map(toIn));
        return {
          id: g.ownerId,
          label: g.name,
          colour: styles[g.ownerId]?.colour ?? 'var(--viz-1)',
          buckets: periodPL(p.periods, kind, view.today, {
            ...opts,
            estimatedSince: p.estimatedSince,
          }),
        };
      });
  } else if (mode === 'fund') {
    const top = view.groups
      .flatMap((g) => g.funds)
      .sort((a, b) => b.value - a.value)
      .slice(0, view.config.compareFunds);
    if (top.length < 2) mode = 'none';
    else
      series = top.map((f, i) => {
        const p = fundsPeriods([toIn(f)]);
        return {
          id: f.assetId,
          label: f.name,
          colour: `var(--viz-${i + 1})`,
          buckets: periodPL(p.periods, kind, view.today, {
            ...opts,
            estimatedSince: p.estimatedSince,
          }),
        };
      });
  }
  return {
    kind,
    mode,
    series,
    main,
    rows: alignSeries(series, limit),
    prev: mode === 'prev' ? compareWithPrevious(all) : null,
    cut: all.length > limit,
    estimated: main.some((b) => b.estimated),
    allEstimated: main.length > 0 && main.every((b) => b.estimated),
  };
}
