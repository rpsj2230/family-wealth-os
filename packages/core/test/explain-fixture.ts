import { heroModel } from '../src/invest-overview';
import { statBlock, type StatFund } from '../src/fund-stats';
import { fundCategory } from '../src/fund-category';
import { portfolioPerformance, type PerfFundIn } from '../src/portfolio-performance';
import { DEFAULT_CONFIG } from '../src/config';
import { ledgerSummary, type LedgerStatus } from '../src/ledger-check';
import type { InvestExplainInput, InvestFundFact } from '../src/explain-invest';
import type { PerfExplainInput } from '../src/explain-perf';

const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

export const TODAY = '2026-10-26';

export const fact = (o: Partial<InvestFundFact> & { assetId: string }): InvestFundFact => ({
  name: o.assetId,
  owner: 'Anil',
  value: 1_000_000,
  invested: 800_000,
  units: 1000,
  nav: 1000,
  navDate: '2026-10-23',
  livePrice: true,
  valueBasis: 'units × live price',
  hasStatement: true,
  lotsBasis: 'statement',
  flowsEstimated: false,
  ledgerStatus: 'complete' as LedgerStatus,
  ledgerWhy: '',
  figuresEstimated: false,
  firstTxnOn: '2022-07-05',
  lastTxnOn: '2026-10-05',
  txnCount: 40,
  startedOn: '2022-07-05',
  updatedOn: '2026-10-23',
  dayAmount: 1_000,
  dayPct: 0.001,
  dayFrom: '2026-10-22',
  dayTo: '2026-10-23',
  sipMonthly: 10_000,
  sipStopped: false,
  flowCount: 40,
  flowsFrom: '2022-07-05',
  flowsTo: '2026-10-05',
  categoryCertain: true,
  plan: 'direct',
  ...o,
});

const CFG = {
  annualiseAfterMonths: 12,
  gapDays: 10,
  riskFree: 0.06,
  riskMonths: 36,
  riskMinMonths: 24,
  rollingYears: [1],
  rollingMinWindows: 6,
};

const PACE = {
  rate: 0.12,
  assumed: false,
  spread: 0.03,
  cap: 0.2,
  years: [{ years: 5, expected: 9_000_000, low: 8_000_000, high: 10_000_000 }],
};

/** The Performance tab's input: a small index with estimated cash flows. */
export function perfInput(): PerfExplainInput {
  const perfFund: PerfFundIn = {
    assetId: 'a',
    perf: Array.from({ length: 30 }, (_, i) => ({
      date: monthEnd(2024 + Math.floor(i / 12), (i % 12) + 1),
      value: 1000 * 1.01 ** i,
      invested: 1000,
    })),
    flows: [{ date: '2024-01-02', amount: 1000 }],
    flowsEstimated: true,
    value: 1000,
  };
  return {
    performance: portfolioPerformance({
      funds: [perfFund],
      today: '2026-06-30',
      cfg: CFG,
      benchmark: [],
    }),
    cfg: {
      annualiseAfterMonths: 12,
      gapDays: 10,
      riskFree: 0.06,
      riskMonths: 36,
      riskMinMonths: 24,
      rollingMinWindows: 6,
      plRows: 12,
      weeksShown: 8,
      contributionMonths: 12,
    },
    benchmark: null,
    pl: {
      kindLabel: 'month',
      rows: 12,
      from: '2025-07-01',
      to: '2026-06-30',
      estimated: true,
      allEstimated: true,
      mode: 'none',
    },
    heat: 'financial',
    growth: {
      rangeWords: 'all the history',
      change: null,
      startsLate: false,
      statementFunds: 1,
      totalFunds: 3,
      contributionMonths: 12,
      contributionTotal: 120_000,
    },
    pace: PACE,
  };
}

/** The worked example from the Investments page: profit 8,03,737 on money put in 43,01,000, value 51,04,737. */
export function investInput(over: { funds?: InvestFundFact[] } = {}): InvestExplainInput {
  const funds = over.funds ?? [
    fact({ assetId: 'f1', name: 'Alpha Flexi Cap', value: 3_000_000, invested: 2_500_000 }),
    fact({
      assetId: 'f2',
      name: 'Beta Small Cap',
      value: 1_404_737,
      invested: 1_201_000,
      hasStatement: false,
      ledgerStatus: 'estimated',
      ledgerWhy: 'Only assumed monthly investments, no statement lines.',
      figuresEstimated: true,
      flowsEstimated: true,
      valueBasis: 'units × live price + SIPs since',
      navDate: '2026-10-21',
      lotsBasis: 'estimated',
    }),
    fact({
      assetId: 'f3',
      name: 'Gamma Hybrid',
      value: 700_000,
      invested: 600_000,
      livePrice: false,
      valueBasis: 'last recorded value (no live price yet)',
      navDate: null,
      dayPct: null,
      dayAmount: null,
      dayFrom: null,
      dayTo: null,
      ledgerStatus: 'gap',
      ledgerWhy: 'Gap: lines missing between 5 Jan 2024 and 5 Mar 2024.',
      figuresEstimated: true,
    }),
  ];
  const value = funds.reduce((a, f) => a + f.value, 0);
  const invested = funds.reduce((a, f) => a + f.invested, 0);
  const sf: StatFund[] = funds.map((f) => ({
    assetId: f.assetId,
    ownerId: 'p1',
    name: f.name,
    value: f.value,
    invested: f.invested,
    units: f.units,
    nav: f.nav,
    startedOn: f.startedOn,
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    dayAmount: f.dayAmount,
    dayPct: f.dayPct,
    folioLast4: '1234',
    category: fundCategory(f.name, null),
    amc: 'Alpha AMC',
    taxClass: 'equity',
    hasStatement: f.hasStatement,
    txns: [],
    lots: [],
    lotsBasis: f.lotsBasis,
    realised: [],
  }));
  const stats = statBlock(sf, { today: TODAY, holdingMonths: 12, config: DEFAULT_CONFIG.funds });
  const hero = heroModel({
    funds: funds.length,
    folios: 3,
    invested,
    value,
    dayAmount: funds.reduce((a, f) => a + (f.dayAmount ?? 0), 0),
    dayPct: 0.001,
    xirr: 0.142,
    xirrEstimated: true,
    sipMonthly: funds.filter((f) => !f.sipStopped).reduce((a, f) => a + (f.sipMonthly ?? 0), 0),
    withStatement: funds.filter((f) => f.hasStatement).length,
    estimated: funds.filter((f) => !f.hasStatement).length,
    unreconciled: funds.filter((f) => f.figuresEstimated).length,
    longShare: 0.62,
    realised: stats.realised,
  });
  return {
    today: TODAY,
    scope: 'all funds',
    hero,
    stats,
    funds,
    ledger: ledgerSummary([{ ownerId: 'p1', name: 'Anil', funds: [] }], {
      historyFrom: '2018-04-01',
      unitTolerance: 0.01,
    }),
    links: {
      dataCheck: '/investments#ov-dc',
      import: '/import',
      match: '/investments?tab=match',
      performance: '/investments?tab=performance',
      breakdown: '/investments?tab=breakdown',
      transactions: '/investments?tab=transactions',
      funds: '/investments?tab=funds',
      settings: '/settings',
    },
    holdingMonths: 12,
    historyFrom: '2018-04-01',
    saleDates: { first: null, last: null },
    pace: PACE,
    goals: { withGoal: 2, without: 1, names: ['House', 'Education'] },
    people: 1,
  };
}
