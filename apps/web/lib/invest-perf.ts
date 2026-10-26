import {
  avgCostPerUnit,
  portfolioPerformance,
  shownReturn,
  type FundForReturns,
  type FundLine,
  type PersonStyle,
  type PortfolioPerformance,
  type ProfileConfig,
  returnsFor,
} from '@fwos/core';
import type { FundRow, InvestmentView } from './investments';

/** The numbers behind the return tables, taken from the saved configuration. */
export const profileConfig = (cfg: InvestmentView['config']): ProfileConfig => ({
  annualiseAfterMonths: cfg.annualiseAfterMonths,
  gapDays: cfg.navGapDays,
  riskFree: cfg.riskFreeRate,
  riskMonths: cfg.riskMonths,
  riskMinMonths: cfg.riskMinMonths,
  rollingYears: cfg.rollingYears,
  rollingMinWindows: cfg.rollingMinWindows,
});

const allFunds = (view: InvestmentView) => view.groups.flatMap((g) => g.funds);

/** How the funds shown have performed as a whole, with the benchmark alongside when its prices are loaded. */
export function investPerformance(view: InvestmentView): PortfolioPerformance {
  return portfolioPerformance({
    funds: allFunds(view).map((f) => ({
      assetId: f.assetId,
      perf: f.perf,
      flows: f.flows,
      flowsEstimated: f.flowsEstimated,
      value: f.value,
    })),
    today: view.today,
    cfg: profileConfig(view.config),
    benchmark: view.benchmark?.navs ?? [],
  });
}

const forReturns = (f: FundRow): FundForReturns => ({
  assetId: f.assetId,
  ownerId: f.ownerId,
  name: f.name,
  value: f.value,
  txns: f.txns.map((t) => ({ date: t.date, units: t.units, amount: Math.abs(t.amount) })),
  plan: {
    invested: f.invested,
    startedOn: f.startedOn,
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
  },
});

/** The annual return of any set of funds on the view (a person, a kind of fund, a fund house). */
export function xirrOfIds(view: InvestmentView) {
  const by = new Map(allFunds(view).map((f) => [f.assetId, forReturns(f)]));
  return (ids: string[]) => {
    const list = ids.map((i) => by.get(i)).filter((x): x is FundForReturns => !!x);
    const r = returnsFor(list, view.today);
    return { xirr: r.xirr, estimated: r.estimatedFunds > 0 };
  };
}

/** One line per fund for the funds table, with the person's name and each figure worked out. */
export function fundLines(view: InvestmentView): FundLine[] {
  const total = allFunds(view).reduce((a, f) => a + f.value, 0);
  return view.groups.flatMap((g) =>
    g.funds.map((f): FundLine => {
      const nr = (key: string) => f.navReturns.find((x) => x.def.key === key)?.r ?? null;
      const one = nr('1y');
      const all = nr('all');
      return {
        assetId: f.assetId,
        ownerId: f.ownerId,
        ownerName: g.name,
        name: f.name,
        categoryKey: f.category.key,
        categoryLabel: f.category.label,
        categoryCertain: f.category.certain,
        amc: f.amc,
        plan: f.plan,
        invested: f.invested,
        value: f.value,
        gain: f.value - f.invested,
        gainPct: f.invested > 0 ? f.value / f.invested - 1 : null,
        dayAmount: f.dayAmount,
        dayPct: f.dayPct,
        xirr: f.xirr,
        xirrEstimated: f.xirrEstimated,
        ret1y: one ? shownReturn(one) : null,
        retAll: all ? shownReturn(all) : null,
        share: total > 0 ? f.value / total : 0,
        sipMonthly: f.sipMonthly,
        sipStopped: f.sipStopped,
        units: f.units,
        nav: f.nav,
        avgCost: avgCostPerUnit(f.invested, f.units),
        hasStatement: f.hasStatement,
        amfiCode: f.amfiCode,
        goalIds: f.goalIds,
        startedOn: f.startedOn,
        navDate: f.navDate,
        valueBasis: f.valueBasis,
      };
    }),
  );
}

export type Styles = Record<string, PersonStyle>;
