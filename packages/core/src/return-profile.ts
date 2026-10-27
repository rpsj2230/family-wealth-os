/**
 * How an investment performed over time, from a single "index" line: a fund's price (NAV) is one, and the portfolio's time-weighted
 * index (built from its values and its cash flows) is another. Everything here is pure and works on any such line:
 *
 *  - trailing returns over fixed periods (under a year: plain change; a year or more: per year, the convention of the fund houses),
 *  - calendar-year and financial-year (April to March) returns,
 *  - month-by-month returns with a yearly total (the heat map),
 *  - best and worst month and year,
 *  - the fall from the highest point (drawdown),
 *  - rolling returns (what a person would have earned over every possible holding window),
 *  - volatility, Sharpe and Sortino ratios from monthly returns.
 *
 * Money-weighted versus time-weighted: the portfolio index is time-weighted (it removes the effect of when money went in), so it
 * measures how the funds did; XIRR is money-weighted and measures what the person earned, given when they put money in.
 * A figure that the history cannot support is null; nothing is invented.
 */
import { addDaysIso, addMonthsIso } from './harvest-lots';
import { fyStartOn } from './period-gains';
import { fyOf } from './tax';

export interface IndexPoint {
  date: string;
  value: number;
}

/** A cash flow of the person: positive for money put in (purchases), negative for money taken out (sales). */
export interface Flow {
  date: string;
  amount: number;
}

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

// ------------------------------------------------------------------------------------------------
// From values and cash flows to a time-weighted index
// ------------------------------------------------------------------------------------------------
export interface PerfPeriod {
  from: string;
  to: string;
  startValue: number;
  endValue: number;
  /** money put in less money taken out, inside the period */
  flow: number;
  /** what the market added: end value less start value less the net flow */
  gain: number;
  /** the money at work: the start value plus each flow for the part of the period it was in */
  base: number;
  /** gain on the money at work (the Modified Dietz return); null when no money was at work */
  ret: number | null;
}

/**
 * Cuts the history into the periods between consecutive dated values and works out each one's return, counting every cash flow for
 * the fraction of the period it was invested (Modified Dietz). Chaining these periods gives the time-weighted return.
 * Money put in before the first value starts the history from nothing, on the day before the first flow.
 */
export function chainPeriods(
  points: IndexPoint[],
  flows: Flow[],
  /** sorted-by-date flows are not required */
): PerfPeriod[] {
  const pts = [...points]
    .filter((p) => Number.isFinite(p.value))
    .sort((a, b) => a.date.localeCompare(b.date));
  const fl = flows.filter((f) => f.amount !== 0 && Number.isFinite(f.amount));
  if (pts.length === 0) return [];
  const firstFlow = fl.map((f) => f.date).sort()[0];
  const series: IndexPoint[] =
    firstFlow !== undefined && firstFlow <= pts[0]!.date
      ? [{ date: addDaysIso(firstFlow, -1), value: 0 }, ...pts]
      : pts;
  const out: PerfPeriod[] = [];
  for (let i = 1; i < series.length; i++) {
    const a = series[i - 1]!;
    const b = series[i]!;
    if (b.date <= a.date) continue;
    const span = daysBetween(a.date, b.date);
    let flow = 0;
    let weighted = 0;
    for (const f of fl) {
      if (f.date <= a.date || f.date > b.date) continue;
      flow += f.amount;
      weighted += (f.amount * daysBetween(f.date, b.date)) / span;
    }
    const gain = b.value - a.value - flow;
    const base = a.value + weighted;
    out.push({
      from: a.date,
      to: b.date,
      startValue: a.value,
      endValue: b.value,
      flow,
      gain,
      base,
      ret: base > 0 ? gain / base : null,
    });
  }
  return out;
}

