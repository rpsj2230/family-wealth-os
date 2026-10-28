/**
 * The arithmetic behind Home, the page that answers the first questions about the family's money: what is it worth, what changed,
 * how much of that is verified, where is it, how fast can it be reached, what needs attention and what is coming. Pure functions over
 * values the other views already produce (net worth, bank overview, deposits, funds, snapshots), so every figure on Home can be
 * checked against the same figure on its own page. No I/O.
 */
import type { OverviewPart } from './bank-overview';
import { addDays as addIsoDays, type RaiseSource } from './liquidity';
import { fdValueOn, type Compounding } from './fd';
import type { ForeignCash } from './foreign-cash';
import { formatInr, formatInrCompact } from './money';
import { isCounted, type AssetType, type ValuedAsset } from './networth';
import type { AssetStatusLine } from './portfolio';
import { pointsInRange, type Point, type RangeKey } from './snapshot';
import { fyStartOn } from './period-gains';
import { fyBoundsOf, fyOf } from './tax';

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((t(to) - t(from)) / DAY);

// ------------------------------------------------------------------------------------------------
// Change over a period
// ------------------------------------------------------------------------------------------------
export interface Change {
  amount: number;
  /** against the value it started from; null when that was not above zero */
  pct: number | null;
  /** date of the value it is measured from */
  from: string;
  /** the history is shorter than the period, so it is measured from the first value on record */
  partial: boolean;
}

/**
 * Change since `start`: the last value on or before that date is the base. With no value that old, the first value on record is
 * used and the result is marked `partial` so the page can say "since 3 Mar" instead of pretending it is a full period.
 */
export function changeSinceDate(points: Point[], start: string): Change | null {
  if (points.length < 2) return null;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const last = sorted[sorted.length - 1]!;
  const before = [...sorted].reverse().find((p) => p.date <= start);
  const base = before ?? sorted[0]!;
  if (base.date >= last.date) return null;
  return {
    amount: last.value - base.value,
    pct: base.value > 0 ? last.value / base.value - 1 : null,
    from: base.date,
    partial: !before,
  };
}

/** First day of the financial year that `today` falls in (India: 1 April). */
export const fyStartOf = fyStartOn;

export interface NetWorthChanges {
  /** against the value `monthDays` ago */
  month: Change | null;
  /** against the close of the last financial year, or the first value on record when the history starts later */
  fy: Change | null;
  fyStart: string;
}

export function netWorthChanges(trend: Point[], today: string, monthDays: number): NetWorthChanges {
  const fyStart = fyStartOf(today);
  // the close of the previous year is the last value before the new year starts
  const dayBefore = addIsoDays(fyStart, -1);
  return {
    month: changeSinceDate(trend, addIsoDays(today, -monthDays)),
    fy: changeSinceDate(trend, dayBefore),
    fyStart,
  };
}

export const HOME_RANGES: {
  key: Extract<RangeKey, '1M' | '3M' | '6M' | '1Y' | 'ALL'>;
  label: string;
}[] = [
  { key: '1M', label: '1M' },
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: '1Y', label: '1Y' },
  { key: 'ALL', label: 'All' },
];
export type HomeRange = (typeof HOME_RANGES)[number]['key'];
export const DEFAULT_HOME_RANGE: HomeRange = '1Y';

export const parseHomeRange = (v: string | undefined): HomeRange =>
  HOME_RANGES.find((r) => r.key === (v ?? '').toUpperCase())?.key ?? DEFAULT_HOME_RANGE;

export interface RangeView {
  /** the values inside the range, oldest first */
  points: Point[];
  /** first to last value inside the range */
  change: { amount: number; pct: number | null } | null;
  /** the same length of time just before the range, when the history reaches back that far; never for All */
  before: { amount: number; pct: number | null } | null;
  /** the history does not reach the start of the range */
  short: boolean;
}

