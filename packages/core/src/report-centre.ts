/**
 * The Report Centre: one place to ask for a report by template, period, filters and grouping, with a comparison against the period
 * before. Every template runs on figures the app already works out (holdings valued by the central engine, deposits from their
 * terms, the fund ledgers, the daily snapshots, money lent, goals); none asks for new data. Where a template cannot say something
 * (no snapshot reaches back, a sale whose purchase is not on the statement), it says so in its notes instead of showing a zero.
 *
 * Rules kept throughout: mutual funds are never cash; money put in is not profit; gains booked by selling are kept apart from gains
 * not yet booked; deposit principal and interest are apart; each person's money stays with that person; estimates are marked.
 *
 * Pure: no I/O.
 */
import { fdValueOn, type Compounding } from './fd';
import type { StatRealised } from './fund-stats';
import {
  PERIOD_PRESETS,
  daysIn,
  inRange,
  longDay,
  previousPeriod,
  resolvePeriod,
  type DateRange,
  type ReportPeriodKey,
} from './report-period';
import { periodOf, type Cell, type Col, type ReportTable } from './reports';

// ---- input -------------------------------------------------------------------------------------

export type HoldingClass = 'cash' | 'fd' | 'funds' | 'others';

export interface CentreHolding {
  id: string;
  name: string;
  ownerId: string;
  cls: HoldingClass;
  /** the asset type: bank_account, fixed_deposit, mutual_fund, receivable, property, … */
  type: string;
  bank: string | null;
  currency: string;
  /** worth today in rupees, as net worth counts it */
  value: number;
  /** in its own currency when that is not rupees */
  native: number | null;
  /** what was put in (deposit principal, cost of the units held); null when not known */
  cost: number | null;
  /** the date the figure rests on */
  asOf: string | null;
  estimated: boolean;
  stale: boolean;
}

export interface CentreDeposit {
  id: string;
  name: string;
  bank: string;
  ownerId: string;
  principal: number;
  /** decimal, 0.0725 */
  rate: number;
  bookedOn: string;
  maturityOn: string;
  maturityAmount: number;
  compounding: Compounding;
  /** still running today */
  running: boolean;
}

export interface CentreFundTxn {
  date: string;
  /** purchase, sip, redeem, switch_in, switch_out, dividend_reinvest, bonus, other */
  kind: string;
  units: number;
  amount: number;
  /** an instalment assumed from the SIP plan, not yet confirmed by a statement */
  estimated: boolean;
}

export interface CentreFund {
  id: string;
  name: string;
  ownerId: string;
  amc: string | null;
  category: string;
  plan: 'direct' | 'regular' | 'unknown';
  value: number;
  /** cost of the units still held */
  cost: number;
  units: number | null;
  hasStatement: boolean;
  txns: CentreFundTxn[];
  realised: StatRealised[];
}

export interface CentreFx {
  currency: string;
  native: number;
  inr: number;
  rate: number;
  rateDate: string | null;
  asOf: string | null;
  accounts: number;
}

export interface CentreSnapshot {
  date: string;
  total: number;
  byType: Record<string, number>;
  byOwner: Record<string, number>;
}

export interface CentreReceivable {
  id: string;
  name: string;
  outstanding: number;
  expectedOn: string | null;
  daysOverdue: number;
  settled: boolean;
}

export interface CentreGoal {
  id: string;
  name: string;
  target: number | null;
  targetOn: string | null;
  setAside: number;
  /** on track, behind, … in words */
  status: string;
}

export interface CentreInput {
  today: string;
  /** the first day anything is recorded for */
  first: string | null;
  people: Record<string, string>;
  holdings: CentreHolding[];
  deposits: CentreDeposit[];
  funds: CentreFund[];
  fx: CentreFx[];
  snapshots: CentreSnapshot[];
  receivables: CentreReceivable[];
  goals: CentreGoal[];
  /** Settings → funds.financialQuarters */
  financialQuarters?: boolean;
  /** statement lines still to be answered, and held funds with no price source */
  quality: { toAnswer: number | null; fundsNoPrice: number };
}

// ---- the query ---------------------------------------------------------------------------------

export type TemplateKey =
  | 'networth'
  | 'holdings'
  | 'cash'
  | 'deposits'
  | 'maturities'
  | 'funds'
  | 'transactions'
  | 'contributions'
  | 'realised'
  | 'currency'
  | 'receivables'
  | 'goals'
  | 'quality'
  | 'tax'
  | 'performance'
  | 'retirement'
  | 'insurance';

export type GroupKey =
  | 'none'
  | 'owner'
  | 'cls'
  | 'bank'
  | 'currency'
  | 'amc'
  | 'category'
  | 'plan'
  | 'option'
  | 'fund'
  | 'kind'
  | 'month'
  | 'quarter'
  | 'fy'
  | 'year';

export const GROUP_LABEL: Record<GroupKey, string> = {
  none: 'No grouping',
  owner: 'Person',
  cls: 'Kind of holding',
  bank: 'Bank',
  currency: 'Currency',
  amc: 'Fund house',
  category: 'Fund category',
  plan: 'Plan (Direct / Regular)',
  option: 'Option (Growth / IDCW)',
  fund: 'Fund',
  kind: 'Transaction type',
  month: 'Month',
  quarter: 'Quarter',
  fy: 'Financial year',
  year: 'Calendar year',
};

export interface CentreTemplate {
  key: TemplateKey;
  label: string;
  /** one line: what it answers */
  about: string;
  /** reads the period (a "today" report ignores it) */
  usesPeriod: boolean;
  /** the period it opens with */
  defaultPeriod: ReportPeriodKey;
  groups: GroupKey[];
  /** which filters apply */
  filters: (
    'owner' | 'cls' | 'bank' | 'currency' | 'amc' | 'plan' | 'option' | 'kind' | 'amount' | 'q'
  )[];
  /** a template whose full report lives on its own page */
  link?: string;
}