/** The time-weighted index, starting at `start` on the first date: each period multiplies it by one plus its return. */
export function buildIndex(periods: PerfPeriod[], start = 100): IndexPoint[] {
  if (periods.length === 0) return [];
  const out: IndexPoint[] = [{ date: periods[0]!.from, value: start }];
  let v = start;
  for (const p of periods) {
    v *= 1 + (p.ret ?? 0);
    out.push({ date: p.to, value: v });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// Looking up a line
// ------------------------------------------------------------------------------------------------
/** The last point on or before a date, or null; with `maxGapDays` a point further back than that counts as missing. */
export function pointAtOrBefore(
  series: IndexPoint[],
  date: string,
  maxGapDays = Infinity,
): IndexPoint | null {
  let best: IndexPoint | null = null;
  for (const p of series) {
    if (p.date > date) break;
    best = p;
  }
  if (!best) return null;
  return daysBetween(best.date, date) <= maxGapDays ? best : null;
}

// ------------------------------------------------------------------------------------------------
// Trailing returns
// ------------------------------------------------------------------------------------------------
export type PeriodKey = '1w' | '1m' | '3m' | '6m' | 'ytd' | 'fy' | '1y' | '3y' | '5y' | 'all';

export interface PeriodDef {
  key: PeriodKey;
  label: string;
  /** a plain description for the table */
  words: string;
  /** months back from today; null for the start of the calendar year, the financial year or the whole history */
  months: number | null;
}

/** The periods of the return tables. Short ones are shown as the plain change; a year or more as a rate per year. */
export const PERF_PERIODS: PeriodDef[] = [
  { key: '1w', label: '1W', words: 'last week', months: null },
  { key: '1m', label: '1M', words: 'last month', months: 1 },
  { key: '3m', label: '3M', words: 'last 3 months', months: 3 },
  { key: '6m', label: '6M', words: 'last 6 months', months: 6 },
  { key: 'ytd', label: 'This year', words: 'this calendar year', months: null },
  { key: 'fy', label: 'This FY', words: 'this financial year (April to March)', months: null },
  { key: '1y', label: '1Y', words: 'last year', months: 12 },
  { key: '3y', label: '3Y', words: 'last 3 years', months: 36 },
  { key: '5y', label: '5Y', words: 'last 5 years', months: 60 },
  { key: 'all', label: 'All', words: 'since the start of the history', months: null },
];

/** The day a period starts counting from: the value on this day (or the last one before it) is the starting value. */
export function periodAnchor(key: PeriodKey, today: string): string | null {
  switch (key) {
    case '1w':
      return addDaysIso(today, -7);
    case 'ytd':
      return `${Number(today.slice(0, 4)) - 1}-12-31`;
    case 'fy':
      // the close of the day before the financial year starts, the day period-gains values a fund on to open the year
      return addDaysIso(fyStartOn(today), -1);
    case 'all':
      return null;
    default: {
      const m = PERF_PERIODS.find((p) => p.key === key)?.months;
      return m === undefined || m === null ? null : addMonthsIso(today, -m);
    }
  }
}

/** Every day the portfolio must be valued on so that each trailing period starts exactly where it says. */
export function perfAnchors(
  today: string,
  keys: PeriodKey[] = PERF_PERIODS.map((p) => p.key),
): string[] {
  return [
    ...new Set(keys.map((k) => periodAnchor(k, today)).filter((d): d is string => !!d)),
  ].sort();
}

export interface TrailingReturn {
  key: PeriodKey;
  from: string;
  to: string;
  startValue: number;
  endValue: number;
  /** the plain change over the period, a fraction */
  absolute: number;
  /** the rate per year; null for a period shorter than `annualiseAfterMonths` */
  annualised: number | null;
  /** the history reaches back to the start of the period */
  full: boolean;
}

/**
 * The change of a line over one period. Returns null when the line does not reach back far enough (the history must start within
 * `gapDays` of the period's start; for "All" it starts where the history does).
 */
export function trailingReturn(
  series: IndexPoint[],
  today: string,
  def: PeriodDef,
  opts: { gapDays: number; annualiseAfterMonths: number },
): TrailingReturn | null {
  if (series.length < 2) return null;
  const end = pointAtOrBefore(series, today);
  if (!end) return null;
  const anchor = periodAnchor(def.key, today);
  let start: IndexPoint | null;
  if (anchor === null) start = series[0]!;
  else {
    start = pointAtOrBefore(series, anchor, opts.gapDays);
    if (!start) return null;
  }
  if (end.date <= start.date || !(start.value > 0) || !(end.value > 0)) return null;
  const days = daysBetween(start.date, end.date);
  const absolute = end.value / start.value - 1;
  const enough = addMonthsIso(start.date, opts.annualiseAfterMonths) <= end.date;
  return {
    key: def.key,
    from: start.date,
    to: end.date,
    startValue: start.value,
    endValue: end.value,
    absolute,
    annualised: enough ? Math.pow(end.value / start.value, 365 / days) - 1 : null,
    full: true,
  };
}

/** All trailing periods for a line: a null where the history is too short. */
export function trailingTable(
  series: IndexPoint[],
  today: string,
  opts: { gapDays: number; annualiseAfterMonths: number },
  defs: PeriodDef[] = PERF_PERIODS,
): { def: PeriodDef; r: TrailingReturn | null }[] {
  return defs.map((def) => ({ def, r: trailingReturn(series, today, def, opts) }));
}

/** What a period shows: the rate per year when the period is a year or more, otherwise the plain change. */
export const shownReturn = (r: TrailingReturn) => r.annualised ?? r.absolute;

// ------------------------------------------------------------------------------------------------
// Months and years
// ------------------------------------------------------------------------------------------------
export interface MonthEnd {
  /** YYYY-MM */
  month: string;
  /** the last dated point inside the month */
  date: string;
  value: number;
}

/** The last point of every month that has one. */
export function monthEndPoints(series: IndexPoint[]): MonthEnd[] {
  const by = new Map<string, MonthEnd>();
  for (const p of [...series].sort((a, b) => a.date.localeCompare(b.date)))
    by.set(p.date.slice(0, 7), { month: p.date.slice(0, 7), date: p.date, value: p.value });
  return [...by.values()];
}

export interface MonthReturn {
  month: string;
  /** a fraction; null when the month cannot be worked out */
  ret: number | null;
  /** the month is not over yet, or the line began part-way through it */
  partial: boolean;
}

const monthsApart = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
  (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

const lastDayOfMonth = (month: string) =>
  new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0))
    .toISOString()
    .slice(0, 10);

/**
 * Return in each calendar month: the last point of the month against the last point of the month before. The first month uses the
 * first point of the line, and the current month runs to today; both are marked partial.
 */
export function monthlyReturns(series: IndexPoint[], today: string): MonthReturn[] {
  const ends = monthEndPoints(series);
  const out: MonthReturn[] = [];
  const firstDate = [...series].sort((a, b) => a.date.localeCompare(b.date))[0]?.date;
  ends.forEach((m, i) => {
    const prev = ends[i - 1];
    const startValue = prev ? prev.value : null;
    if (!prev) {
      // the first month: from the first point to the last point of that month, if they differ
      const first = series.find((p) => p.date === firstDate);
      if (first && m.date > first.date && first.value > 0)
        out.push({ month: m.month, ret: m.value / first.value - 1, partial: true });
      return;
    }
    out.push({
      month: m.month,
      ret: startValue !== null && startValue > 0 ? m.value / startValue - 1 : null,
      partial: m.month === today.slice(0, 7) && today < lastDayOfMonth(m.month),
    });
  });
  return out;
}

/** The returns of consecutive months joined: (1 + a)(1 + b)... - 1. Months with no figure count as no change. */
export const chainReturns = (rets: (number | null)[]) =>
  rets.reduce<number>((acc, r) => acc * (1 + (r ?? 0)), 1) - 1;

export type YearKind = 'calendar' | 'financial';

export interface YearReturn {
  /** "2025" or "2025-26" */
  key: string;
  ret: number | null;
  from: string;
  to: string;
  /** the year is not over, or the history began after it started */
  partial: boolean;
}

const yearKeyOf = (month: string, kind: YearKind) =>
  kind === 'calendar' ? month.slice(0, 4) : fyOf(`${month}-01`);

/** Return of every calendar or financial year the history touches, newest first. */
export function yearlyReturns(series: IndexPoint[], today: string, kind: YearKind): YearReturn[] {
  const ends = monthEndPoints(series);
  if (ends.length < 2) return [];
  const years = new Map<string, MonthEnd[]>();
  for (const m of ends) {
    const k = yearKeyOf(m.month, kind);
    years.set(k, [...(years.get(k) ?? []), m]);
  }
  const first = ends[0]!;
  const out: YearReturn[] = [];
  for (const [key, list] of years) {
    const last = list[list.length - 1]!;
    // the starting point is the last month end of the year before (or, for the first year, the first point)
    const startsIn = list[0]!;
    const prior = ends[ends.indexOf(startsIn) - 1];
    const start = prior ?? first;
    if (last.date <= start.date || !(start.value > 0)) continue;
    const startYearKey = prior ? yearKeyOf(prior.month, kind) : key;
    const complete =
      prior !== undefined &&
      startYearKey !== key &&
      (kind === 'calendar' ? start.month.endsWith('-12') : start.month.endsWith('-03')) &&
      (kind === 'calendar' ? last.month.endsWith('-12') : last.month.endsWith('-03'));
    // the current year runs to today
    const current = yearKeyOf(today.slice(0, 7), kind) === key;
    out.push({
      key,
      ret: last.value / start.value - 1,
      from: start.date,
      to: last.date,
      partial: !complete || current,
    });
  }
  return out.sort((a, b) => b.key.localeCompare(a.key));
}

export interface HeatRow {
  /** "2025" or "2025-26" */
  key: string;
  /** twelve cells: January to December, or April to March */
  cells: (number | null)[];
  /** the months joined; null when the row has no figure */
  total: number | null;
  /** how many of the twelve months have a figure */
  months: number;
}

const FY_ORDER = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3];