/** The slice of the history for a range, its change and the change over the equal stretch before it. */
export function rangeView(trend: Point[], range: HomeRange, today: string): RangeView {
  const sorted = [...trend].sort((a, b) => a.date.localeCompare(b.date));
  const points = pointsInRange(sorted, range, today);
  const first = points[0];
  const last = points[points.length - 1];
  const change =
    first && last && points.length >= 2
      ? {
          amount: last.value - first.value,
          pct: first.value > 0 ? last.value / first.value - 1 : null,
        }
      : null;
  if (range === 'ALL') return { points, change, before: null, short: false };
  const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range];
  const shift = (iso: string, m: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - m);
    return d.toISOString().slice(0, 10);
  };
  const start = shift(today, months);
  const earlier = shift(start, months);
  const at = (d: string) => [...sorted].reverse().find((p) => p.date <= d) ?? null;
  const a = at(start);
  const b = at(earlier);
  const before =
    a && b && a.date > b.date
      ? { amount: a.value - b.value, pct: b.value > 0 ? a.value / b.value - 1 : null }
      : null;
  return { points, change, before, short: !a };
}

// ------------------------------------------------------------------------------------------------
// Where the money is
// ------------------------------------------------------------------------------------------------
export type AllocKey =
  'cash' | 'fd' | 'funds' | 'stocks' | 'property' | 'lent' | 'retirement' | 'other';

const ALLOC: { key: AllocKey; label: string; types: AssetType[] }[] = [
  { key: 'cash', label: 'Bank balances', types: ['bank_account'] },
  { key: 'fd', label: 'Fixed deposits', types: ['fixed_deposit'] },
  { key: 'funds', label: 'Mutual funds', types: ['mutual_fund'] },
  { key: 'stocks', label: 'Shares', types: ['stock'] },
  { key: 'property', label: 'Property', types: ['property'] },
  { key: 'lent', label: 'Money lent', types: ['receivable'] },
  { key: 'retirement', label: 'NPS and pension plans', types: ['nps', 'ulip'] },
  {
    key: 'other',
    label: 'Held by others and other',
    types: ['third_party_held', 'other', 'policy'],
  },
];

export const allocKeyOf = (type: string): AllocKey =>
  ALLOC.find((a) => (a.types as string[]).includes(type))?.key ?? 'other';
export const allocLabel = (key: AllocKey): string => ALLOC.find((a) => a.key === key)!.label;

export interface AllocShare {
  key: AllocKey;
  label: string;
  amount: number;
  /** of the total, 0 to 1 */
  share: number;
}

/** Net worth by kind of holding in a fixed order, kinds with nothing left out. Negative amounts are not shown. */
export function allocationOf(byType: Partial<Record<string, number>>): AllocShare[] {
  const sums = new Map<AllocKey, number>();
  for (const [type, v] of Object.entries(byType))
    if (typeof v === 'number' && v > 0)
      sums.set(allocKeyOf(type), (sums.get(allocKeyOf(type)) ?? 0) + v);
  const total = [...sums.values()].reduce((a, b) => a + b, 0);
  return ALLOC.filter((a) => (sums.get(a.key) ?? 0) > 0).map((a) => ({
    key: a.key,
    label: a.label,
    amount: sums.get(a.key)!,
    share: total > 0 ? sums.get(a.key)! / total : 0,
  }));
}

// ------------------------------------------------------------------------------------------------
// How much of the total is verified
// ------------------------------------------------------------------------------------------------
export interface ValueTrust {
  total: number;
  /** a balance or value recorded within its window and confirmed */
  confirmed: number;
  /** worked out from contract terms (a deposit), exact for the date */
  calculated: number;
  /** recorded but not yet confirmed, or older than its window, or never recorded */
  unconfirmed: number;
  /** (confirmed + calculated) / total; 1 when there is nothing to value */
  verifiedShare: number;
  counts: { confirmed: number; calculated: number; unconfirmed: number };
}

/**
 * Splits today's value by how it is known. A holding counts as verified when its last value was recorded within its refresh window
 * and confirmed, or when it is worked out from the contract (a deposit). Imported values not yet confirmed, values older than the
 * window and holdings with no value are the rest. The total equals net worth because the same holdings are counted.
 */
