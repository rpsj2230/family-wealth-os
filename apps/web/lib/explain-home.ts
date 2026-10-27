import { LADDER_DAYS, buildHomeExplain, type ExplainSet } from '@fwos/core';
import type { HomeModel } from './home';

/** Where a link in an explainer goes: the page itself, or (in the public sample) its sample twin. */
export type LinkOf = (path: string) => string;

/** The "?" explainers of Home, from the same model the page draws. */
export function homeExplain(m: HomeModel, link: LinkOf): ExplainSet<'home'> {
  const f = m.funds;
  return buildHomeExplain({
    today: m.today,
    total: m.total,
    money: m.money,
    classes: m.classes,
    periods: m.periods,
    assumptions: m.assumptions,
    counted: m.counted,
    people: m.people,
    asOf: m.asOf,
    change: m.change,
    tiles: m.tiles,
    dataStarts: m.dataStarts,
    trust: m.trust,
    trustDetail: m.trustDetail,
    allocation: m.allocation,
    trend: {
      range: m.trend.range,
      view: m.trend.view,
      pace: m.trend.pace,
      growth: m.trend.growth,
      history: m.trend.history,
      rebuilt: m.trend.rebuilt,
      missingMonths: m.trend.missingMonths,
    },
    whatChanged: m.whatChanged,
    liquidity: m.liquidity,
    attention: m.attention,
    openTasks: m.openTasks,
    banks: m.banks,
    deposits: m.deposits,
    funds: f
      ? {
          value: f.totals.value,
          invested: f.totals.invested,
          gain: f.totals.gain,
          xirr: f.totals.xirr,
          xirrEstimated: f.totals.xirrEstimated,
          funds: f.totals.funds,
          withStatement: f.statements.withStatement,
        }
      : null,
    goals: { onTrack: m.goals.onTrack, withTarget: m.goals.withTarget, count: m.goals.list.length },
    risks: m.risks.length,
    freeDays: LADDER_DAYS.d30,
    links: {
      accounts: link('/accounts'),
      deposits: link('/deposits'),
      cash: link('/cash'),
      investments: link('/investments'),
      monthly: link('/monthly'),
      raise: link('/raise'),
      goals: link('/goals'),
      settings: link('/settings'),
      maturities: link('/deposits?tab=maturities'),
      cover: link('/deposits?tab=cover'),
      import: link('/import'),
    },
  });
}
