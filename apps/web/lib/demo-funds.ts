/**
 * Invented mutual funds for the public sample pages (/demo/investments and /demo/asset?kind=fund): prices, instalments, one-off
 * purchases and sales are generated from a fixed recipe, then pushed through the same functions the real pages use (ledger, series,
 * returns, categories). Nothing here is real data. Everything is deterministic, so the sample looks the same on every visit.
 */
import {
  amcLabel,
  chartDates,
  combineSeries,
  estimateLots,
  fundCategory,
  fundSeries,
  fundTaxClass,
  flowsOfFund,
  lastNavMove,
  ledgerCheck,
  ledgerSummary,
  openingFlow,
  RULES,
  type LedgerLine,
  moveAmount,
  monthEnds,
  perfDates,
  periodDates,
  returnsFor,
  trailingTable,
  type IndexPoint,
  type AppConfig,
  type FundForReturns,
  type FundRangeKey,
  type NavPoint,
  type SeriesPoint,
  type StatLot,
  type StatTxn,
  DEFAULT_CONFIG,
  addDaysIso,
} from '@fwos/core';
import type { CasTxn } from '@fwos/ingest';
import { fundLedger } from './fund-ledger';
import type { FundRow, InvestmentView, OwnerGroup, Totals } from './investments';

export const DEMO_TODAY = '2026-10-26';
export const DEMO_PEOPLE = [
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
];
/** Months after which equity-fund units are long-term in the sample (the same rule as Settings, Tax rules). */
export const DEMO_HOLDING_MONTHS = 12;

interface Spec {
  id: string;
  owner: string;
  name: string;
  amfi: string | null;
  /** the official category, as the AMFI list words it */
  category: string | null;
  amc: string;
  folio: string;
  base: number;
  drift: number;
  amp: number;
  phase: number;
  lumps: [string, number][];
  sip?: { monthly: number; start: string; stopAfter?: string; skip?: string[] };
  /** units sold on a date, with the kind of line when it is not a plain sale */
  sells?: [string, number, CasTxn['kind']?][];
  /** other lines in units of money: a switch in, dividends reinvested, bonus units */
  extras?: [string, CasTxn['kind'], number][];
  plan?: 'direct' | 'regular';
  /** no fund statement: only the amount put in and the start date are known */
  plain?: boolean;
  /** units already held before the first line on file, and what they cost: the history starts midway */
  opening?: { units: number; cost: number };
  /** months (YYYY-MM) whose lines are missing from the ledger although the units are held: a gap */
  drop?: string[];
  goal?: string;
}