export function valueTrust(
  valued: ValuedAsset[],
  lines: Record<string, Pick<AssetStatusLine, 'freshness'>>,
): ValueTrust {
  const out: ValueTrust = {
    total: 0,
    confirmed: 0,
    calculated: 0,
    unconfirmed: 0,
    verifiedShare: 1,
    counts: { confirmed: 0, calculated: 0, unconfirmed: 0 },
  };
  for (const a of valued) {
    if (!isCounted(a)) continue;
    const v = a.estimate!.estimatedAmount;
    const f = lines[a.assetId]?.freshness ?? 'missing';
    const bucket =
      f === 'current' ? 'confirmed' : f === 'calculated' ? 'calculated' : 'unconfirmed';
    out[bucket] += v;
    out.counts[bucket]++;
    out.total += v;
  }
  out.verifiedShare = out.total > 0 ? (out.confirmed + out.calculated) / out.total : 1;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Money put in and growth
// ------------------------------------------------------------------------------------------------
export interface GrowthPart {
  key: string;
  label: string;
  invested: number;
  current: number;
  /** the cost is not fully known (a fund with no statement): the growth is approximate */
  approximate?: boolean;
}
export interface GrowthSplit {
  invested: number;
  current: number;
  growth: number;
  growthPct: number | null;
  /** share of the current value that was put in, 0 to 1 */
  investedShare: number;
  parts: (GrowthPart & { growth: number })[];
  approximate: boolean;
}

/** What was put in against what it is worth, for the holdings that have a recorded cost (banks, deposits and funds). */
export function growthSplit(parts: GrowthPart[]): GrowthSplit {
  const rows = parts.map((p) => ({ ...p, growth: p.current - p.invested }));
  const invested = rows.reduce((a, r) => a + r.invested, 0);
  const current = rows.reduce((a, r) => a + r.current, 0);
  return {
    invested,
    current,
    growth: current - invested,
    growthPct: invested > 0 ? current / invested - 1 : null,
    investedShare: current > 0 ? Math.min(1, Math.max(0, invested / current)) : 0,
    parts: rows,
    approximate: rows.some((r) => r.approximate),
  };
}

// ------------------------------------------------------------------------------------------------
// What changed
// ------------------------------------------------------------------------------------------------
export interface ShareMove {
  key: string;
  label: string;
  change: number;
}

/**
 * The largest moves between two splits of the same total (by kind of holding or by person), biggest absolute move first. Moves
 * smaller than `minAmount` are left out so noise does not fill the list. Money added or withdrawn is part of a move.
 */
export function moversBetween(
  before: Record<string, number>,
  after: Record<string, number>,
  labelOf: (key: string) => string,
  top = 4,
  minAmount = 1,
): ShareMove[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .map((key) => ({ key, label: labelOf(key), change: (after[key] ?? 0) - (before[key] ?? 0) }))
    .filter((m) => Math.abs(m.change) >= minAmount)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || a.label.localeCompare(b.label))
    .slice(0, top);
}

