import {
  buildIndex,
  fundsPeriods,
  PERF_PERIODS,
  shownReturn,
  trailingReturn,
  type StatBlock,
} from '@fwos/core';
import type { PersonRow } from '@/components/invest/OverviewParts';
import type { InvestmentView } from './investments';
import { perfFundIn } from './fund-holdings';
import { profileConfig } from './invest-perf';

/** One row per person: the totals, the return of the latest year and the shares, for the person comparison. */
export function personRows(
  view: InvestmentView,
  byOwner: Record<string, StatBlock>,
  totalsOf: (ownerId: string) => PersonRow['totals'],
): PersonRow[] {
  const cfg = profileConfig(view.config);
  const year = PERF_PERIODS.find((p) => p.key === '1y')!;
  return view.groups.map((g) => {
    const s = byOwner[g.ownerId];
    const p = fundsPeriods(g.funds.map(perfFundIn));
    const r = trailingReturn(buildIndex(p.periods), view.today, year, cfg);
    return {
      ownerId: g.ownerId,
      name: g.name,
      totals: totalsOf(g.ownerId),
      folios: s?.folios ?? 0,
      r1y: r ? shownReturn(r) : null,
      longShare: s?.holding.longShare ?? null,
      topShare: s && s.concentration.top.length > 0 ? s.concentration.topShare : null,
    };
  });
}