const SPECS: Spec[] = [
  {
    id: 'f1',
    owner: 'p1',
    name: 'Sample Flexi Cap Fund',
    amfi: '120503',
    category: 'Equity Scheme - Flexi Cap Fund',
    amc: 'Sample Mutual Fund',
    folio: '4567',
    base: 100,
    drift: 0.15,
    amp: 0.07,
    phase: 0.4,
    lumps: [
      ['2022-06-03', 300_000],
      ['2024-03-12', 150_000],
    ],
    sip: { monthly: 25_000, start: '2022-07-05', skip: ['2025-08', '2026-03'] },
    sells: [
      ['2025-06-12', 150, 'switch_out'],
      ['2025-12-10', 400],
    ],
    extras: [
      ['2023-03-20', 'dividend_reinvest', 4_200],
      ['2024-03-20', 'dividend_reinvest', 5_100],
    ],
    plan: 'direct',
    goal: 'g1',
  },
  {
    id: 'f2',
    owner: 'p1',
    name: 'Sample Small Cap Fund',
    amfi: '120504',
    category: 'Equity Scheme - Small Cap Fund',
    amc: 'Alpha Asset Management Company Limited',
    folio: '8812',
    base: 40,
    drift: 0.22,
    amp: 0.12,
    phase: 1.7,
    lumps: [['2024-02-05', 100_000]],
    sip: { monthly: 15_000, start: '2024-03-05' },
    extras: [['2025-06-12', 'switch_in', 0]],
    plan: 'regular',
    opening: { units: 300, cost: 11_500 },
  },
  {
    id: 'f8',
    owner: 'p1',
    name: 'Sample Tax Saver Fund (ELSS)',
    amfi: '120509',
    category: 'Equity Scheme - ELSS',
    amc: 'Sample Mutual Fund',
    folio: '4568',
    base: 80,
    drift: 0.13,
    amp: 0.08,
    phase: 1.1,
    lumps: [['2021-07-12', 100_000]],
    sip: { monthly: 5_000, start: '2021-08-05' },
    plan: 'direct',
  },
  {
    id: 'f5',
    owner: 'p1',
    name: 'Sample Gold Fund',
    amfi: '120507',
    category: 'Other Scheme - Gold ETF',
    amc: 'Alpha Asset Management Company Limited',
    folio: '8813',
    base: 55,
    drift: 0.12,
    amp: 0.05,
    phase: 2.6,
    lumps: [['2025-01-06', 100_000]],
  },
  {
    id: 'f3',
    owner: 'p2',
    name: 'Sample Index Fund',
    amfi: '120505',
    category: 'Other Scheme - Index Funds',
    amc: 'Beta Investment Managers Limited',
    folio: '3301',
    base: 150,
    drift: 0.1,
    amp: 0.05,
    phase: 0.9,
    lumps: [['2023-01-10', 600_000]],
    sip: { monthly: 10_000, start: '2023-02-05', stopAfter: '2025-06' },
    sells: [
      ['2026-02-12', 300],
      ['2026-10-14', 120],
    ],
    drop: ['2024-05'],
    goal: 'g1',
  },
  {
    id: 'f7',
    owner: 'p2',
    name: 'Sample Large Cap Fund',
    amfi: '120508',
    category: 'Equity Scheme - Large Cap Fund',
    amc: 'Beta Investment Managers Limited',
    folio: '3302',
    base: 60,
    drift: 0.13,
    amp: 0.06,
    phase: 3.1,
    lumps: [['2026-01-05', 200_000]],
    sells: [['2026-06-20', 400]],
  },
  {
    id: 'f6',
    owner: 'p2',
    name: 'Sample Mid Cap Fund',
    amfi: '120506',
    category: 'Equity Scheme - Mid Cap Fund',
    amc: 'Beta Investment Managers Limited',
    folio: '3303',
    base: 70,
    drift: 0.18,
    amp: 0.09,
    phase: 2.0,
    lumps: [],
    sip: { monthly: 8_000, start: '2025-03-05' },
    plain: true,
  },
  {
    id: 'f4',
    owner: 'p2',
    name: 'Sample Hybrid Fund',
    amfi: null,
    category: null,
    amc: '',
    folio: '3304',
    base: 41.2,
    drift: -0.01,
    amp: 0.03,
    phase: 0.2,
    lumps: [['2021-06-01', 430_000]],
    plain: true,
  },
];

/** the money a switch moves from the flexi cap fund to the small cap fund: the units sold times that day's price */
const SWITCH_UNITS = 150;
const SWITCH_ON = '2025-06-12';

const T0 = Date.parse('2021-01-01T00:00:00Z');
const DAY = 86_400_000;
const navOn = (s: Spec, d: string) => {
  const t = (Date.parse(`${d}T00:00:00Z`) - T0) / DAY / 365;
  return (
    Math.round(
      s.base *
        Math.exp(
          s.drift * t +
            s.amp * Math.sin(t * 3.1 + s.phase) +
            s.amp * 0.5 * Math.sin(t * 11 + s.phase),
        ) *
        10_000,
    ) / 10_000
  );
};

SPECS[1]!.extras![0]![2] = Math.round(SWITCH_UNITS * navOn(SPECS[0]!, SWITCH_ON) * 100) / 100;

const NAV_FROM = '2021-05-31';

/** The sample benchmark: an invented index fund, drawn from the same kind of recipe as the funds. */
const BENCH: Spec = {
  id: 'bench',
  owner: '',
  name: 'Sample Nifty 50 Index Fund',
  amfi: '120716',
  category: null,
  amc: '',
  folio: '',
  base: 100,
  drift: 0.11,
  amp: 0.05,
  phase: 0.6,
  lumps: [],
};
const dailyNavs = (s: Spec): NavPoint[] => {
  const out: NavPoint[] = [];
  for (let d = NAV_FROM; d <= DEMO_TODAY; d = addDaysIso(d, 1)) {
    const wd = new Date(`${d}T00:00:00Z`).getUTCDay();
    if (wd === 0 || wd === 6) continue;
    out.push({ date: d, nav: navOn(s, d) });
  }
  return out;
};