/** The month-by-month grid: one row per year, newest first, with the year's total (the months joined). */
export function heatmap(months: MonthReturn[], kind: YearKind): HeatRow[] {
  const rows = new Map<string, (number | null)[]>();
  for (const m of months) {
    const key = yearKeyOf(m.month, kind);
    const mo = Number(m.month.slice(5, 7));
    const slot = kind === 'calendar' ? mo - 1 : FY_ORDER.indexOf(mo);
    const row = rows.get(key) ?? Array<number | null>(12).fill(null);
    row[slot] = m.ret;
    rows.set(key, row);
  }
  return [...rows.entries()]
    .map(([key, cells]) => ({
      key,
      cells,
      total: cells.some((c) => c !== null) ? chainReturns(cells) : null,
      months: cells.filter((c) => c !== null).length,
    }))
    .sort((a, b) => b.key.localeCompare(a.key));
}

export interface Extreme<T extends string = string> {
  key: T;
  ret: number;
}

/** The best and the worst of a list of returns; both null when there is nothing to compare. */
export function bestWorst<T extends { ret: number | null }>(
  items: T[],
  keyOf: (t: T) => string,
): { best: Extreme | null; worst: Extreme | null } {
  const ok = items.filter((i): i is T & { ret: number } => i.ret !== null);
  if (ok.length === 0) return { best: null, worst: null };
  const sorted = [...ok].sort((a, b) => b.ret - a.ret);
  const b = sorted[0]!;
  const w = sorted[sorted.length - 1]!;
  return { best: { key: keyOf(b), ret: b.ret }, worst: { key: keyOf(w), ret: w.ret } };
}

