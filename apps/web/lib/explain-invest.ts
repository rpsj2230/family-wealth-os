import {
  PL_KINDS,
  buildInvestExplain,
  buildPerfExplain,
  perfContextOf,
  type Hero,
  type InvestExplainInput,
  type InvestFundFact,
  type InvestOverviewSet,
  type PerfExplainSet,
  type PersonStyle,
  type PortfolioPerformance,
  type StatBlock,
  type YearKind,
} from '@fwos/core';
import type { Growth } from './growth-view';
import type { PlView } from './invest-pl';
import type { FundRow, InvestmentView, fundPace } from './investments';

const minmax = (ds: string[]) => {
  const s = [...ds].sort();
  return { first: s[0] ?? null, last: s.at(-1) ?? null };
};

/** What the explainers need to know about one fund, taken from the fund row the page already has. */
export function fundFact(f: FundRow, owner: string, why: string): InvestFundFact {
  const flows = minmax(f.flows.map((x) => x.date));
  return {
    assetId: f.assetId,
    name: f.label || f.name,
    owner,
    value: f.value,
    invested: f.invested,
    units: f.units,
    nav: f.nav,
    navDate: f.navDate,
    livePrice: !!f.amfiCode,
    valueBasis: f.valueBasis,
    hasStatement: f.hasStatement,
    lotsBasis: f.lotsBasis,
    flowsEstimated: f.flowsEstimated,
    ledgerStatus: f.ledger.status,
    ledgerWhy: why,
    figuresEstimated: f.ledger.figuresEstimated,
    firstTxnOn: f.ledger.firstTxnOn,
    lastTxnOn: f.ledger.lastTxnOn,
    txnCount: f.ledger.txnCount,
    startedOn: f.startedOn,
    updatedOn: f.updatedOn,
    dayAmount: f.dayAmount,
    dayPct: f.dayPct,
    dayFrom: f.dayFrom,
    dayTo: f.dayTo,
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    flowCount: f.flows.length,
    flowsFrom: flows.first,
    flowsTo: flows.last,
    categoryCertain: f.category.certain,
    plan: f.plan,
  };
}

export interface InvestExplainArgs {
  view: InvestmentView;
  /** '/investments' or '/demo/investments' */
  base: string;
  demo: boolean;
  who: string | null;
  styles: Record<string, PersonStyle>;
  hero: Hero;
  stats: StatBlock;
  pace: ReturnType<typeof fundPace>;
}

/** The explainer input of the Investments page, from the same view the page draws. */
export function investExplainInput(a: InvestExplainArgs): InvestExplainInput {
  const v = a.view;
  const funds = v.groups.flatMap((g) =>
    g.funds.map((f) =>
      fundFact(f, g.name, g.ledger.need.find((n) => n.assetId === f.assetId)?.why ?? ''),
    ),
  );
  const sales = minmax(
    v.groups.flatMap((g) => g.funds.flatMap((f) => f.realised.map((r) => r.soldOn))),
  );
  const goalName = new Map(v.goals.map((g) => [g.id, g.name]));
  const withGoal = v.groups.flatMap((g) => g.funds).filter((f) => f.goalIds.length > 0);
  return {
    today: v.today,
    scope: a.who ? `${a.styles[a.who]?.name ?? 'this person'}’s funds` : 'all funds',
    hero: a.hero,
    stats: a.stats,
    funds,
    ledger: v.groups.map((g) => g.ledger),
    links: {
      dataCheck: `${a.base}#ov-dc`,
      import: a.demo ? '/demo/import' : '/import',
      match: `${a.base}?tab=match`,
      performance: `${a.base}?tab=performance`,
      breakdown: `${a.base}?tab=breakdown`,
      transactions: `${a.base}?tab=transactions`,
      funds: `${a.base}?tab=funds`,
      settings: a.demo ? '/demo/settings' : '/settings',
    },
    holdingMonths: v.holdingMonths,
    historyFrom: v.config.historyFrom,
    saleDates: sales,
    pace: {
      rate: a.pace.rate,
      assumed: a.pace.assumed,
      spread: a.pace.spread,
      cap: v.config.projectionCap,
      years: a.pace.projections.map((p) => ({
        years: p.years,
        expected: p.expected,
        low: p.low,
        high: p.high,
      })),
    },
    goals: {
      withGoal: withGoal.length,
      without: funds.length - withGoal.length,
      names: [
        ...new Set(withGoal.flatMap((f) => f.goalIds.map((id) => goalName.get(id) ?? ''))),
      ].filter(Boolean),
    },
    people: v.groups.length,
  };
}

export function investOverviewExplain(a: InvestExplainArgs): InvestOverviewSet {
  return buildInvestExplain(investExplainInput(a));
}

export function investPerfExplain(
  a: InvestExplainArgs & {
    perf: PortfolioPerformance;
    /** the Performance tab's own views; the Overview tab needs only the returns table and passes neither */
    growth?: Growth | undefined;
    pl?: PlView | undefined;
    heat?: YearKind | undefined;
  },
): PerfExplainSet {
  const v = a.view;
  const cfg = v.config;
  const bench = v.benchmark;
  const main = a.pl?.main ?? [];
  const contributions = a.growth?.contributions ?? [];
  const funds = v.groups.flatMap((g) => g.funds);
  return buildPerfExplain(
    {
      performance: a.perf,
      cfg: {
        annualiseAfterMonths: cfg.annualiseAfterMonths,
        gapDays: cfg.navGapDays,
        riskFree: cfg.riskFreeRate,
        riskMonths: cfg.riskMonths,
        riskMinMonths: cfg.riskMinMonths,
        rollingMinWindows: cfg.rollingMinWindows,
        plRows: cfg.plRows,
        weeksShown: cfg.weeksShown,
        contributionMonths: cfg.contributionMonths,
      },
      benchmark: bench
        ? {
            name: bench.name,
            from: bench.navs[0]?.date ?? null,
            to: bench.navs.at(-1)?.date ?? null,
          }
        : null,
      pl: {
        kindLabel: PL_KINDS.find((k) => k.key === a.pl?.kind)?.unit ?? 'month',
        rows: main.length,
        from: main[0]?.from ?? null,
        to: main.at(-1)?.to ?? null,
        estimated: a.pl?.estimated ?? false,
        allEstimated: a.pl?.allEstimated ?? false,
        mode: a.pl?.mode ?? 'none',
      },
      heat: a.heat ?? 'financial',
      growth: {
        rangeWords: a.growth?.rangeWords ?? 'all the history',
        change: a.growth?.change ?? null,
        startsLate: a.growth?.startsLate ?? false,
        statementFunds: a.growth?.statementFunds ?? funds.filter((f) => f.txns.length > 0).length,
        totalFunds: a.growth?.totalFunds ?? funds.length,
        contributionMonths: contributions.length,
        contributionTotal: contributions.reduce((s, m) => s + m.sip + m.lump + m.moved, 0),
      },
      pace: {
        rate: a.pace.rate,
        assumed: a.pace.assumed,
        spread: a.pace.spread,
        cap: cfg.projectionCap,
        years: a.pace.projections.map((p) => ({
          years: p.years,
          expected: p.expected,
          low: p.low,
          high: p.high,
        })),
      },
    },
    perfContextOf(investExplainInput(a)),
  );
}