/** A snapshot's split by asset type, folded into the kinds Home shows. */
export function foldByKind(byType: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [type, v] of Object.entries(byType)) {
    const k = allocKeyOf(type);
    out[k] = (out[k] ?? 0) + Number(v);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// How fast money can be reached
// ------------------------------------------------------------------------------------------------
export interface RaiseWithin {
  days: number;
  date: string;
  /** most that can be in the bank by then, before costs and tax; each holding is counted once */
  amount: number;
  /** holdings that contribute */
  holdings: number;
}

/**
 * How much could be in the bank within each number of days: the same sources the "I need money" planner uses. A holding that can be
 * reached in more than one way (a deposit that matures, or can be broken) is counted once, at the most it can give by that date.
 * Kinds left out of the preference list in Settings are never used, as on the planner. With `free`, only ways that cost nothing count:
 * no sale (no tax, no exit load) and no interest or selling cost lost.
 */
export function raisableWithin(
  sources: RaiseSource[],
  today: string,
  days: number[],
  allowed?: readonly string[],
  free = false,
): RaiseWithin[] {
  return [...new Set(days)]
    .sort((a, b) => a - b)
    .map((d) => {
      const date = addIsoDays(today, d);
      const best = new Map<string, number>();
      for (const s of sources) {
        if (allowed && !allowed.includes(s.kind)) continue;
        if (free && (s.sale || s.fixedCostRate > 0)) continue;
        if (s.availableOn > date) continue;
        best.set(s.assetId, Math.max(best.get(s.assetId) ?? 0, s.max));
      }
      return {
        days: d,
        date,
        amount: [...best.values()].reduce((a, b) => a + b, 0),
        holdings: best.size,
      };
    });
}

// ------------------------------------------------------------------------------------------------
// Interest on deposits
// ------------------------------------------------------------------------------------------------
export interface DepositForInterest {
  principal: number;
  rate: number;
  bookedOn: string;
  maturityOn: string;
  compounding: Compounding;
}
export interface DepositInterest {
  fy: string;
  fyStart: string;
  fyEnd: string;
  /** earned from the start of the financial year (or the day it was booked) to today */
  thisYear: number;
  /** still to be added over the next `ahead` days, to each deposit's maturity at most */
  ahead: number;
  aheadDays: number;
  deposits: number;
}

const accrued = (d: DepositForInterest, on: string) =>
  fdValueOn({
    principal: d.principal,
    annualRate: d.rate,
    bookedOn: new Date(`${d.bookedOn}T00:00:00Z`),
    asOf: new Date(`${on}T00:00:00Z`),
    maturityOn: new Date(`${d.maturityOn}T00:00:00Z`),
    compounding: d.compounding,
  });

/**
 * Interest the running deposits have added this financial year, and what they add over the next `aheadDays` if held to maturity
 * without renewing. Worked out from each deposit's own terms; a deposit that has already paid out is not included.
 */
export function depositInterest(
  deposits: DepositForInterest[],
  today: string,
  aheadDays = 365,
): DepositInterest {
  const fy = fyOf(today);
  const b = fyBoundsOf(fy);
  const fyStart = b?.from ?? `${today.slice(0, 4)}-04-01`;
  const fyEnd = b?.to ?? `${Number(today.slice(0, 4)) + 1}-03-31`;
  const horizon = addIsoDays(today, aheadDays);
  let thisYear = 0;
  let ahead = 0;
  for (const d of deposits) {
    if (!(d.principal > 0)) continue;
    const from = d.bookedOn > fyStart ? d.bookedOn : fyStart;
    if (from <= today) thisYear += Math.max(0, accrued(d, today) - accrued(d, from));
    if (d.maturityOn > today) ahead += Math.max(0, accrued(d, horizon) - accrued(d, today));
  }
  return { fy, fyStart, fyEnd, thisYear, ahead, aheadDays, deposits: deposits.length };
}

// ------------------------------------------------------------------------------------------------
// The four kinds of holding, side by side
// ------------------------------------------------------------------------------------------------
export type ClassKey = 'fd' | 'funds' | 'cash' | 'others';

export interface ClassCard {
  key: ClassKey;
  label: string;
  /** holdings counted: deposits, funds, accounts; for Others only the holdings kept by hand are counted */
  count: number;
  /** the money put in: deposit principal, cost of the units still held, the last balance recorded, the amount recorded */
  invested: number;
  /** worth today */
  current: number;
  /** worth at maturity: what deposits pay on their dates; everything else at today's value */
  maturity: number;
  /** current less invested, and as a share of invested (null when nothing is invested) */
  profit: number;
  profitPct: number | null;
  /** earned since the first record, counting interest already paid out and units already sold; null before anything is held */
  earned: number | null;
  /** what it earned in the last day (an estimate; zero for Others) */
  today: number;
  /** of net worth, 0 to 1 */
  share: number;
  /** the profit rests on an estimate: a rate, a plan, an instalment assumed */
  estimated: boolean;
  /** deposits past their date waiting to be confirmed: not counted anywhere (their money is in a savings account or a new deposit), listed for the note */
  awaiting: { count: number; invested: number; current: number } | null;
  /**
   * Cash only: the part of `current` held in another currency, one entry per currency, biggest in rupees first. The card's main
   * figure stays the rupee total of all cash; this says how much of it is in each currency. Empty for every other card.
   */
  foreign: ForeignCash[];
}

export interface ClassCardsInput {
  netWorth: number;
  /** the deposits as Deposits counts them */
  fd: OverviewPart;
  /** their earnings in the last day */
  fdToday: number;
  /** deposits past their date that are still listed as running: in no total, waiting to be confirmed */
  awaiting: { count: number; invested: number; current: number };
  /** savings and cash in banks as Cash counts them, and what they earned in the last day */
  cash: OverviewPart;
  cashToday: number;
  /** the foreign-currency part of that cash (bankOverview().foreign); none when all cash is in rupees */
  cashForeign?: ForeignCash[];
  /** money held by others and balances with no bank, as Accounts counts them under Other holdings */
  othersHeld: OverviewPart;
  /** the funds as Investments counts them; null when none is held */
  funds: {
    count: number;
    invested: number;
    value: number;
    today: number;
    /** funds with no statement: their cost is the amount entered, so the profit is approximate */
    withoutStatement: number;
  } | null;
  /** earned since the start, by kind (from period-gains) */
  earned: Partial<Record<ClassKey, number | null>>;
}

const CLASS_LABEL: Record<ClassKey, string> = {
  fd: 'Fixed deposits',
  funds: 'Mutual funds',
  cash: 'Cash',
  others: 'Others',
};
const CLASS_HREF: Record<ClassKey, string> = {
  fd: '/deposits',
  funds: '/investments',
  cash: '/cash',
  others: '/others',
};
export const classLabel = (k: ClassKey) => CLASS_LABEL[k];
export const classHref = (k: ClassKey) => CLASS_HREF[k];

/**
 * The four cards under the headline: deposits, funds, cash and the rest. Together they are net worth exactly: what the other three
 * hold is taken off the total and the remainder is Others (shares, property, money lent, held by others, pension accounts and any
 * other counted asset), so a holding is never counted twice or missed. The deposits and cash are the figures of Deposits and Cash;
 * the funds are those of Investments. Others has no cost to compare with: its profit is the difference between what is recorded
 * and what is counted today, which is nothing unless a recorded value has been moved on.
 */
export function classCards(i: ClassCardsInput): ClassCard[] {
  // a deposit past its date is not counted: its money went into a savings account or another deposit, counted on their own
  const fd = {
    count: i.fd.count,
    invested: i.fd.invested,
    current: i.fd.current,
    maturity: i.fd.maturity,
  };
  const funds = i.funds
    ? { count: i.funds.count, invested: i.funds.invested, current: i.funds.value }
    : { count: 0, invested: 0, current: 0 };
  const cash = { count: i.cash.count, invested: i.cash.invested, current: i.cash.current };
  const restCurrent = i.netWorth - fd.current - funds.current - cash.current;
  // what is recorded for the holdings kept by hand, plus the other kinds at the value counted
  const others = {
    count: i.othersHeld.count,
    current: restCurrent,
    invested: restCurrent - (i.othersHeld.current - i.othersHeld.invested),
  };
  const make = (
    key: ClassKey,
    v: { count: number; invested: number; current: number },
    maturity: number,
    today: number,
    estimated: boolean,
    awaiting: ClassCard['awaiting'] = null,
    foreign: ForeignCash[] = [],
  ): ClassCard => ({
    key,
    label: CLASS_LABEL[key],
    count: v.count,
    invested: v.invested,
    current: v.current,
    maturity,
    profit: v.current - v.invested,
    profitPct: v.invested > 0 ? v.current / v.invested - 1 : null,
    earned: i.earned[key] ?? null,
    today,
    share: i.netWorth > 0 ? v.current / i.netWorth : 0,
    estimated,
    awaiting,
    foreign,
  });
  return [
    make('fd', fd, fd.maturity, i.fdToday, false, i.awaiting.count > 0 ? i.awaiting : null),
    make(
      'funds',
      funds,
      funds.current,
      i.funds?.today ?? 0,
      !!i.funds && i.funds.withoutStatement > 0,
    ),
    make('cash', cash, cash.current, i.cashToday, cash.count > 0, null, i.cashForeign ?? []),
    make('others', others, others.current, 0, false),
  ];
}

// ------------------------------------------------------------------------------------------------
// Invested money and the profit on it
// ------------------------------------------------------------------------------------------------
export interface InvestedMoney {
  /** the money put into deposits (their principal) and funds (the cost of the units still held) */
  invested: number;
  /** what those deposits and funds are worth above it: interest accrued on deposits plus the gain on the fund units held */
  profit: number;
  /** the profit as a share of the money invested, at cost; null when nothing is invested */
  profitPct: number | null;
  /** what the invested money is worth now */
  valueOfInvested: number;
  parts: {
    fd: { invested: number; current: number; profit: number };
    funds: { invested: number; current: number; profit: number };
    /** the part of net worth that is not invested money: savings and cash, shares, property, pension accounts, money lent */
    notInvested: number;
  };
  /** the profit of deposits or funds rests on an estimate */
  estimated: boolean;
}

/**
 * Total invested and the profit on it, for Home and the daily summary alike. Invested money is deposits and funds: savings and cash
 * balances, shares, property and money lent are in net worth but have no cost to earn a profit on, so they are not "invested" and
 * are not in the profit. The per cent is of the money invested, at cost.
 */
export function investedMoney(classes: ClassCard[], netWorth: number): InvestedMoney {
  const fd = classes.find((c) => c.key === 'fd');
  const funds = classes.find((c) => c.key === 'funds');
  const part = (c: ClassCard | undefined) => ({
    invested: c?.invested ?? 0,
    current: c?.current ?? 0,
    profit: c?.profit ?? 0,
  });
  const a = part(fd);
  const b = part(funds);
  const invested = a.invested + b.invested;
  const profit = a.profit + b.profit;
  return {
    invested,
    profit,
    profitPct: invested > 0 ? profit / invested : null,
    valueOfInvested: a.current + b.current,
    parts: { fd: a, funds: b, notInvested: netWorth - a.current - b.current },
    estimated: [fd, funds].some((c) => !!c && c.estimated && c.profit !== 0),
  };
}

// ------------------------------------------------------------------------------------------------
// Best and weakest fund
// ------------------------------------------------------------------------------------------------
export interface FundReturn {
  assetId: string;
  name: string;
  /** annual return since the start; null when it cannot be worked out */
  xirr: number | null;
  /** worked out from a plan, not a statement */
  estimated: boolean;
}

/** The fund with the highest and the lowest annual return. Needs two funds with a return; otherwise there is nothing to compare. */
export function bestAndWeakest(
  funds: FundReturn[],
): { best: FundReturn; weakest: FundReturn } | null {
  const ranked = funds
    .filter((f) => f.xirr !== null && Number.isFinite(f.xirr))
    .sort((a, b) => (b.xirr as number) - (a.xirr as number) || a.name.localeCompare(b.name));
  if (ranked.length < 2) return null;
  return { best: ranked[0]!, weakest: ranked[ranked.length - 1]! };
}

// ------------------------------------------------------------------------------------------------
// What needs attention
// ------------------------------------------------------------------------------------------------
export interface AttentionItem {
  key: string;
  tone: 'bad' | 'warn' | 'info';
  text: string;
  href: string;
  /** how many things the line stands for */
  count: number;
}

export interface AttentionInput {
  today: string;
  /** matured deposits waiting to be confirmed */
  toConfirm: { count: number; amount: number };
  overdueLoans: { name: string; outstanding: number; daysOverdue: number }[];
  /** deposits that mature within `days` */
  maturingSoon: { count: number; amount: number; days: number };
  /** balances older than their window or never recorded */
  staleBalances: number;
  /** holdings with no value at all */
  noValue: number;
  /** money above the deposit insurance limit */
  uninsured: { amount: number; banks: number; limit: number };
  /** bank e-mails waiting for a decision */
  inboxReview: number;
  tasks: { title: string; dueOn: string }[];
  taskDays: number;
  policies: { insurer: string; kind: 'renewal' | 'ends'; on: string }[];
  policyDays: number;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Everything that needs a person, most urgent first: things already late, then things with a date coming, then housekeeping. One line
 * per kind of thing with its count, each with the page where it is dealt with. A kind with nothing to do is left out.
 */
export function attentionItems(i: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (i.toConfirm.count > 0)
    out.push({
      key: 'confirm',
      tone: 'bad',
      count: i.toConfirm.count,
      text: `${plural(i.toConfirm.count, 'matured deposit')} (${formatInrCompact(i.toConfirm.amount)}) to confirm: say where the money went.`,
      href: '/deposits?tab=maturities',
    });
  for (const l of i.overdueLoans.slice(0, 3))
    out.push({
      key: `loan-${l.name}`,
      tone: 'bad',
      count: 1,
      text: `${l.name} owes ${formatInr(l.outstanding)}, ${plural(l.daysOverdue, 'day')} overdue.`,
      href: '/others',
    });
  const overdue = i.tasks.filter((x) => x.dueOn < i.today);
  if (overdue.length > 0)
    out.push({
      key: 'tasks-late',
      tone: 'bad',
      count: overdue.length,
      text: `${plural(overdue.length, 'task')} overdue.`,
      href: '/tasks',
    });
  const lapsed = i.policies.filter((p) => p.on < i.today);
  if (lapsed.length > 0)
    out.push({
      key: 'policy-late',
      tone: 'bad',
      count: lapsed.length,
      text:
        lapsed.length === 1
          ? `${lapsed[0]!.insurer} policy date has passed: confirm it was renewed and update the date.`
          : `${plural(lapsed.length, 'policy date')} passed: confirm each was renewed and update the dates.`,
      href: '/others?tab=policies',
    });
  if (i.maturingSoon.count > 0)
    out.push({
      key: 'maturing',
      tone: 'warn',
      count: i.maturingSoon.count,
      text: `${plural(i.maturingSoon.count, 'deposit')} (${formatInrCompact(i.maturingSoon.amount)}) mature within ${plural(i.maturingSoon.days, 'day')}: decide where the money goes.`,
      href: '/deposits?tab=maturities',
    });
  const dueSoon = i.tasks.filter(
    (x) => x.dueOn >= i.today && daysBetween(i.today, x.dueOn) <= i.taskDays,
  );
  if (dueSoon.length > 0)
    out.push({
      key: 'tasks-soon',
      tone: 'warn',
      count: dueSoon.length,
      text: `${plural(dueSoon.length, 'task')} due in the next ${plural(i.taskDays, 'day')}.`,
      href: '/tasks',
    });
  const policySoon = i.policies.filter(
    (p) => p.on >= i.today && daysBetween(i.today, p.on) <= i.policyDays,
  );
  if (policySoon.length > 0)
    out.push({
      key: 'policy-soon',
      tone: 'warn',
      count: policySoon.length,
      text:
        policySoon.length === 1
          ? `${policySoon[0]!.insurer} policy ${policySoon[0]!.kind === 'renewal' ? 'renews' : 'ends'} in ${plural(daysBetween(i.today, policySoon[0]!.on), 'day')}.`
          : `${plural(policySoon.length, 'policy date')} in the next ${plural(i.policyDays, 'day')}.`,
      href: '/others?tab=policies',
    });
  if (i.uninsured.amount > 0)
    out.push({
      key: 'cover',
      tone: 'warn',
      count: i.uninsured.banks,
      text: `${formatInrCompact(i.uninsured.amount)} is above the ${formatInrCompact(i.uninsured.limit)} deposit-insurance limit, in ${plural(i.uninsured.banks, 'bank')}.`,
      href: '/deposits?tab=cover',
    });
  if (i.inboxReview > 0)
    out.push({
      key: 'inbox',
      tone: 'warn',
      count: i.inboxReview,
      text: `${plural(i.inboxReview, 'bank e-mail')} waiting for you to choose the account.`,
      href: '/inbox',
    });
  if (i.staleBalances > 0)
    out.push({
      key: 'stale',
      tone: 'warn',
      count: i.staleBalances,
      text: `${plural(i.staleBalances, 'balance')} out of date.`,
      href: '/monthly',
    });
  if (i.noValue > 0)
    out.push({
      key: 'novalue',
      tone: 'info',
      count: i.noValue,
      text: `${plural(i.noValue, 'holding')} with no value recorded yet.`,
      href: '/monthly',
    });
  return out;
}

// ------------------------------------------------------------------------------------------------
// Concentration
// ------------------------------------------------------------------------------------------------
/** The largest share among named amounts: who or what it is, how much, and the share of the whole. Null for an empty split. */
export function largestShare<T extends { amount: number }>(
  rows: T[],
): { row: T; share: number } | null {
  const total = rows.reduce((a, r) => a + Math.max(0, r.amount), 0);
  if (total <= 0) return null;
  const row = [...rows].sort((a, b) => b.amount - a.amount)[0]!;
  return { row, share: row.amount / total };
}
