import { statBlock, type StatBlock } from '@fwos/core';
import { buildGrowth, type Growth } from './growth-view';
import type { InvestmentView } from './investments';

/** The statistics for everyone shown and for each person, from the funds on the view. */
export function investStats(view: InvestmentView): {
  all: StatBlock;
  byOwner: Record<string, StatBlock>;
} {
  const ctx = { today: view.today, holdingMonths: view.holdingMonths, config: view.config };
  return {
    all: statBlock(
      view.groups.flatMap((g) => g.funds),
      ctx,
    ),
    byOwner: Object.fromEntries(view.groups.map((g) => [g.ownerId, statBlock(g.funds, ctx)])),
  };
}

/** The Growth tab's numbers for the range the view was loaded with. */
export function investGrowth(view: InvestmentView): Growth {
  return buildGrowth({
    funds: view.groups.flatMap((g) => g.funds),
    trend: view.trend,
    monthly: view.series,
    today: view.today,
    range: view.range,
    config: view.config,
  });
}
