/**
 * Mutual funds over time, as numbers ready to draw: the time ranges, the part of a series inside a range, the change over a range,
 * the return and the annual return (XIRR) month by month, money put in per month, the SIP calendar, the price line with purchase
 * dots, and units over time. Pure: the caller supplies what is stored. Nothing here invents a number: where the data to work
 * something out is missing, the result says so (null, or a `basis` that names what it rests on).
 */
import { addDaysIso, addMonthsIso } from './harvest-lots';
import { monthEnds, type SeriesPoint } from './fund-series';
import { xirr } from './xirr';

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

// ------------------------------------------------------------------------------------------------
// Time ranges
// ------------------------------------------------------------------------------------------------
export type FundRangeKey = '1m' | '6m' | '1y' | '3y' | 'all';

export interface FundRangeDef {
  key: FundRangeKey;
  label: string;
  /** months back from today; null = from the beginning */
  months: number | null;
}

/** The choices of the range switch. */
export const FUND_RANGES: FundRangeDef[] = [
  { key: '1m', label: '1M', months: 1 },
  { key: '6m', label: '6M', months: 6 },
  { key: '1y', label: '1Y', months: 12 },
  { key: '3y', label: '3Y', months: 36 },
  { key: 'all', label: 'All', months: null },
];

export const FUND_RANGE_WORDS: Record<FundRangeKey, string> = {
  '1m': 'the last month',
  '6m': 'the last 6 months',
  '1y': 'the last year',
  '3y': 'the last 3 years',
  all: 'the whole history',
};

export function parseRange(
  v: string | null | undefined,
  fallback: FundRangeKey = 'all',
): FundRangeKey {
  return FUND_RANGES.some((r) => r.key === v) ? (v as FundRangeKey) : fallback;
}

/** The first day of a range, or null for "All". */
export function rangeStart(range: FundRangeKey, today: string): string | null {
  const m = FUND_RANGES.find((r) => r.key === range)?.months ?? null;
  return m === null ? null : addMonthsIso(today, -m);
}

/**
 * The days a chart draws for a range: every day for a month, every week up to a year, month ends beyond that. Short ranges
 * would otherwise show two or three points.
 */
export function chartDates(range: FundRangeKey, from: string, today: string): string[] {
  const start = rangeStart(range, today);
  if (range === 'all' || range === '3y') {
    const all = monthEnds(start && start > from ? start : from, today);
    return all;
  }
  const first = start ?? from;
  const step = range === '1m' ? 1 : 7;
  const out: string[] = [];
  for (let d = today; d >= first; d = addDaysIso(d, -step)) out.push(d);
  return out.reverse();
}

export interface Clipped<T> {
  points: T[];
  /** the series begins after the range does: the chart covers less than the range asked for */
  startsLate: boolean;
}

/** The points inside a range, plus the last one before it so a line starts at the edge. */
export function clipSeries<T extends { date: string }>(
  points: T[],
  range: FundRangeKey,
  today: string,
): Clipped<T> {
  const from = rangeStart(range, today);
  if (from === null || points.length === 0) return { points, startsLate: false };
  const inside = points.filter((p) => p.date >= from);
  const before = [...points].reverse().find((p) => p.date < from);
  return {
    points: before ? [before, ...inside] : inside,
    startsLate: !before && points[0]!.date > from,
  };
}

export interface PeriodChange {
  from: string;
  to: string;
  startValue: number;
  endValue: number;
  /** the part of the change that is new money put in less money taken out; null when the money put in is not known */
  netIn: number | null;
  /** what the market added or took: the change in value less the net new money; null when netIn is not known */
  gain: number | null;
  /** gain on the average money at work (modified Dietz: new money counted at half), null when it cannot be worked out */
  returnPct: number | null;
}

/** What happened between the first and last point of a (clipped) series. */
export function periodChange(points: SeriesPoint[]): PeriodChange | null {
  if (points.length < 2) return null;
  const a = points[0]!;
  const b = points[points.length - 1]!;
  const known = a.invested !== null && b.invested !== null;
  const netIn = known ? b.invested! - a.invested! : null;
  const gain = netIn === null ? null : b.value - a.value - netIn;
  const base = netIn === null ? 0 : a.value + netIn / 2;
  return {
    from: a.date,
    to: b.date,
    startValue: a.value,
    endValue: b.value,
    netIn,
    gain,
    returnPct: gain !== null && base > 0 ? gain / base : null,
  };
}