export const CENTRE_TEMPLATES: CentreTemplate[] = [
  {
    key: 'networth',
    label: 'Net worth',
    about:
      'Net worth at the start and end of the period, by kind of holding and by person, with the change.',
    usesPeriod: true,
    defaultPeriod: 'this-fy',
    groups: ['none'],
    filters: ['owner'],
  },
  {
    key: 'holdings',
    label: 'All holdings',
    about:
      'Everything counted today, one line each: value, cost where known, gain not yet booked, date and basis.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['cls', 'owner', 'bank', 'currency', 'none'],
    filters: ['owner', 'cls', 'bank', 'currency', 'amount', 'q'],
  },
  {
    key: 'cash',
    label: 'Cash and bank',
    about:
      'Savings and current accounts today, in their own currency and in rupees, with the date of each balance.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['bank', 'owner', 'currency', 'none'],
    filters: ['owner', 'bank', 'currency', 'amount', 'q'],
  },
  {
    key: 'deposits',
    label: 'Fixed deposits in the period',
    about:
      'Deposits running at any time in the period: principal, rate, and the interest earned within the period (estimated from terms).',
    usesPeriod: true,
    defaultPeriod: 'this-fy',
    groups: ['bank', 'owner', 'month', 'quarter', 'fy', 'none'],
    filters: ['owner', 'bank', 'amount', 'q'],
  },
  {
    key: 'maturities',
    label: 'Deposit maturities',
    about: 'Deposits maturing in the period, date by date, with the amount that comes back.',
    usesPeriod: true,
    defaultPeriod: 'next-90',
    groups: ['month', 'bank', 'owner', 'quarter', 'fy', 'none'],
    filters: ['owner', 'bank', 'amount', 'q'],
  },
  {
    key: 'funds',
    label: 'Mutual funds',
    about:
      'Funds held today: units, cost of the units held, value, gain not yet booked; plan, option and index or not.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['amc', 'category', 'plan', 'option', 'owner', 'none'],
    filters: ['owner', 'amc', 'plan', 'option', 'amount', 'q'],
  },
  {
    key: 'transactions',
    label: 'Investment transactions',
    about:
      'Every fund purchase, instalment, switch and sale in the period, confirmed or assumed from the plan.',
    usesPeriod: true,
    defaultPeriod: 'this-fy',
    groups: ['month', 'quarter', 'fy', 'fund', 'kind', 'owner', 'amc', 'none'],
    filters: ['owner', 'amc', 'plan', 'kind', 'amount', 'q'],
  },
  {
    key: 'contributions',
    label: 'SIPs and contributions',
    about:
      'Money put into funds and taken out, by period: confirmed instalments apart from those assumed from the plan.',
    usesPeriod: true,
    defaultPeriod: 'this-fy',
    groups: ['month', 'quarter', 'fy', 'year', 'fund', 'owner'],
    filters: ['owner', 'amc', 'plan', 'q'],
  },
  {
    key: 'realised',
    label: 'Gains booked by selling',
    about:
      'Each sale in the period: proceeds, the cost of the units sold (first in, first out), the gain and how long they were held.',
    usesPeriod: true,
    defaultPeriod: 'this-fy',
    groups: ['none', 'fund', 'owner', 'month', 'fy'],
    filters: ['owner', 'amc', 'q'],
  },
  {
    key: 'currency',
    label: 'SGD and other currencies',
    about:
      'Money held in each foreign currency: its own amount, the rate used and its date, and the rupee value.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['none'],
    filters: [],
  },
  {
    key: 'receivables',
    label: 'Money lent',
    about: 'What is still owed to the family, when it is expected and how late it is.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['none'],
    filters: ['amount', 'q'],
  },
  {
    key: 'goals',
    label: 'Goal funding',
    about: 'Each goal: its target, the money set aside and where it stands.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['none'],
    filters: ['q'],
  },
  {
    key: 'quality',
    label: 'Data quality',
    about:
      'What is out of date, estimated, missing a statement or waiting for an answer, so the other reports can be trusted.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: ['none'],
    filters: ['owner'],
  },
  {
    key: 'tax',
    label: 'Tax and capital gains',
    about:
      'Capital gains by financial year (Schedule 112A), interest income and the 26AS / AIS check.',
    usesPeriod: false,
    defaultPeriod: 'last-fy',
    groups: [],
    filters: [],
    link: '/tax/filing',
  },
  {
    key: 'performance',
    label: 'Performance',
    about:
      'Returns by period, against a benchmark, drawdown and rolling returns of the mutual funds.',
    usesPeriod: false,
    defaultPeriod: 'last-12m',
    groups: [],
    filters: [],
    link: '/investments?tab=performance',
  },
  {
    key: 'retirement',
    label: 'Retirement readiness',
    about: 'Whether the money lasts: the plan, the simulations and the spending it supports.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: [],
    filters: [],
    link: '/retire',
  },
  {
    key: 'insurance',
    label: 'Insurance, pension and property',
    about: 'Policies and renewals, pension accounts and property values.',
    usesPeriod: false,
    defaultPeriod: 'today',
    groups: [],
    filters: [],
    link: '/others?tab=policies',
  },
];

export const templateOf = (k: string | null | undefined): CentreTemplate =>
  CENTRE_TEMPLATES.find((t) => t.key === k) ?? CENTRE_TEMPLATES[0]!;

export interface CentreQuery {
  template: TemplateKey;
  period: ReportPeriodKey;
  from?: string | null;
  to?: string | null;
  owner?: string | null;
  cls?: HoldingClass | null;
  bank?: string | null;
  currency?: string | null;
  amc?: string | null;
  plan?: 'direct' | 'regular' | null;
  option?: 'growth' | 'idcw' | null;
  kind?: string | null;
  min?: number | null;
  max?: number | null;
  q?: string | null;
  group?: GroupKey | null;
  compare?: boolean;
}

/** The query in the address (short names), and back: what a saved report keeps. */
export function queryToParams(q: CentreQuery): Record<string, string> {
  const out: Record<string, string> = { t: q.template, period: q.period };
  const put = (k: string, v: string | number | null | undefined) => {
    if (v !== null && v !== undefined && v !== '') out[k] = String(v);
  };
  if (q.period === 'custom') {
    put('from', q.from);
    put('to', q.to);
  }
  put('p', q.owner);
  put('cls', q.cls);
  put('bank', q.bank);
  put('cur', q.currency);
  put('amc', q.amc);
  put('plan', q.plan);
  put('opt', q.option);
  put('kind', q.kind);
  put('min', q.min);
  put('max', q.max);
  put('q', q.q);
  if (q.group) put('g', q.group);
  if (q.compare) out.cmp = '1';
  return out;
}