// ------------------------------------------------------------------------------------------------
// Drawdown
// ------------------------------------------------------------------------------------------------
export interface DrawdownResult {
  /** how far below its previous highest point the line is on each date: zero or negative */
  points: IndexPoint[];
  max: { depth: number; peakOn: string; troughOn: string; recoveredOn: string | null } | null;
  current: { depth: number; peakOn: string; days: number } | null;
}

/** The fall from the highest point so far, at every point of the line, the deepest fall, and where the line stands now. */
export function drawdown(series: IndexPoint[]): DrawdownResult {
  const pts = [...series].filter((p) => p.value > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (pts.length < 2) return { points: [], max: null, current: null };
  let peak = pts[0]!;
  const out: IndexPoint[] = [];
  let worst: { depth: number; peak: IndexPoint; trough: IndexPoint } | null = null;
  for (const p of pts) {
    if (p.value >= peak.value) peak = p;
    const depth = p.value / peak.value - 1;
    out.push({ date: p.date, value: depth });
    if (depth < 0 && (!worst || depth < worst.depth)) worst = { depth, peak, trough: p };
  }
  let recoveredOn: string | null = null;
  if (worst)
    recoveredOn =
      pts.find((p) => p.date > worst!.trough.date && p.value >= worst!.peak.value)?.date ?? null;
  const last = pts[pts.length - 1]!;
  return {
    points: out,
    max: worst
      ? { depth: worst.depth, peakOn: worst.peak.date, troughOn: worst.trough.date, recoveredOn }
      : null,
    current: {
      depth: last.value / peak.value - 1,
      peakOn: peak.date,
      days: daysBetween(peak.date, last.date),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// Rolling returns
// ------------------------------------------------------------------------------------------------
export interface RollingResult {
  windowMonths: number;
  /** return over the window ending at each month end, per year for a window of a year or more */
  points: IndexPoint[];
  windows: number;
  min: Extreme | null;
  max: Extreme | null;
  median: number | null;
  average: number | null;
  /** the share of windows that ended above zero */
  positiveShare: number | null;
  latest: number | null;
}

/**
 * What a person would have earned by holding for `windowMonths`, whichever month they started: the return over each window of that
 * length ending at a month end. `minWindows` is the fewest windows worth summarising; below it the statistics are null and only
 * the points are returned.
 */
export function rollingReturns(
  series: IndexPoint[],
  windowMonths: number,
  minWindows: number,
): RollingResult {
  const ends = monthEndPoints(series);
  const pts: IndexPoint[] = [];
  for (let i = windowMonths; i < ends.length; i++) {
    const a = ends[i - windowMonths]!;
    const b = ends[i]!;
    if (monthsApart(a.month, b.month) !== windowMonths) continue;
    if (!(a.value > 0) || !(b.value > 0)) continue;
    const growth = b.value / a.value;
    pts.push({
      date: b.date,
      value: windowMonths >= 12 ? Math.pow(growth, 12 / windowMonths) - 1 : growth - 1,
    });
  }
  const empty = { min: null, max: null, median: null, average: null, positiveShare: null };
  const base = {
    windowMonths,
    points: pts,
    windows: pts.length,
    latest: pts[pts.length - 1]?.value ?? null,
  };
  if (pts.length < Math.max(1, minWindows)) return { ...base, ...empty };
  const vals = pts.map((p) => p.value).sort((a, b) => a - b);
  const byVal = [...pts].sort((a, b) => a.value - b.value);
  const mid = Math.floor(vals.length / 2);
  return {
    ...base,
    min: { key: byVal[0]!.date, ret: byVal[0]!.value },
    max: { key: byVal[byVal.length - 1]!.date, ret: byVal[byVal.length - 1]!.value },
    median: vals.length % 2 ? vals[mid]! : (vals[mid - 1]! + vals[mid]!) / 2,
    average: vals.reduce((a, v) => a + v, 0) / vals.length,
    positiveShare: vals.filter((v) => v > 0).length / vals.length,
  };
}

// ------------------------------------------------------------------------------------------------
// Risk
// ------------------------------------------------------------------------------------------------
export interface RiskStats {
  months: number;
  /** the return per year over these months */
  annualReturn: number;
  /** spread of monthly returns, per year */
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  riskFree: number;
}

/**
 * Volatility, Sharpe and Sortino from the latest `months` monthly returns. The yearly return is the monthly returns joined and
 * scaled to a year; volatility is the sample standard deviation of the monthly returns times the square root of twelve; Sharpe is
 * the return above the risk-free rate over the volatility; Sortino uses only the shortfall below the risk-free rate. Null until
 * `minMonths` months exist (a short history says nothing about risk). The risk-free rate is an assumption the person can change.
 */
export function riskStats(
  months: MonthReturn[],
  opts: { months: number; minMonths: number; riskFree: number },
): RiskStats | null {
  const rets = months
    .filter((m) => !m.partial && m.ret !== null)
    .slice(-opts.months)
    .map((m) => m.ret as number);
  const n = rets.length;
  if (n < Math.max(3, opts.minMonths)) return null;
  const annualReturn = Math.pow(chainReturns(rets) + 1, 12 / n) - 1;
  const mean = rets.reduce((a, r) => a + r, 0) / n;
  const sd = Math.sqrt(rets.reduce((a, r) => a + (r - mean) ** 2, 0) / (n - 1));
  const volatility = sd * Math.sqrt(12);
  const target = Math.pow(1 + opts.riskFree, 1 / 12) - 1;
  const down =
    Math.sqrt(rets.reduce((a, r) => a + Math.min(0, r - target) ** 2, 0) / n) * Math.sqrt(12);
  return {
    months: n,
    annualReturn,
    volatility,
    sharpe: volatility > 1e-9 ? (annualReturn - opts.riskFree) / volatility : null,
    sortino: down > 1e-9 ? (annualReturn - opts.riskFree) / down : null,
    riskFree: opts.riskFree,
  };
}

// ------------------------------------------------------------------------------------------------
// Everything for one line
// ------------------------------------------------------------------------------------------------
export interface ProfileConfig {
  /** an annual figure is shown only after this many months */
  annualiseAfterMonths: number;
  /** a price older than this many days is not used for a period's start */
  gapDays: number;
  riskFree: number;
  riskMonths: number;
  /** fewest monthly returns worth a risk figure */
  riskMinMonths: number;
  rollingYears: number[];
  rollingMinWindows: number;
}

export interface ReturnProfile {
  from: string | null;
  to: string | null;
  trailing: { def: PeriodDef; r: TrailingReturn | null }[];
  months: MonthReturn[];
  calendar: YearReturn[];
  financial: YearReturn[];
  heatCalendar: HeatRow[];
  heatFinancial: HeatRow[];
  bestMonth: Extreme | null;
  worstMonth: Extreme | null;
  bestYear: Extreme | null;
  worstYear: Extreme | null;
  /** the same for financial years */
  bestFy: Extreme | null;
  worstFy: Extreme | null;
  drawdown: DrawdownResult;
  rolling: RollingResult[];
  risk: RiskStats | null;
}

export function returnProfile(
  series: IndexPoint[],
  today: string,
  cfg: ProfileConfig,
): ReturnProfile {
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const months = monthlyReturns(sorted, today);
  const calendar = yearlyReturns(sorted, today, 'calendar');
  const financial = yearlyReturns(sorted, today, 'financial');
  const bm = bestWorst(
    months.filter((m) => !m.partial),
    (m) => m.month,
  );
  // only whole years are compared: a part-year says little about the best or worst
  const byFy = bestWorst(
    financial.filter((y) => !y.partial),
    (y) => y.key,
  );
  const by = bestWorst(
    calendar.filter((y) => !y.partial),
    (y) => y.key,
  );
  return {
    from: sorted[0]?.date ?? null,
    to: sorted[sorted.length - 1]?.date ?? null,
    trailing: trailingTable(sorted, today, cfg),
    months,
    calendar,
    financial,
    heatCalendar: heatmap(months, 'calendar'),
    heatFinancial: heatmap(months, 'financial'),
    bestMonth: bm.best,
    worstMonth: bm.worst,
    bestYear: by.best,
    worstYear: by.worst,
    bestFy: byFy.best,
    worstFy: byFy.worst,
    drawdown: drawdown(sorted),
    rolling: cfg.rollingYears.map((y) => rollingReturns(sorted, y * 12, cfg.rollingMinWindows)),
    risk: riskStats(months, {
      months: cfg.riskMonths,
      minMonths: cfg.riskMinMonths,
      riskFree: cfg.riskFree,
    }),
  };
}

/** Rebases a line to a starting value on a given date (the first point on or after it), for comparing two lines from one start. */
export function rebase(series: IndexPoint[], from: string, start = 100): IndexPoint[] {
  const pts = series.filter((p) => p.date >= from);
  const first = pointAtOrBefore(series, from) ?? pts[0];
  if (!first || !(first.value > 0)) return [];
  return [
    ...(first.date < from ? [{ date: from, value: start }] : []),
    ...pts.map((p) => ({ date: p.date, value: (p.value / first.value) * start })),
  ];
}