// ------------------------------------------------------------------------------------------------
// Return over time
// ------------------------------------------------------------------------------------------------
export interface ValuePoint {
  date: string;
  value: number;
}

/** Gain as a share of the money put in, at every point where the money put in is known and positive. */
export function returnSeries(points: SeriesPoint[]): ValuePoint[] {
  return points
    .filter((p) => p.invested !== null && p.invested > 0)
    .map((p) => ({ date: p.date, value: (p.value - p.invested!) / p.invested! }));
}

export interface FlowTxn {
  date: string;
  units: number;
  amount: number;
}

const lastAtOrBefore = <T extends { date: string }>(list: T[], d: string): T | null => {
  let best: T | null = null;
  for (const x of list) {
    if (x.date > d) break;
    best = x;
  }
  return best;
};

/**
 * The annual return (XIRR) as it stood at each date, from the real transactions up to that date and the value on that date.
 * Only funds with transactions count. A date is skipped when money has been in for less than `minMonths` (an annual figure for a
 * few weeks is noise) or when the figure cannot be solved.
 */
export function xirrOverTime(args: {
  funds: { txns: FlowTxn[]; series: ValuePoint[] }[];
  dates: string[];
  minMonths: number;
}): ValuePoint[] {
  const withTxns = args.funds.filter((f) => f.txns.length > 0);
  if (withTxns.length === 0) return [];
  const first = withTxns
    .flatMap((f) => f.txns.map((x) => x.date))
    .reduce((m, d) => (d < m ? d : m), '9999-12-31');
  const out: ValuePoint[] = [];
  for (const d of args.dates) {
    if (addMonthsIso(first, args.minMonths) > d) continue;
    const flows = withTxns.flatMap((f) =>
      f.txns
        .filter((x) => x.date <= d && x.units !== 0 && x.amount !== 0)
        .map((x) => ({
          date: new Date(`${x.date}T00:00:00Z`),
          amount: x.units > 0 ? -Math.abs(x.amount) : Math.abs(x.amount),
        })),
    );
    const terminal = withTxns.reduce((a, f) => a + (lastAtOrBefore(f.series, d)?.value ?? 0), 0);
    if (terminal > 0) flows.push({ date: new Date(`${d}T00:00:00Z`), amount: terminal });
    const r = xirr(flows);
    if (r.rate !== null && (r.status === 'ok' || r.status === 'ok_multiple_roots'))
      out.push({ date: d, value: r.rate });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Money put in, by month
// ------------------------------------------------------------------------------------------------
export interface StatTxn {
  date: string;
  kind: string;
  units: number;
  amount: number;
  /** the price per unit on the statement, when it gives one */
  nav?: number | null;
  /** units held after this transaction, when the statement gives it */
  balance?: number | null;
}

export interface MonthContribution {
  /** YYYY-MM */
  month: string;
  /** monthly instalments */
  sip: number;
  /** one-off purchases */
  lump: number;
  /** units moved in from another fund or bought with a dividend */
  moved: number;
  /** sales and units moved out, as a positive amount */
  out: number;
}

const MOVED_KINDS = new Set(['switch_in', 'dividend_reinvest']);

/** The months from `months - 1` before the month of `today` up to it, each with what went in (by kind) and what came out. */
export function monthlyContributions(
  txns: StatTxn[],
  today: string,
  months: number,
): MonthContribution[] {
  const list: MonthContribution[] = [];
  let cur = today.slice(0, 7);
  for (let i = 0; i < months; i++) {
    list.unshift({ month: cur, sip: 0, lump: 0, moved: 0, out: 0 });
    cur = addMonthsIso(`${cur}-01`, -1).slice(0, 7);
  }
  const at = new Map(list.map((m) => [m.month, m]));
  for (const x of txns) {
    const m = at.get(x.date.slice(0, 7));
    if (!m || x.units === 0 || x.amount === 0) continue;
    const a = Math.abs(x.amount);
    if (x.units < 0) m.out += a;
    else if (x.kind === 'sip') m.sip += a;
    else if (MOVED_KINDS.has(x.kind)) m.moved += a;
    else m.lump += a;
  }
  return list;
}

// ------------------------------------------------------------------------------------------------
// SIP
// ------------------------------------------------------------------------------------------------
export interface SipInput {
  txns: StatTxn[];
  sipMonthly: number | null;
  sipStopped: boolean;
  startedOn: string | null;
  today: string;
}

export interface SipSummary {
  /** a monthly investment is set and running */
  active: boolean;
  stopped: boolean;
  monthly: number | null;
  /** the first and the latest instalment on the fund statement (the start date when there is no statement) */
  firstOn: string | null;
  lastOn: string | null;
  /** whole months from the first instalment to today (to the last instalment when stopped) */
  monthsRunning: number | null;
  /** instalments counted on the statement; null without a statement */
  instalments: number | null;
  /** rupees paid in instalments on the statement; null without a statement */
  totalPaid: number | null;
  /** the next instalment date, from the day of the month the instalments fall on; null when stopped or unknown */
  nextOn: string | null;
  basis: 'statement' | 'plan' | 'none';
}

const monthsBetween = (from: string, to: string) => {
  let m =
    (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 +
    (Number(to.slice(5, 7)) - Number(from.slice(5, 7)));
  if (to.slice(8, 10) < from.slice(8, 10)) m -= 1;
  return Math.max(0, m);
};

export function sipSummary(i: SipInput): SipSummary {
  const sips = i.txns
    .filter((x) => x.kind === 'sip' && x.units > 0 && x.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const hasPlan = !!(i.sipMonthly && i.sipMonthly > 0);
  const active = hasPlan && !i.sipStopped;
  const basis = sips.length > 0 ? 'statement' : hasPlan ? 'plan' : 'none';
  const firstOn = sips[0]?.date ?? (hasPlan ? i.startedOn : null);
  const lastOn = sips[sips.length - 1]?.date ?? null;
  const end = active ? i.today : (lastOn ?? i.today);
  let nextOn: string | null = null;
  const anchor = lastOn ?? i.startedOn;
  if (active && anchor) {
    let m = monthsBetween(anchor, i.today);
    let cand = addMonthsIso(anchor, m);
    while (cand < i.today && m < 1200) cand = addMonthsIso(anchor, ++m);
    nextOn = cand;
  }
  return {
    active,
    stopped: hasPlan && i.sipStopped,
    monthly: hasPlan ? i.sipMonthly : null,
    firstOn,
    lastOn,
    monthsRunning: firstOn && firstOn <= end ? monthsBetween(firstOn, end) : null,
    instalments: sips.length > 0 ? sips.length : null,
    totalPaid:
      sips.length > 0 ? Math.round(sips.reduce((a, x) => a + Math.abs(x.amount), 0)) : null,
    nextOn,
    basis,
  };
}

export type CalendarState =
  | 'paid' // an instalment is on the statement
  | 'missed' // the SIP was running but no instalment is on the statement
  | 'pending' // this month, not yet due or not yet seen
  | 'lump' // only a one-off purchase that month
  | 'planned' // expected from the SIP plan; there is no statement to confirm it
  | 'idle'; // no SIP in this month

export interface CalendarCell {
  month: string;
  state: CalendarState;
  amount: number;
  count: number;
}

export interface SipCalendar {
  cells: CalendarCell[];
  basis: SipSummary['basis'];
  paid: number;
  missed: number;
}

/** One cell per month for the last `months` months: was an instalment made? Marked "planned" when only the plan is known. */
export function sipCalendar(i: SipInput, months: number): SipCalendar {
  const sum = sipSummary(i);
  const cells: CalendarCell[] = [];
  let cur = i.today.slice(0, 7);
  for (let k = 0; k < months; k++) {
    cells.unshift({ month: cur, state: 'idle', amount: 0, count: 0 });
    cur = addMonthsIso(`${cur}-01`, -1).slice(0, 7);
  }
  const at = new Map(cells.map((c) => [c.month, c]));
  for (const x of i.txns) {
    const c = at.get(x.date.slice(0, 7));
    if (!c || x.units <= 0 || x.amount === 0) continue;
    if (x.kind === 'sip') {
      c.state = 'paid';
      c.amount += Math.abs(x.amount);
      c.count += 1;
    } else if (c.state !== 'paid' && x.kind !== 'bonus' && !MOVED_KINDS.has(x.kind)) {
      c.state = 'lump';
      c.amount += Math.abs(x.amount);
      c.count += 1;
    }
  }
  const thisMonth = i.today.slice(0, 7);
  const firstMonth = sum.firstOn?.slice(0, 7) ?? null;
  const lastMonth = sum.active ? thisMonth : (sum.lastOn?.slice(0, 7) ?? null);
  for (const c of cells) {
    if (c.state === 'paid' || c.state === 'lump') continue;
    if (!firstMonth || !lastMonth || c.month < firstMonth || c.month > lastMonth) continue;
    if (sum.basis === 'plan') c.state = 'planned';
    else if (sum.basis === 'statement' && sum.active)
      c.state = c.month === thisMonth ? 'pending' : 'missed';
  }
  // a month that has a one-off purchase but sits inside the SIP's life is still a missed instalment
  for (const c of cells)
    if (
      c.state === 'lump' &&
      sum.basis === 'statement' &&
      sum.active &&
      firstMonth &&
      c.month >= firstMonth &&
      c.month < thisMonth
    )
      c.state = 'missed';
  return {
    cells,
    basis: sum.basis,
    paid: cells.filter((c) => c.state === 'paid').length,
    missed: cells.filter((c) => c.state === 'missed').length,
  };
}

// ------------------------------------------------------------------------------------------------
// Price line and units
// ------------------------------------------------------------------------------------------------
export interface NavPoint {
  date: string;
  nav: number;
}

export interface Dot {
  date: string;
  /** the price paid or received per unit */
  nav: number;
  amount: number;
  units: number;
  kind: string;
}

/** Keeps at most `max` points, always the first and last, taking evenly spaced ones in between. */
export function downsample<T>(points: T[], max: number): T[] {
  if (points.length <= max || max < 3) return points;
  const out: T[] = [];
  for (let k = 0; k < max; k++)
    out.push(points[Math.round((k * (points.length - 1)) / (max - 1))]!);
  return out;
}

export interface NavChartModel {
  line: NavPoint[];
  buys: Dot[];
  sells: Dot[];
  /** weighted average price paid per unit still held; null when it cannot be worked out */
  avgCost: number | null;
  latest: NavPoint | null;
}

/**
 * The price line with a dot for every purchase and sale in view and the average cost line. A dot sits at the price paid on the
 * statement (or the line's price that day when the statement gives none), so a purchase above the line shows what it cost.
 */
export function navChart(args: {
  navs: NavPoint[];
  txns: StatTxn[];
  avgCost: number | null;
  from: string | null;
  maxPoints: number;
}): NavChartModel {
  const inView = args.navs.filter((n) => args.from === null || n.date >= args.from);
  const buys: Dot[] = [];
  const sells: Dot[] = [];
  for (const x of args.txns) {
    if (x.units === 0 || x.amount === 0 || (args.from !== null && x.date < args.from)) continue;
    const price = x.nav && x.nav > 0 ? x.nav : (lastAtOrBefore(args.navs, x.date)?.nav ?? null);
    if (price === null) continue;
    (x.units > 0 ? buys : sells).push({
      date: x.date,
      nav: price,
      amount: Math.abs(x.amount),
      units: Math.abs(x.units),
      kind: x.kind,
    });
  }
  return {
    line: downsample(inView, args.maxPoints),
    buys,
    sells,
    avgCost: args.avgCost,
    latest: args.navs[args.navs.length - 1] ?? null,
  };
}

/** Units held after each transaction (taken from the statement's own balance when it gives one, otherwise added up). */
export function unitsOverTime(
  txns: { date: string; units: number; balance?: number | null }[],
): ValuePoint[] {
  const sorted = [...txns].sort((a, b) => a.date.localeCompare(b.date));
  const out: ValuePoint[] = [];
  let run = 0;
  const first = sorted[0];
  if (first && typeof first.balance === 'number') run = Math.max(0, first.balance - first.units);
  for (const x of sorted) {
    run = typeof x.balance === 'number' ? x.balance : Math.max(0, run + x.units);
    if (out.length > 0 && out[out.length - 1]!.date === x.date) out[out.length - 1]!.value = run;
    else out.push({ date: x.date, value: run });
  }
  return out;
}

/** Whole days between two dates. */
export const daysBetweenIso = (from: string, to: string) => Math.round((t(to) - t(from)) / DAY);