/** Every purchase and sale in the recipe, oldest first, with the units worked out from that day's price. */
function recipe(s: Spec): CasTxn[] {
  const rows: Omit<CasTxn, 'balance'>[] = [];
  const buy = (date: string, kind: CasTxn['kind'], amount: number) => {
    const nav = navOn(s, date);
    rows.push({
      date,
      kind,
      description: '',
      amount,
      units: Math.round((amount / nav) * 1000) / 1000,
      nav,
    });
  };
  for (const [d, a] of s.lumps) buy(d, 'purchase', a);
  for (const [d, kind, a] of s.extras ?? []) buy(d, kind, a);
  if (s.sip) {
    for (
      let d = s.sip.start;
      d <= DEMO_TODAY;
      d = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 5))
        .toISOString()
        .slice(0, 10)
    ) {
      if (s.sip.stopAfter && d.slice(0, 7) > s.sip.stopAfter) break;
      if (!s.sip.skip?.includes(d.slice(0, 7))) buy(d, 'sip', s.sip.monthly);
    }
  }
  for (const [d, units, kind] of s.sells ?? []) {
    const nav = navOn(s, d);
    rows.push({
      date: d,
      kind: kind ?? 'redeem',
      description: '',
      amount: -Math.round(units * nav * 100) / 100,
      units: -units,
      nav,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || b.units - a.units);
  let bal = s.opening?.units ?? 0;
  return rows.map((r) => ({ ...r, balance: (bal = Math.round((bal + r.units) * 1000) / 1000) }));
}

const goalOf = (s: Spec) => (s.goal ? [s.goal] : []);

function buildRow(
  s: Spec,
  range: FundRangeKey,
  config: AppConfig['funds'],
): { row: FundRow; navs: NavPoint[] } {
  const all = recipe(s);
  const hidden = s.plain;
  const navs = s.amfi ? dailyNavs(s) : [];
  // a gap: lines of some months are missing from the ledger although the units are held (the balances still show it)
  const txns = hidden ? [] : all.filter((t) => !s.drop?.includes(t.date.slice(0, 7)));
  const unitsNow =
    Math.round(((s.opening?.units ?? 0) + all.reduce((a, t) => a + t.units, 0)) * 1000) / 1000;
  const navNow = navOn(s, DEMO_TODAY);
  // what the fund records as invested comes from the whole history, however much of it is on file
  const whole = fundLedger({ txns: all, costValue: null, unitsHeld: unitsNow });
  const heldCost = hidden
    ? all.filter((t) => t.units > 0).reduce((a, t) => a + t.amount, 0)
    : whole.lots.reduce((a, l) => a + (l.cost ?? 0), 0) + (s.opening?.cost ?? 0);
  const invested = Math.round(heldCost);
  const ledger = fundLedger({ txns, costValue: invested || null, unitsHeld: unitsNow });
  const value = Math.round(unitsNow * navNow);
  const startedOn = s.opening ? null : (all[0]?.date ?? null);
  const sipMonthly = s.sip?.monthly ?? null;
  const sipStopped = !!s.sip?.stopAfter;
  // recorded values for a fund with no statement: month ends, valued at that day's price
  const observations = hidden
    ? monthEnds(startedOn ?? DEMO_TODAY, DEMO_TODAY)
        .filter((d) => d < DEMO_TODAY)
        .map((d) => {
          const u = all.filter((t) => t.date <= d).reduce((a, t) => a + t.units, 0);
          return { date: d, value: Math.round(u * navOn(s, d)) };
        })
        .filter((o) => o.value > 0)
    : [];
  const cur = { value, invested };
  const hist = {
    txns: txns.map((t) => ({ date: t.date, units: t.units, amount: Math.abs(t.amount) })),
    navs,
    observations,
    snapshots: [],
    plan: { invested, startedOn },
  };
  const history = fundSeries(hist, DEMO_TODAY, cur);
  const trend =
    range === 'all' || range === '3y'
      ? history
      : fundSeries(
          hist,
          DEMO_TODAY,
          cur,
          chartDates(range, history[0]?.date ?? DEMO_TODAY, DEMO_TODAY),
        );
  // the lines the fund page checks: the statement lines on file (a fund with no statement has none)
  const lines: LedgerLine[] = txns.map((t) => ({
    date: t.date,
    kind: t.kind,
    units: t.units,
    amount: t.amount,
    nav: t.nav,
    balance: t.balance,
    source: 'cas',
    description: t.description,
  }));
  const verdict = ledgerCheck({
    lines,
    position: { units: unitsNow, unitsAsOf: DEMO_TODAY, invested, startedOn },
    heldCost:
      ledger.reconciled && ledger.lots.every((l) => l.cost !== null)
        ? ledger.lots.reduce((a, l) => a + (l.cost ?? 0), 0)
        : null,
    tolerance: { units: config.unitTolerance, money: config.moneyTolerance },
    historyFrom: config.historyFrom,
  });
  const opening = openingFlow(txns, config.unitTolerance);
  const fr: FundForReturns = {
    assetId: s.id,
    ownerId: s.owner,
    name: s.name,
    value,
    txns: [...hist.txns, ...(opening ? [opening] : [])],
    plan: { invested, startedOn, sipMonthly, sipStopped },
  };
  const r = returnsFor([fr], DEMO_TODAY);
  const move = navs.length >= 2 ? lastNavMove(navs) : null;
  let lots: StatLot[] = ledger.reconciled ? ledger.lots : [];
  let lotsBasis: FundRow['lotsBasis'] = lots.length > 0 ? 'statement' : 'none';
  if (hidden && s.amfi && startedOn) {
    const est = estimateLots({
      plan: { invested, startedOn, sipMonthly, sipStopped },
      navs,
      today: DEMO_TODAY,
      unitsHeld: unitsNow,
      navGapDays: config.navGapDays,
    });
    if (est) {
      lots = est;
      lotsBasis = 'estimated';
    }
  }
  const cat = s.category;
  const stat: StatTxn[] = txns.map((t) => ({
    date: t.date,
    kind: t.kind,
    units: t.units,
    amount: t.amount,
    nav: t.nav,
    balance: t.balance,
  }));
  const navLine: IndexPoint[] = navs.map((n) => ({ date: n.date, value: n.nav }));
  const fl = flowsOfFund({
    txns: txns.map((t) => ({
      date: t.date,
      units: t.units,
      amount: Math.abs(t.amount),
      nav: t.nav,
      balance: t.balance,
      kind: t.kind,
    })),
    plan: { invested, startedOn, sipMonthly, sipStopped },
    today: DEMO_TODAY,
    unitTolerance: config.unitTolerance,
  });
  const firstDate = history[0]?.date ?? startedOn;
  const perf = firstDate
    ? fundSeries(hist, DEMO_TODAY, cur, perfDates(firstDate, DEMO_TODAY, config.weeksShown))
    : [];
  const row: FundRow = {
    assetId: s.id,
    ownerId: s.owner,
    name: s.name,
    value,
    invested,
    startedOn,
    sipMonthly,
    sipStopped,
    xirr: r.xirr,
    xirrEstimated: r.estimatedFunds > 0 || verdict.figuresEstimated,
    gain: r.funds > 0 && r.estimatedFunds === 0 ? r.gain : value - invested,
    dayAmount: move ? moveAmount(value, move.pct) : null,
    dayPct: move ? move.pct : null,
    dayFrom: move?.from ?? null,
    dayTo: move?.to ?? null,
    goalIds: goalOf(s),
    valueBasis: s.amfi ? 'units × live price' : 'last recorded value (no live price yet)',
    units: s.amfi || !hidden ? unitsNow : null,
    nav: s.amfi ? navNow : null,
    navDate: s.amfi ? DEMO_TODAY : null,
    amfiCode: s.amfi,
    history,
    trend,
    updatedOn: s.amfi ? addDaysIso(DEMO_TODAY, -3) : '2026-09-28',
    updatedSource: s.amfi
      ? { label: 'Automatic, 23 Oct', kind: 'auto' }
      : { label: 'You, 28 Sep', kind: 'manual' },
    folioLast4: s.folio,
    category: fundCategory(s.name, cat),
    amc: amcLabel(s.amc),
    taxClass: fundTaxClass(s.name, cat).class,
    taxInfo: (() => {
      const c = fundTaxClass(s.name, cat);
      return { label: c.label, note: c.note, certain: c.certain, lockInMonths: c.lockInMonths };
    })(),
    label: null,
    status: 'active',
    exitLoadPct: s.id === 'f2' ? 0.01 : null,
    exitLoadDays: s.id === 'f2' ? 365 : null,
    plan: s.plan ?? 'unknown',
    navReturns:
      navLine.length >= 2
        ? trailingTable(navLine, DEMO_TODAY, {
            gapDays: config.navGapDays,
            annualiseAfterMonths: config.annualiseAfterMonths,
          })
        : [],
    perf,
    periodPoints: firstDate
      ? fundSeries(hist, DEMO_TODAY, cur, periodDates(DEMO_TODAY, DEFAULT_CONFIG.home.changeDays))
      : [],
    flows: fl.flows,
    flowsEstimated: fl.estimated,
    hasStatement: !hidden,
    ledger: verdict,
    txns: stat,
    lots,
    lotsBasis,
    realised: ledger.realised,
  };
  return { row, navs };
}

function totalsOf(rows: FundRow[]): Totals {
  const forRet: FundForReturns[] = rows.map((f) => ({
    assetId: f.assetId,
    ownerId: f.ownerId,
    name: f.name,
    value: f.value,
    txns: [
      ...f.txns.map((t) => ({
        date: t.date,
        units: t.units,
        amount: Math.abs(t.amount),
        kind: t.kind,
      })),
      ...(() => {
        const o = openingFlow(f.txns, DEFAULT_CONFIG.funds.unitTolerance);
        return o ? [o] : [];
      })(),
    ],
    plan: {
      invested: f.invested,
      startedOn: f.startedOn,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
    },
  }));
  const r = returnsFor(forRet, DEMO_TODAY);
  const value = rows.reduce((a, f) => a + f.value, 0);
  const invested = rows.reduce((a, f) => a + f.invested, 0);
  const withDay = rows.filter((f) => f.dayAmount !== null);
  const day = withDay.reduce((a, f) => a + (f.dayAmount ?? 0), 0);
  return {
    funds: rows.length,
    value,
    invested,
    gain: r.funds > 0 ? r.gain : value - invested,
    xirr: r.xirr,
    xirrEstimated: r.estimatedFunds > 0 || rows.some((f) => f.ledger.figuresEstimated),
    dayAmount: day,
    dayPct: withDay.length > 0 ? day / (value - day) : null,
    sipMonthly: rows.filter((f) => !f.sipStopped).reduce((a, f) => a + (f.sipMonthly ?? 0), 0),
  };
}

export const DEMO_GOALS = [{ id: 'g1', name: 'Education fund' }];

/** The sample as the Investments page sees it, for one person or everyone, over a range. */
export function demoView(who: string | null, range: FundRangeKey): InvestmentView {
  const config = DEFAULT_CONFIG.funds;
  const every = SPECS.map((s) => buildRow(s, range, config).row);
  const rows = who ? every.filter((f) => f.ownerId === who) : every;
  const groups: OwnerGroup[] = DEMO_PEOPLE.filter((p) => !who || p.id === who).map((p) => {
    const funds = rows.filter((f) => f.ownerId === p.id).sort((a, b) => b.value - a.value);
    return {
      ownerId: p.id,
      name: p.name,
      panLast4: p.id === 'p1' ? '4321' : null,
      funds,
      ledger: ledgerSummary(
        [
          {
            ownerId: p.id,
            name: p.name,
            funds: funds.map((f) => ({
              assetId: f.assetId,
              name: f.name,
              startedOn: f.startedOn,
              verdict: f.ledger,
            })),
          },
        ],
        { historyFrom: config.historyFrom, unitTolerance: config.unitTolerance },
      )[0]!,
      totals: totalsOf(funds),
      series: combineSeries(funds.map((f) => f.history)),
      trend: combineSeries(funds.map((f) => f.trend)),
    };
  });
  return {
    today: DEMO_TODAY,
    groups,
    household: totalsOf(rows),
    series: combineSeries(rows.map((f) => f.history)),
    trend: combineSeries(rows.map((f) => f.trend)),
    range,
    palette: {
      categories: [...new Set(every.map((f) => f.category.key))],
      amcs: [
        ...new Set([...every].sort((a, b) => b.value - a.value).map((f) => f.amc ?? '__none')),
      ],
      funds: [...every].sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.assetId),
    },
    holdingMonths: DEMO_HOLDING_MONTHS,
    config,
    tax: { rules: RULES, harvest: DEFAULT_CONFIG.harvest },
    benchmark: demoBenchmark(),
    goals: DEMO_GOALS,
  };
}

/** The sample benchmark: an invented index fund's prices. */
export const demoBenchmark = () => ({
  code: BENCH.amfi!,
  name: BENCH.name,
  navs: dailyNavs(BENCH).map((n) => ({ date: n.date, value: n.nav })),
});

/** The ids of the sample funds. */
export const DEMO_FUND_IDS = SPECS.map((s) => s.id);

/** One sample fund with its price history, for the fund page. */
export function demoFund(id: string, range: FundRangeKey) {
  const spec = SPECS.find((s) => s.id === id) ?? SPECS[0]!;
  return buildRow(spec, range, DEFAULT_CONFIG.funds);
}

export type { SeriesPoint };