const PERIOD_KEYS = new Set<string>(PERIOD_PRESETS.map((x) => x.key));
const CLASSES: HoldingClass[] = ['cash', 'fd', 'funds', 'others'];
const GROUPS = Object.keys(GROUP_LABEL) as GroupKey[];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function paramsToQuery(p: Record<string, string | undefined>): CentreQuery {
  const t = templateOf(p.t);
  const num = (v: string | undefined) => {
    if (v === undefined || v.trim() === '') return null;
    const n = Number(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const text = (v: string | undefined) => (v && v.trim() ? v.trim().slice(0, 80) : null);
  const period = (
    p.period && PERIOD_KEYS.has(p.period) ? p.period : t.defaultPeriod
  ) as ReportPeriodKey;
  const group =
    p.g && GROUPS.includes(p.g as GroupKey) && t.groups.includes(p.g as GroupKey)
      ? (p.g as GroupKey)
      : null;
  return {
    template: t.key,
    period,
    from: p.from && ISO.test(p.from) ? p.from : null,
    to: p.to && ISO.test(p.to) ? p.to : null,
    owner: text(p.p),
    cls: CLASSES.includes(p.cls as HoldingClass) ? (p.cls as HoldingClass) : null,
    bank: text(p.bank),
    currency: p.cur && /^[A-Za-z]{3}$/.test(p.cur) ? p.cur.toUpperCase() : null,
    amc: text(p.amc),
    plan: p.plan === 'direct' || p.plan === 'regular' ? p.plan : null,
    option: p.opt === 'growth' || p.opt === 'idcw' ? p.opt : null,
    kind: text(p.kind),
    min: num(p.min),
    max: num(p.max),
    q: text(p.q),
    group,
    compare: p.cmp === '1',
  };
}

// ---- classification ------------------------------------------------------------------------------

/** Growth or IDCW (dividend), from the scheme's name; unknown when the name does not say. */
export function fundOption(name: string): 'growth' | 'idcw' | 'unknown' {
  if (/\b(idcw|dividend|div\.?|payout|reinvest(ment)?)\b/i.test(name)) return 'idcw';
  if (/\bgrowth\b|\bgr\b|-\s*g\b/i.test(name)) return 'growth';
  return 'unknown';
}

/** An index fund or exchange-traded fund, from the scheme's name or its category. */
export const isIndexFund = (name: string, category: string) =>
  /\b(index|nifty|sensex|etf|exchange traded)\b/i.test(name) || /index/i.test(category);

/** Direct or Regular: the saved plan, else the scheme's name. */
export function fundPlan(f: Pick<CentreFund, 'plan' | 'name'>): 'direct' | 'regular' | 'unknown' {
  if (f.plan !== 'unknown') return f.plan;
  if (/\bdirect\b/i.test(f.name)) return 'direct';
  if (/\bregular\b/i.test(f.name)) return 'regular';
  return 'unknown';
}

const PLAN_LABEL = { direct: 'Direct', regular: 'Regular', unknown: 'Not known' } as const;
const OPTION_LABEL = { growth: 'Growth', idcw: 'IDCW (dividend)', unknown: 'Not known' } as const;
const CLASS_LABEL: Record<HoldingClass, string> = {
  cash: 'Cash',
  fd: 'Fixed deposits',
  funds: 'Mutual funds',
  others: 'Others',
};
const KIND_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  redeem: 'Sale (redemption)',
  switch_out: 'Switch out',
  other: 'Other',
};
export const kindLabel = (k: string) => KIND_LABEL[k] ?? k.replace(/_/g, ' ');
const MONEY_IN = new Set(['purchase', 'sip', 'switch_in']);
const MONEY_OUT = new Set(['redeem', 'switch_out']);

const TYPE_LABEL: Record<string, string> = {
  bank_account: 'Savings and current',
  fixed_deposit: 'Fixed deposits',
  mutual_fund: 'Mutual funds',
  stock: 'Shares',
  receivable: 'Money lent',
  property: 'Property',
  nps: 'Pension (NPS)',
  ulip: 'Unit-linked policies',
  third_party_held: 'Held by others',
  other: 'Other',
};

// ---- output --------------------------------------------------------------------------------------

export interface CentreKpi {
  label: string;
  value: number | null;
  kind: 'money' | 'int' | 'pct';
  /** the same figure for the period before, when comparing */
  previous?: number | null | undefined;
  note?: string;
}

export interface CentreReport {
  template: CentreTemplate;
  range: DateRange;
  previous: DateRange | null;
  /** the filters applied, in words, as the person reads them */
  applied: string[];
  kpis: CentreKpi[];
  tables: ReportTable[];
  /** what the figures rest on and what they leave out */
  notes: string[];
  /** feasibility of the report as asked: A works fully, B with a stated limit, C an estimate */
  basis: 'A' | 'B' | 'C';
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const money = (key: string, label: string): Col => ({ key, label, kind: 'money' });
const text = (key: string, label: string): Col => ({ key, label, kind: 'text' });
const date = (key: string, label: string): Col => ({ key, label, kind: 'date' });
const int = (key: string, label: string): Col => ({ key, label, kind: 'int' });

const matchesText = (q: string | null | undefined, ...fields: (string | null | undefined)[]) =>
  !q || fields.some((f) => f && f.toLowerCase().includes(q.toLowerCase()));
const inAmount = (v: number, q: CentreQuery) =>
  (q.min === null || q.min === undefined || Math.abs(v) >= q.min) &&
  (q.max === null || q.max === undefined || Math.abs(v) <= q.max);
const same = (a: string | null | undefined, b: string | null | undefined) =>
  !b || (a ?? '').toLowerCase() === b.toLowerCase();

/**
 * Rows bunched by one field: one line per group with the count and the sums of the money columns, largest first (date groups in
 * date order), and a total line.
 */
export function groupRows(
  id: string,
  title: string,
  rows: Record<string, Cell>[],
  by: (r: Record<string, Cell>) => { key: string; label: string },
  sums: Col[],
  byLabel: string,
  dated = false,
): ReportTable {
  const groups = new Map<string, { label: string; n: number; sums: number[] }>();
  for (const r of rows) {
    const g = by(r);
    const cur = groups.get(g.key) ?? { label: g.label, n: 0, sums: sums.map(() => 0) };
    cur.n++;
    sums.forEach((c, i) => (cur.sums[i]! += Number(r[c.key] ?? 0) || 0));
    groups.set(g.key, cur);
  }
  const list = [...groups.entries()].sort((a, b) =>
    dated ? a[0].localeCompare(b[0]) : (b[1].sums[0] ?? 0) - (a[1].sums[0] ?? 0),
  );
  const columns: Col[] = [text('group', byLabel), int('n', 'Lines'), ...sums];
  return {
    id,
    title,
    columns,
    rows: list.map(([, g]) => ({
      group: g.label,
      n: g.n,
      ...Object.fromEntries(sums.map((c, i) => [c.key, r2(g.sums[i]!)])),
    })),
    total: {
      group: 'Total',
      n: rows.length,
      ...Object.fromEntries(
        sums.map((c) => [c.key, r2(sum(rows.map((r) => Number(r[c.key] ?? 0) || 0)))]),
      ),
    },
    chart: list.map(([, g]) => ({ label: g.label, value: r2(g.sums[0] ?? 0) })),
  };
}

const PERIOD_GROUPS: Partial<Record<GroupKey, 'month' | 'quarter' | 'fy' | 'year'>> = {
  month: 'month',
  quarter: 'quarter',
  fy: 'fy',
  year: 'year',
};

// ---- the templates -------------------------------------------------------------------------------

/** The latest snapshot on or before a date. */
const snapAt = (snaps: CentreSnapshot[], on: string) =>
  [...snaps].filter((s) => s.date <= on).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;

/** Net worth today, by kind and by person, from the holdings (the same figures as Home). */
function nowSnapshot(i: CentreInput): CentreSnapshot {
  const byType: Record<string, number> = {};
  const byOwner: Record<string, number> = {};
  for (const h of i.holdings) {
    byType[h.type] = (byType[h.type] ?? 0) + h.value;
    byOwner[h.ownerId] = (byOwner[h.ownerId] ?? 0) + h.value;
  }
  return { date: i.today, total: sum(Object.values(byType)), byType, byOwner };
}

/** The value at the end of a day: today's holdings for today, else the snapshot of that day or the one before. */
const valueOn = (i: CentreInput, on: string) =>
  on >= i.today ? nowSnapshot(i) : snapAt(i.snapshots, on);
const dayBefore = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

function netWorthReport(i: CentreInput, q: CentreQuery, range: DateRange, prev: DateRange | null) {
  const start = valueOn(i, dayBefore(range.from));
  const end = valueOn(i, range.to);
  const notes: string[] = [
    'The start is net worth at the end of the day before the period begins; the end is the last day of the period (today’s figures when it ends today). The change includes money put in and taken out: it is not profit.',
  ];
  let basis: CentreReport['basis'] = 'A';
  if (!start)
    notes.push(
      'No daily snapshot reaches back to the start of this period, so the start and the change cannot be shown. Choose a later period, or rebuild the history (Import → Balance history).',
    );
  if (start && start.date !== dayBefore(range.from)) {
    basis = 'B';
    notes.push(`The start uses the nearest earlier snapshot, of ${longDay(start.date)}.`);
  }
  if (end && end.date !== range.to && range.to < i.today) {
    basis = 'B';
    notes.push(`The end uses the nearest earlier snapshot, of ${longDay(end.date)}.`);
  }
  const kinds = new Set([...Object.keys(start?.byType ?? {}), ...Object.keys(end?.byType ?? {})]);
  const people = new Set([
    ...Object.keys(start?.byOwner ?? {}),
    ...Object.keys(end?.byOwner ?? {}),
  ]);
  const line = (
    label: string,
    a: number | undefined,
    b: number | undefined,
  ): Record<string, Cell> => ({
    item: label,
    start: start ? r2(a ?? 0) : null,
    end: end ? r2(b ?? 0) : null,
    change: start && end ? r2((b ?? 0) - (a ?? 0)) : null,
    changePct: start && end && (a ?? 0) > 0 ? ((b ?? 0) - (a ?? 0)) / (a ?? 0) : null,
  });
  const cols: Col[] = [
    text('item', 'Item'),
    money('start', 'Start'),
    money('end', 'End'),
    money('change', 'Change'),
    { key: 'changePct', label: 'Change %', kind: 'pct' },
  ];
  const byKind: ReportTable = {
    id: 'networth-kind',
    title: 'Net worth by kind of holding',
    ...(q.owner
      ? { note: 'Snapshots keep kinds and people apart, so this table is the whole family.' }
      : {}),
    columns: cols,
    rows: [...kinds]
      .sort((a, b) => (end?.byType[b] ?? 0) - (end?.byType[a] ?? 0))
      .map((k) => line(TYPE_LABEL[k] ?? k, start?.byType[k], end?.byType[k])),
    total: line('Total', start?.total, end?.total),
  };
  const owners = [...people].filter((o) => !q.owner || o === q.owner);
  const byPerson: ReportTable = {
    id: 'networth-person',
    title: 'Net worth by person',
    columns: cols,
    rows: owners
      .sort((a, b) => (end?.byOwner[b] ?? 0) - (end?.byOwner[a] ?? 0))
      .map((o) => line(i.people[o] ?? 'Unknown', start?.byOwner[o], end?.byOwner[o])),
    total: line(
      'Total',
      sum(owners.map((o) => start?.byOwner[o] ?? 0)),
      sum(owners.map((o) => end?.byOwner[o] ?? 0)),
    ),
  };
  const pick = (s: CentreSnapshot | null) =>
    s ? (q.owner ? (s.byOwner[q.owner] ?? 0) : s.total) : null;
  const change = start && end ? pick(end)! - pick(start)! : null;
  let prevChange: number | null = null;
  if (prev) {
    const ps = valueOn(i, dayBefore(prev.from));
    const pe = valueOn(i, prev.to);
    prevChange = ps && pe ? pick(pe)! - pick(ps)! : null;
  }
  return {
    tables: [byKind, byPerson],
    kpis: [
      { label: 'At the start', value: pick(start), kind: 'money' as const },
      { label: 'At the end', value: pick(end), kind: 'money' as const },
      {
        label: 'Change',
        value: change,
        kind: 'money' as const,
        previous: q.compare ? prevChange : undefined,
      },
    ],
    notes,
    basis,
  };
}

function holdingsReport(i: CentreInput, q: CentreQuery, onlyCash: boolean) {
  const rows = i.holdings
    .filter(
      (h) =>
        (!onlyCash || h.cls === 'cash') &&
        same(h.ownerId, q.owner) &&
        (!q.cls || h.cls === q.cls) &&
        same(h.bank, q.bank) &&
        same(h.currency, q.currency) &&
        inAmount(h.value, q) &&
        matchesText(q.q, h.name, h.bank, i.people[h.ownerId]),
    )
    .sort((a, b) => b.value - a.value);
  const lines: Record<string, Cell>[] = rows.map((h) => ({
    name: h.name,
    person: i.people[h.ownerId] ?? 'Unknown',
    cls: CLASS_LABEL[h.cls],
    bank: h.bank ?? '—',
    currency: h.currency,
    native: h.currency !== 'INR' ? h.native : null,
    value: r2(h.value),
    cost: h.cost === null ? null : r2(h.cost),
    gain: h.cost === null ? null : r2(h.value - h.cost),
    asOf: h.asOf,
    basis: h.stale ? 'Out of date' : h.estimated ? 'Estimated' : 'Actual',
  }));
  const columns: Col[] = onlyCash
    ? [
        text('name', 'Account'),
        text('person', 'Person'),
        text('bank', 'Bank'),
        text('currency', 'Currency'),
        { key: 'native', label: 'In its currency', kind: 'money' },
        money('value', 'In rupees'),
        date('asOf', 'Balance of'),
        text('basis', 'Basis'),
      ]
    : [
        text('name', 'Holding'),
        text('person', 'Person'),
        text('cls', 'Kind'),
        text('bank', 'Bank'),
        text('currency', 'Currency'),
        money('value', 'Value today'),
        money('cost', 'Cost'),
        money('gain', 'Gain not yet booked'),
        date('asOf', 'As of'),
        text('basis', 'Basis'),
      ];
  const detail: ReportTable = {
    id: onlyCash ? 'cash' : 'holdings',
    title: onlyCash ? 'Cash and bank accounts' : 'All holdings',
    columns,
    rows: lines,
    total: {
      name: 'Total',
      value: r2(sum(rows.map((h) => h.value))),
      ...(onlyCash
        ? {}
        : {
            cost: r2(sum(rows.filter((h) => h.cost !== null).map((h) => h.cost!))),
            gain: r2(sum(rows.filter((h) => h.cost !== null).map((h) => h.value - h.cost!))),
          }),
    },
  };
  const g = q.group ?? (onlyCash ? 'bank' : 'cls');
  const tables = [detail];
  if (g !== 'none') {
    const key = (h: CentreHolding) =>
      g === 'owner'
        ? { key: h.ownerId, label: i.people[h.ownerId] ?? 'Unknown' }
        : g === 'bank'
          ? { key: h.bank ?? '~', label: h.bank ?? 'No bank' }
          : g === 'currency'
            ? { key: h.currency, label: h.currency }
            : { key: h.cls, label: CLASS_LABEL[h.cls] };
    const byId = new Map(rows.map((h, n) => [lines[n]!, h]));
    tables.unshift(
      groupRows(
        `${detail.id}-by-${g}`,
        `${detail.title} by ${GROUP_LABEL[g].toLowerCase()}`,
        lines,
        (r) => key(byId.get(r)!),
        [money('value', 'Value today')],
        GROUP_LABEL[g],
      ),
    );
  }
  const stale = rows.filter((h) => h.stale).length;
  const est = rows.filter((h) => h.estimated).length;
  const notes = [
    onlyCash
      ? 'Cash only: deposits and mutual funds are never counted as cash. A foreign-currency balance is shown in its own currency and in rupees at the rate on the Currency report.'
      : 'Valued by the same engine as Home. "Cost" is the deposit principal or the cost of the fund units still held; for other holdings it is not known and left blank, not zero.',
  ];
  if (stale)
    notes.push(
      `${stale} line${stale === 1 ? ' is' : 's are'} out of date and counted at the last value.`,
    );
  if (est)
    notes.push(
      `${est} line${est === 1 ? ' rests' : 's rest'} on an estimate (interest from a rate, a fund value from a plan).`,
    );
  return {
    tables,
    kpis: [
      {
        label: onlyCash ? 'Cash in rupees' : 'Total value',
        value: r2(sum(rows.map((h) => h.value))),
        kind: 'money' as const,
      },
      { label: 'Lines', value: rows.length, kind: 'int' as const },
      { label: 'Out of date', value: stale, kind: 'int' as const },
    ],
    notes,
    basis: (stale || est ? 'B' : 'A') as CentreReport['basis'],
  };
}

const at = (s: string) => new Date(`${s}T00:00:00Z`);
/** Interest a deposit earns between two dates (both included), from its terms. */
export function fdInterestWithin(d: CentreDeposit, from: string, to: string): number {
  const start = from > d.bookedOn ? from : d.bookedOn;
  const endDay = to < d.maturityOn ? to : d.maturityOn;
  if (endDay < start || !(d.principal > 0)) return 0;
  const v = (s: string) =>
    fdValueOn({
      principal: d.principal,
      annualRate: d.rate,
      bookedOn: at(d.bookedOn),
      asOf: at(s),
      maturityOn: at(d.maturityOn),
      compounding: d.compounding,
    });
  // the value at the end of `to` is the value on the next day
  const next = (s: string) => {
    const x = at(s);
    x.setUTCDate(x.getUTCDate() + 1);
    return x.toISOString().slice(0, 10);
  };
  return Math.max(0, v(endDay === d.maturityOn ? d.maturityOn : next(endDay)) - v(start));
}

function depositsReport(
  i: CentreInput,
  q: CentreQuery,
  range: DateRange,
  prev: DateRange | null,
  maturing: boolean,
) {
  const keep = (d: CentreDeposit) =>
    same(d.ownerId, q.owner) &&
    same(d.bank, q.bank) &&
    inAmount(d.principal, q) &&
    matchesText(q.q, d.name, d.bank, i.people[d.ownerId]);
  const list = i.deposits
    .filter(keep)
    .filter((d) =>
      maturing
        ? inRange(d.maturityOn, range)
        : d.bookedOn <= range.to && d.maturityOn >= range.from,
    )
    .sort((a, b) => a.maturityOn.localeCompare(b.maturityOn));
  const rows: Record<string, Cell>[] = list.map((d) => ({
    name: d.name,
    bank: d.bank,
    person: i.people[d.ownerId] ?? 'Unknown',
    bookedOn: d.bookedOn,
    maturityOn: d.maturityOn,
    principal: r2(d.principal),
    rate: d.rate,
    interest: maturing
      ? r2(d.maturityAmount - d.principal)
      : r2(fdInterestWithin(d, range.from, range.to)),
    back: r2(d.maturityAmount),
    state:
      d.bookedOn >= range.from && d.bookedOn <= range.to
        ? 'Booked in the period'
        : d.maturityOn <= range.to
          ? 'Matured in the period'
          : 'Running',
  }));
  const columns: Col[] = maturing
    ? [
        date('maturityOn', 'Matures'),
        text('name', 'Deposit'),
        text('bank', 'Bank'),
        text('person', 'Person'),
        money('principal', 'Principal'),
        { key: 'rate', label: 'Rate', kind: 'rate' },
        money('interest', 'Interest over its term'),
        money('back', 'Comes back'),
      ]
    : [
        text('name', 'Deposit'),
        text('bank', 'Bank'),
        text('person', 'Person'),
        date('bookedOn', 'Booked'),
        date('maturityOn', 'Matures'),
        money('principal', 'Principal'),
        { key: 'rate', label: 'Rate', kind: 'rate' },
        money('interest', 'Interest in the period'),
        text('state', 'In the period'),
      ];
  const detail: ReportTable = {
    id: maturing ? 'maturities' : 'deposits',
    title: maturing ? 'Deposits maturing' : 'Fixed deposits in the period',
    columns,
    rows,
    total: {
      [maturing ? 'maturityOn' : 'name']: 'Total',
      principal: r2(sum(list.map((d) => d.principal))),
      interest: r2(sum(rows.map((r) => Number(r.interest)))),
      ...(maturing ? { back: r2(sum(list.map((d) => d.maturityAmount))) } : {}),
    },
  };
  const g = q.group ?? (maturing ? 'month' : 'bank');
  const tables = [detail];
  if (g !== 'none') {
    const period = PERIOD_GROUPS[g];
    const byRow = new Map(rows.map((r, n) => [r, list[n]!]));
    tables.unshift(
      groupRows(
        `${detail.id}-by-${g}`,
        `${detail.title} by ${GROUP_LABEL[g].toLowerCase()}`,
        rows,
        (r) => {
          const d = byRow.get(r)!;
          if (period) return periodOf(d.maturityOn, period);
          return g === 'owner'
            ? { key: d.ownerId, label: i.people[d.ownerId] ?? 'Unknown' }
            : { key: d.bank, label: d.bank };
        },
        maturing
          ? [money('back', 'Comes back'), money('principal', 'Principal')]
          : [money('principal', 'Principal'), money('interest', 'Interest in the period')],
        period ? `${GROUP_LABEL[g]} of maturity` : GROUP_LABEL[g],
        !!period,
      ),
    );
  }
  const interest = sum(rows.map((r) => Number(r.interest)));
  let prevInterest: number | null = null;
  if (q.compare && prev && !maturing)
    prevInterest = r2(
      sum(
        i.deposits
          .filter(keep)
          .filter((d) => d.bookedOn <= prev.to && d.maturityOn >= prev.from)
          .map((d) => fdInterestWithin(d, prev.from, prev.to)),
      ),
    );
  if (q.compare && prev && maturing)
    prevInterest = r2(
      sum(
        i.deposits
          .filter(keep)
          .filter((d) => inRange(d.maturityOn, prev))
          .map((d) => d.maturityAmount),
      ),
    );
  return {
    tables,
    kpis: maturing
      ? [
          { label: 'Deposits', value: list.length, kind: 'int' as const },
          {
            label: 'Principal',
            value: r2(sum(list.map((d) => d.principal))),
            kind: 'money' as const,
          },
          {
            label: 'Comes back',
            value: r2(sum(list.map((d) => d.maturityAmount))),
            kind: 'money' as const,
            previous: q.compare ? prevInterest : undefined,
          },
        ]
      : [
          { label: 'Deposits', value: list.length, kind: 'int' as const },
          {
            label: 'Principal',
            value: r2(sum(list.map((d) => d.principal))),
            kind: 'money' as const,
          },
          {
            label: 'Interest in the period (estimated)',
            value: r2(interest),
            kind: 'money' as const,
            previous: q.compare ? prevInterest : undefined,
          },
        ],
    notes: [
      maturing
        ? '"Comes back" is the bank’s maturity amount where it is on file, else the amount from the deposit’s terms. Renewals are never assumed.'
        : 'Interest in the period is worked out from each deposit’s principal, rate, booking date and compounding, from the later of its booking and the period’s start to the earlier of its maturity and the period’s end. It is an estimate, before tax; the bank’s certificate decides.',
      'Principal and interest are kept apart; a matured deposit is not counted again where its money went.',
    ],
    basis: (maturing ? 'A' : 'C') as CentreReport['basis'],
  };
}

const fundKeep = (i: CentreInput, q: CentreQuery) => (f: CentreFund) =>
  same(f.ownerId, q.owner) &&
  same(f.amc, q.amc) &&
  (!q.plan || fundPlan(f) === q.plan) &&
  (!q.option || fundOption(f.name) === q.option) &&
  matchesText(q.q, f.name, f.amc, i.people[f.ownerId]);

function fundsReport(i: CentreInput, q: CentreQuery) {
  const list = i.funds
    .filter(fundKeep(i, q))
    .filter((f) => f.value > 0 && inAmount(f.value, q))
    .sort((a, b) => b.value - a.value);
  const rows: Record<string, Cell>[] = list.map((f) => ({
    name: f.name,
    person: i.people[f.ownerId] ?? 'Unknown',
    amc: f.amc ?? '—',
    category: f.category,
    plan: PLAN_LABEL[fundPlan(f)],
    option: OPTION_LABEL[fundOption(f.name)],
    index: isIndexFund(f.name, f.category) ? 'Index' : 'Active',
    units: f.units,
    cost: r2(f.cost),
    value: r2(f.value),
    gain: r2(f.value - f.cost),
    gainPct: f.cost > 0 ? (f.value - f.cost) / f.cost : null,
    basis: f.hasStatement ? 'Statement' : 'Estimated from a plan',
  }));
  const detail: ReportTable = {
    id: 'funds',
    title: 'Mutual funds held',
    columns: [
      text('name', 'Fund'),
      text('person', 'Person'),
      text('amc', 'Fund house'),
      text('category', 'Category'),
      text('plan', 'Plan'),
      text('option', 'Option'),
      text('index', 'Index or active'),
      { key: 'units', label: 'Units', kind: 'int' },
      money('cost', 'Cost of units held'),
      money('value', 'Value today'),
      money('gain', 'Gain not yet booked'),
      { key: 'gainPct', label: 'Gain %', kind: 'pct' },
      text('basis', 'Basis'),
    ],
    rows,
    total: {
      name: 'Total',
      cost: r2(sum(list.map((f) => f.cost))),
      value: r2(sum(list.map((f) => f.value))),
      gain: r2(sum(list.map((f) => f.value - f.cost))),
      gainPct:
        sum(list.map((f) => f.cost)) > 0
          ? sum(list.map((f) => f.value - f.cost)) / sum(list.map((f) => f.cost))
          : null,
    },
  };
  const g = q.group ?? 'amc';
  const tables = [detail];
  if (g !== 'none') {
    const byRow = new Map(rows.map((r, n) => [r, list[n]!]));
    const key = (f: CentreFund) =>
      g === 'owner'
        ? { key: f.ownerId, label: i.people[f.ownerId] ?? 'Unknown' }
        : g === 'category'
          ? { key: f.category, label: f.category }
          : g === 'plan'
            ? { key: fundPlan(f), label: PLAN_LABEL[fundPlan(f)] }
            : g === 'option'
              ? { key: fundOption(f.name), label: OPTION_LABEL[fundOption(f.name)] }
              : { key: f.amc ?? '~', label: f.amc ?? 'Not known' };
    tables.unshift(
      groupRows(
        `funds-by-${g}`,
        `Mutual funds by ${GROUP_LABEL[g].toLowerCase()}`,
        rows,
        (r) => key(byRow.get(r)!),
        [
          money('value', 'Value today'),
          money('cost', 'Cost of units held'),
          money('gain', 'Gain not yet booked'),
        ],
        GROUP_LABEL[g],
      ),
    );
  }
  const noStatement = list.filter((f) => !f.hasStatement).length;
  const unknownPlan = list.filter((f) => fundPlan(f) === 'unknown').length;
  const notes = [
    'Mutual funds are investments, never cash. The cost is what the units still held cost (first in, first out), so the gain here is the gain not yet booked; gains booked by selling are on their own report.',
    'Plan comes from the statement or the scheme name; option (Growth or IDCW) and index or active come from the scheme name and category.',
  ];
  if (noStatement)
    notes.push(
      `${noStatement} fund${noStatement === 1 ? ' has' : 's have'} no statement yet: value and cost rest on the SIP plan.`,
    );
  if (unknownPlan)
    notes.push(
      `${unknownPlan} fund${unknownPlan === 1 ? '’s plan is' : 's’ plans are'} not known.`,
    );
  return {
    tables,
    kpis: [
      { label: 'Value today', value: r2(sum(list.map((f) => f.value))), kind: 'money' as const },
      {
        label: 'Cost of units held',
        value: r2(sum(list.map((f) => f.cost))),
        kind: 'money' as const,
      },
      {
        label: 'Gain not yet booked',
        value: r2(sum(list.map((f) => f.value - f.cost))),
        kind: 'money' as const,
      },
    ],
    notes,
    basis: (noStatement ? 'B' : 'A') as CentreReport['basis'],
  };
}

function txnRows(i: CentreInput, q: CentreQuery, range: { from: string; to: string }) {
  const out: { f: CentreFund; t: CentreFundTxn }[] = [];
  for (const f of i.funds.filter(fundKeep(i, q)))
    for (const t of f.txns)
      if (inRange(t.date, range) && (!q.kind || t.kind === q.kind) && inAmount(t.amount, q))
        out.push({ f, t });
  return out.sort((a, b) => b.t.date.localeCompare(a.t.date) || a.f.name.localeCompare(b.f.name));
}

function transactionsReport(
  i: CentreInput,
  q: CentreQuery,
  range: DateRange,
  prev: DateRange | null,
) {
  const list = txnRows(i, q, range);
  const rows: Record<string, Cell>[] = list.map(({ f, t }) => ({
    date: t.date,
    fund: f.name,
    person: i.people[f.ownerId] ?? 'Unknown',
    kind: kindLabel(t.kind),
    units: t.units,
    in: MONEY_IN.has(t.kind) ? r2(t.amount) : null,
    out: MONEY_OUT.has(t.kind) ? r2(Math.abs(t.amount)) : null,
    other: !MONEY_IN.has(t.kind) && !MONEY_OUT.has(t.kind) ? r2(t.amount) : null,
    basis: t.estimated ? 'Assumed from the SIP plan' : 'Confirmed',
  }));
  const totals = (l: typeof list) => ({
    in: r2(sum(l.filter((x) => MONEY_IN.has(x.t.kind)).map((x) => x.t.amount))),
    out: r2(sum(l.filter((x) => MONEY_OUT.has(x.t.kind)).map((x) => Math.abs(x.t.amount)))),
  });
  const now = totals(list);
  const before = q.compare && prev ? totals(txnRows(i, q, prev)) : null;
  const detail: ReportTable = {
    id: 'transactions',
    title: 'Investment transactions',
    columns: [
      date('date', 'Date'),
      text('fund', 'Fund'),
      text('person', 'Person'),
      text('kind', 'Type'),
      { key: 'units', label: 'Units', kind: 'int' },
      money('in', 'Money in'),
      money('out', 'Money out'),
      money('other', 'Other (no money moved)'),
      text('basis', 'Basis'),
    ],
    rows,
    total: { date: null, fund: 'Total', in: now.in, out: now.out },
  };
  const g = q.group ?? 'month';
  const tables = [detail];
  if (g !== 'none') {
    const period = PERIOD_GROUPS[g];
    const byRow = new Map(rows.map((r, n) => [r, list[n]!]));
    tables.unshift(
      groupRows(
        `transactions-by-${g}`,
        `Transactions by ${GROUP_LABEL[g].toLowerCase()}`,
        rows,
        (r) => {
          const { f, t } = byRow.get(r)!;
          if (period) return periodOf(t.date, period);
          return g === 'fund'
            ? { key: f.id, label: f.name }
            : g === 'kind'
              ? { key: t.kind, label: kindLabel(t.kind) }
              : g === 'amc'
                ? { key: f.amc ?? '~', label: f.amc ?? 'Not known' }
                : { key: f.ownerId, label: i.people[f.ownerId] ?? 'Unknown' };
        },
        [money('in', 'Money in'), money('out', 'Money out')],
        GROUP_LABEL[g],
        !!period,
      ),
    );
  }
  const assumed = list.filter((x) => x.t.estimated).length;
  const notes = [
    'Money in is purchases, instalments and switches in; money out is sales and switches out. Neither is profit: gains booked by selling are on their own report.',
  ];
  if (assumed)
    notes.push(
      `${assumed} instalment${assumed === 1 ? ' is' : 's are'} assumed from the SIP plan and not yet confirmed by a statement.`,
    );
  return {
    tables,
    kpis: [
      { label: 'Money in', value: now.in, kind: 'money' as const, previous: before?.in },
      { label: 'Money out', value: now.out, kind: 'money' as const, previous: before?.out },
      {
        label: 'Net put in',
        value: r2(now.in - now.out),
        kind: 'money' as const,
        previous: before ? r2(before.in - before.out) : undefined,
      },
    ],
    notes,
    basis: (assumed ? 'B' : 'A') as CentreReport['basis'],
  };
}

function contributionsReport(
  i: CentreInput,
  q: CentreQuery,
  range: DateRange,
  prev: DateRange | null,
) {
  const g = q.group ?? 'month';
  const period = PERIOD_GROUPS[g];
  const list = txnRows(i, { ...q, kind: null, min: null, max: null }, range);
  const groups = new Map<
    string,
    { label: string; confirmed: number; assumed: number; out: number }
  >();
  for (const { f, t } of list) {
    const k = period
      ? periodOf(t.date, period)
      : g === 'fund'
        ? { key: f.id, label: f.name }
        : { key: f.ownerId, label: i.people[f.ownerId] ?? 'Unknown' };
    const cur = groups.get(k.key) ?? { label: k.label, confirmed: 0, assumed: 0, out: 0 };
    if (MONEY_IN.has(t.kind)) {
      if (t.estimated) cur.assumed += t.amount;
      else cur.confirmed += t.amount;
    } else if (MONEY_OUT.has(t.kind)) cur.out += Math.abs(t.amount);
    groups.set(k.key, cur);
  }
  const ordered = [...groups.entries()].sort((a, b) =>
    period
      ? a[0].localeCompare(b[0])
      : b[1].confirmed + b[1].assumed - (a[1].confirmed + a[1].assumed),
  );
  const rows = ordered.map(([, v]) => ({
    group: v.label,
    confirmed: r2(v.confirmed),
    assumed: r2(v.assumed),
    out: r2(v.out),
    net: r2(v.confirmed + v.assumed - v.out),
  }));
  const tot = (k: 'confirmed' | 'assumed' | 'out' | 'net') => r2(sum(rows.map((r) => r[k])));
  const table: ReportTable = {
    id: 'contributions',
    title: `Money put in and taken out, by ${GROUP_LABEL[g].toLowerCase()}`,
    columns: [
      text('group', GROUP_LABEL[g]),
      money('confirmed', 'Put in (confirmed)'),
      money('assumed', 'Put in (assumed from plan)'),
      money('out', 'Taken out'),
      money('net', 'Net put in'),
    ],
    rows,
    total: {
      group: 'Total',
      confirmed: tot('confirmed'),
      assumed: tot('assumed'),
      out: tot('out'),
      net: tot('net'),
    },
    chart: rows.map((r) => ({ label: r.group, value: r.confirmed + r.assumed })),
  };
  let prevNet: number | null | undefined;
  if (q.compare && prev) {
    const p = txnRows(i, { ...q, kind: null, min: null, max: null }, prev);
    prevNet = r2(
      sum(p.filter((x) => MONEY_IN.has(x.t.kind)).map((x) => x.t.amount)) -
        sum(p.filter((x) => MONEY_OUT.has(x.t.kind)).map((x) => Math.abs(x.t.amount))),
    );
  }
  return {
    tables: [table],
    kpis: [
      { label: 'Put in, confirmed', value: tot('confirmed'), kind: 'money' as const },
      { label: 'Put in, assumed from plan', value: tot('assumed'), kind: 'money' as const },
      { label: 'Net put in', value: tot('net'), kind: 'money' as const, previous: prevNet },
    ],
    notes: [
      'Contributions are your own money moving into funds: they are not profit. Instalments assumed from the SIP plan are shown apart until a statement confirms them.',
    ],
    basis: (tot('assumed') > 0 ? 'B' : 'A') as CentreReport['basis'],
  };
}

function realisedRows(i: CentreInput, q: CentreQuery, range: { from: string; to: string }) {
  const out: { f: CentreFund; r: StatRealised }[] = [];
  for (const f of i.funds.filter(fundKeep(i, q)))
    for (const r of f.realised) if (inRange(r.soldOn, range)) out.push({ f, r });
  return out.sort((a, b) => b.r.soldOn.localeCompare(a.r.soldOn));
}
const heldDays = (r: StatRealised) =>
  r.acquiredOn === '1900-01-01'
    ? null
    : Math.round((at(r.soldOn).getTime() - at(r.acquiredOn).getTime()) / 86_400_000);

function realisedReport(i: CentreInput, q: CentreQuery, range: DateRange, prev: DateRange | null) {
  const list = realisedRows(i, q, range);
  const rows: Record<string, Cell>[] = list.map(({ f, r }) => ({
    soldOn: r.soldOn,
    fund: f.name,
    person: i.people[f.ownerId] ?? 'Unknown',
    acquiredOn: r.acquiredOn === '1900-01-01' ? null : r.acquiredOn,
    held: heldDays(r),
    units: r.units,
    proceeds: r2(r.proceeds),
    cost: r.cost === null ? null : r2(r.cost),
    gain: r.cost === null ? null : r2(r.proceeds - r.cost),
  }));
  const known = list.filter((x) => x.r.cost !== null);
  const gain = (l: typeof list) =>
    r2(sum(l.filter((x) => x.r.cost !== null).map((x) => x.r.proceeds - x.r.cost!)));
  const g = q.group ?? 'none';
  const detail: ReportTable = {
    id: 'realised',
    title: 'Gains booked by selling',
    columns: [
      date('soldOn', 'Sold'),
      text('fund', 'Fund'),
      text('person', 'Person'),
      date('acquiredOn', 'Bought'),
      int('held', 'Days held'),
      { key: 'units', label: 'Units', kind: 'int' },
      money('proceeds', 'Proceeds'),
      money('cost', 'Cost (first in, first out)'),
      money('gain', 'Gain booked'),
    ],
    rows,
    total: {
      soldOn: null,
      fund: 'Total',
      proceeds: r2(sum(list.map((x) => x.r.proceeds))),
      cost: r2(sum(known.map((x) => x.r.cost!))),
      gain: gain(list),
    },
  };
  const tables = [detail];
  if (g !== 'none') {
    const period = PERIOD_GROUPS[g];
    const byRow = new Map(rows.map((r, n) => [r, list[n]!]));
    tables.unshift(
      groupRows(
        `realised-by-${g}`,
        `Gains booked by ${GROUP_LABEL[g].toLowerCase()}`,
        rows,
        (row) => {
          const { f, r } = byRow.get(row)!;
          if (period) return periodOf(r.soldOn, period);
          return g === 'fund'
            ? { key: f.id, label: f.name }
            : { key: f.ownerId, label: i.people[f.ownerId] ?? 'Unknown' };
        },
        [money('gain', 'Gain booked'), money('proceeds', 'Proceeds')],
        GROUP_LABEL[g],
        !!period,
      ),
    );
  }
  const unknown = list.length - known.length;
  const notes = [
    'Each sale is matched with the oldest units first, as the tax rules do. The gain here is before tax; short or long term and the tax due are on the Tax page, which applies the rules for each kind of fund.',
  ];
  if (unknown)
    notes.push(
      `${unknown} sale${unknown === 1 ? '’s' : 's’'} purchase is not on the statement: proceeds are shown, the cost and gain are left blank rather than guessed.`,
    );
  return {
    tables,
    kpis: [
      { label: 'Proceeds', value: r2(sum(list.map((x) => x.r.proceeds))), kind: 'money' as const },
      {
        label: 'Gain booked',
        value: gain(list),
        kind: 'money' as const,
        previous: q.compare && prev ? gain(realisedRows(i, q, prev)) : undefined,
      },
      { label: 'Sales', value: list.length, kind: 'int' as const },
    ],
    notes,
    basis: (unknown ? 'B' : 'A') as CentreReport['basis'],
  };
}

function currencyReport(i: CentreInput) {
  const rows = i.fx.map((f) => ({
    currency: f.currency,
    accounts: f.accounts,
    native: r2(f.native),
    rate: f.rate,
    rateDate: f.rateDate,
    inr: r2(f.inr),
    asOf: f.asOf,
  }));
  return {
    tables: [
      {
        id: 'currency',
        title: 'Money held in other currencies',
        columns: [
          text('currency', 'Currency'),
          int('accounts', 'Accounts'),
          money('native', 'In its currency'),
          money('rate', 'Rupees per unit'),
          date('rateDate', 'Rate of'),
          money('inr', 'In rupees'),
          date('asOf', 'Latest balance of'),
        ],
        rows,
        total: { currency: 'Total', inr: r2(sum(i.fx.map((f) => f.inr))) },
      } satisfies ReportTable,
    ],
    kpis: [
      {
        label: 'Foreign cash in rupees',
        value: r2(sum(i.fx.map((f) => f.inr))),
        kind: 'money' as const,
      },
      { label: 'Currencies', value: i.fx.length, kind: 'int' as const },
    ],
    notes: [
      i.fx.length
        ? 'The rupee value is the balance in its own currency times the rate shown, of the date shown. A change of rate changes the rupee value without any money moving.'
        : 'No account is held in another currency.',
    ],
    basis: 'A' as CentreReport['basis'],
  };
}

function receivablesReport(i: CentreInput, q: CentreQuery) {
  const list = i.receivables
    .filter((r) => !r.settled && inAmount(r.outstanding, q) && matchesText(q.q, r.name))
    .sort((a, b) => b.outstanding - a.outstanding);
  return {
    tables: [
      {
        id: 'receivables',
        title: 'Money lent, still owed',
        columns: [
          text('name', 'Owed by'),
          money('outstanding', 'Still owed'),
          date('expectedOn', 'Expected back'),
          int('late', 'Days late'),
        ],
        rows: list.map((r) => ({
          name: r.name,
          outstanding: r2(r.outstanding),
          expectedOn: r.expectedOn,
          late: r.daysOverdue > 0 ? r.daysOverdue : null,
        })),
        total: { name: 'Total', outstanding: r2(sum(list.map((r) => r.outstanding))) },
      } satisfies ReportTable,
    ],
    kpis: [
      {
        label: 'Still owed',
        value: r2(sum(list.map((r) => r.outstanding))),
        kind: 'money' as const,
      },
      {
        label: 'Overdue',
        value: list.filter((r) => r.daysOverdue > 0).length,
        kind: 'int' as const,
      },
    ],
    notes: [
      'Money lent counts in net worth but is never cash or liquid until it is paid back. Gifts are left out.',
    ],
    basis: 'A' as CentreReport['basis'],
  };
}

function goalsReport(i: CentreInput, q: CentreQuery) {
  const list = i.goals.filter((g) => matchesText(q.q, g.name));
  return {
    tables: [
      {
        id: 'goals',
        title: 'Goal funding',
        columns: [
          text('name', 'Goal'),
          money('target', 'Target'),
          date('targetOn', 'By'),
          money('setAside', 'Set aside'),
          { key: 'funded', label: 'Funded', kind: 'pct' },
          text('status', 'Where it stands'),
        ],
        rows: list.map((g) => ({
          name: g.name,
          target: g.target,
          targetOn: g.targetOn,
          setAside: r2(g.setAside),
          funded: g.target && g.target > 0 ? g.setAside / g.target : null,
          status: g.status,
        })),
        total: { name: 'Total', setAside: r2(sum(list.map((g) => g.setAside))) },
      } satisfies ReportTable,
    ],
    kpis: [
      {
        label: 'Set aside for goals',
        value: r2(sum(list.map((g) => g.setAside))),
        kind: 'money' as const,
      },
      { label: 'Goals', value: list.length, kind: 'int' as const },
    ],
    notes: list.some((g) => g.target === null)
      ? ['A goal with no target shows no funded share: set its target on the Goals page.']
      : [],
    basis: 'A' as CentreReport['basis'],
  };
}

function qualityReport(i: CentreInput, q: CentreQuery) {
  const hs = i.holdings.filter((h) => same(h.ownerId, q.owner));
  const rows: Record<string, Cell>[] = [];
  for (const h of hs.filter((x) => x.stale))
    rows.push({
      issue: 'Out of date',
      item: h.name,
      person: i.people[h.ownerId] ?? 'Unknown',
      value: r2(h.value),
      asOf: h.asOf,
    });
  for (const h of hs.filter((x) => x.estimated && !x.stale))
    rows.push({
      issue: 'Estimated',
      item: h.name,
      person: i.people[h.ownerId] ?? 'Unknown',
      value: r2(h.value),
      asOf: h.asOf,
    });
  for (const f of i.funds.filter((x) => same(x.ownerId, q.owner) && x.value > 0 && !x.hasStatement))
    rows.push({
      issue: 'No fund statement',
      item: f.name,
      person: i.people[f.ownerId] ?? 'Unknown',
      value: r2(f.value),
      asOf: null,
    });
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r.issue), (counts.get(String(r.issue)) ?? 0) + 1);
  const summary: ReportTable = {
    id: 'quality-summary',
    title: 'Data quality in one view',
    columns: [text('issue', 'What'), int('n', 'How many')],
    rows: [
      { issue: 'Records out of date', n: counts.get('Out of date') ?? 0 },
      { issue: 'Values that rest on an estimate', n: counts.get('Estimated') ?? 0 },
      { issue: 'Funds with no statement', n: counts.get('No fund statement') ?? 0 },
      { issue: 'Funds with no price source', n: i.quality.fundsNoPrice },
      // left out, not blank, when the count was not loaded
      ...(i.quality.toAnswer === null
        ? []
        : [{ issue: 'Bank statement lines to answer', n: i.quality.toAnswer }]),
    ],
  };
  return {
    tables: [
      summary,
      {
        id: 'quality',
        title: 'Each record to check',
        columns: [
          text('issue', 'Issue'),
          text('item', 'Record'),
          text('person', 'Person'),
          money('value', 'Counted at'),
          date('asOf', 'As of'),
        ],
        rows,
      } satisfies ReportTable,
    ],
    kpis: [
      { label: 'Out of date', value: counts.get('Out of date') ?? 0, kind: 'int' as const },
      { label: 'Estimated', value: counts.get('Estimated') ?? 0, kind: 'int' as const },
      { label: 'Lines to answer', value: i.quality.toAnswer, kind: 'int' as const },
    ],
    notes: [
      'Nothing here is left out of the totals: an out-of-date record counts at its last value and an estimate at its estimate. Fixing these makes every other report more exact.',
    ],
    basis: 'A' as CentreReport['basis'],
  };
}

/** The filters in words, as chips the person can read before trusting the report. */
export function appliedFilters(q: CentreQuery, people: Record<string, string>): string[] {
  const out: string[] = [];
  const t = templateOf(q.template);
  if (q.owner && t.filters.includes('owner')) out.push(`Person: ${people[q.owner] ?? 'unknown'}`);
  if (q.cls && t.filters.includes('cls')) out.push(`Kind: ${CLASS_LABEL[q.cls]}`);
  if (q.bank && t.filters.includes('bank')) out.push(`Bank: ${q.bank}`);
  if (q.currency && t.filters.includes('currency')) out.push(`Currency: ${q.currency}`);
  if (q.amc && t.filters.includes('amc')) out.push(`Fund house: ${q.amc}`);
  if (q.plan && t.filters.includes('plan')) out.push(`Plan: ${PLAN_LABEL[q.plan]}`);
  if (q.option && t.filters.includes('option')) out.push(`Option: ${OPTION_LABEL[q.option]}`);
  if (q.kind && t.filters.includes('kind')) out.push(`Type: ${kindLabel(q.kind)}`);
  const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;
  if (t.filters.includes('amount')) {
    if (q.min !== null && q.min !== undefined && q.max !== null && q.max !== undefined)
      out.push(`Amount: ${inr(q.min)} to ${inr(q.max)}`);
    else if (q.min !== null && q.min !== undefined) out.push(`Amount: at least ${inr(q.min)}`);
    else if (q.max !== null && q.max !== undefined) out.push(`Amount: at most ${inr(q.max)}`);
  }
  if (q.q && t.filters.includes('q')) out.push(`Name contains “${q.q}”`);
  return out;
}

/** Runs a report. A template that lives on its own page returns no tables and a note pointing there. */
export function runReport(i: CentreInput, q: CentreQuery): CentreReport {
  const template = templateOf(q.template);
  const range = template.usesPeriod
    ? resolvePeriod(q.period, i.today, {
        from: q.from,
        to: q.to,
        first: i.first,
        financialQuarters: i.financialQuarters,
      })
    : resolvePeriod('today', i.today);
  const previous =
    template.usesPeriod && q.compare
      ? previousPeriod(range, { financialQuarters: i.financialQuarters })
      : null;
  const base = { template, range, previous, applied: appliedFilters(q, i.people) };
  if (template.link)
    return {
      ...base,
      kpis: [],
      tables: [],
      notes: [`This report has its own page, with its full detail and downloads: ${template.link}`],
      basis: 'A',
    };
  type Body = Pick<CentreReport, 'tables' | 'kpis' | 'notes' | 'basis'>;
  const body: Body = (() => {
    switch (template.key) {
      case 'networth':
        return netWorthReport(i, q, range, previous);
      case 'holdings':
        return holdingsReport(i, q, false);
      case 'cash':
        return holdingsReport(i, q, true);
      case 'deposits':
        return depositsReport(i, q, range, previous, false);
      case 'maturities':
        return depositsReport(i, q, range, previous, true);
      case 'funds':
        return fundsReport(i, q);
      case 'transactions':
        return transactionsReport(i, q, range, previous);
      case 'contributions':
        return contributionsReport(i, q, range, previous);
      case 'realised':
        return realisedReport(i, q, range, previous);
      case 'currency':
        return currencyReport(i);
      case 'receivables':
        return receivablesReport(i, q);
      case 'goals':
        return goalsReport(i, q);
      default:
        return qualityReport(i, q);
    }
  })();
  if (previous && body.kpis.every((k) => k.previous === undefined))
    body.notes.push('This report has no figure to compare with the period before.');
  if (template.usesPeriod && daysIn(range) <= 0) body.notes.push('The period is empty.');
  return { ...base, ...body };
}
