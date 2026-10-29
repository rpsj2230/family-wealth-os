/**
 * The periods a report can cover, by name: today, yesterday, this and last week (Monday to Sunday), month, quarter (the financial
 * year's quarters: Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar), financial year (1 April to 31 March), calendar year, the last 7, 30 and 90
 * days, the last 12 months, the year and the financial year to date, since the first record, and any two dates. Each resolves to
 * two dates, both included, and has a "previous period" of the same kind (or the same length) for comparisons. Only the "next"
 * periods and chosen dates may end after today (deposits maturing ahead); every other period stops at today.
 *
 * Pure: no I/O.
 */

export type ReportPeriodKey =
  | 'today'
  | 'yesterday'
  | 'this-week'
  | 'last-week'
  | 'this-month'
  | 'last-month'
  | 'this-quarter'
  | 'last-quarter'
  | 'this-fy'
  | 'last-fy'
  | 'this-year'
  | 'last-year'
  | 'last-7'
  | 'last-30'
  | 'last-90'
  | 'last-12m'
  | 'ytd'
  | 'fytd'
  | 'inception'
  | 'next-7'
  | 'next-30'
  | 'next-90'
  | 'next-12m'
  | 'custom';

export const PERIOD_PRESETS: { key: ReportPeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'this-quarter', label: 'This quarter' },
  { key: 'last-quarter', label: 'Last quarter' },
  { key: 'this-fy', label: 'This financial year' },
  { key: 'last-fy', label: 'Last financial year' },
  { key: 'this-year', label: 'This calendar year' },
  { key: 'last-year', label: 'Last calendar year' },
  { key: 'last-7', label: 'Last 7 days' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'last-90', label: 'Last 90 days' },
  { key: 'last-12m', label: 'Last 12 months' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'fytd', label: 'Financial year to date' },
  { key: 'inception', label: 'Since the first record' },
  { key: 'next-7', label: 'Next 7 days' },
  { key: 'next-30', label: 'Next 30 days' },
  { key: 'next-90', label: 'Next 90 days' },
  { key: 'next-12m', label: 'Next 12 months' },
  { key: 'custom', label: 'Choose dates' },
];

export const parsePeriodKey = (
  v: string | undefined | null,
  fallback: ReportPeriodKey = 'this-fy',
): ReportPeriodKey => (PERIOD_PRESETS.some((p) => p.key === v) ? (v as ReportPeriodKey) : fallback);

export interface DateRange {
  key: ReportPeriodKey;
  /** first day, included (YYYY-MM-DD) */
  from: string;
  /** last day, included */
  to: string;
  label: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const shift = (s: string, n: number) => {
  const x = d(s);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const ymd = (y: number, m: number, day: number) => iso(new Date(Date.UTC(y, m - 1, day)));
const lastOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));
export const longDay = (s: string) =>
  `${Number(s.slice(8, 10))} ${MON[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
export const daysIn = (r: { from: string; to: string }) =>
  Math.round((d(r.to).getTime() - d(r.from).getTime()) / 86_400_000) + 1;

/** The same day a year earlier; 29 February becomes 28 February. */
const yearBack = (s: string) => {
  const y = Number(s.slice(0, 4)) - 1;
  const m = Number(s.slice(5, 7));
  const last = Number(lastOfMonth(y, m).slice(8, 10));
  return ymd(y, m, Math.min(Number(s.slice(8, 10)), last));
};
/** The financial year a date falls in, by its first calendar year: 2026-10-29 → 2026 (FY 2026-27). */
const fyStartYear = (s: string) => {
  const y = Number(s.slice(0, 4));
  return Number(s.slice(5, 7)) >= 4 ? y : y - 1;
};
const fyName = (y: number) => `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
/** The financial-year quarter a date is in: its first month (4, 7, 10 or 1) and calendar year. */
const fyQuarter = (s: string) => {
  const m = Number(s.slice(5, 7));
  const y = Number(s.slice(0, 4));
  const first = m >= 4 ? Math.floor((m - 4) / 3) * 3 + 4 : 1;
  return { y, m: first };
};
const quarterRange = (y: number, m: number) => ({ from: ymd(y, m, 1), to: lastOfMonth(y, m + 2) });
/** "Q3 FY 2026-27 (Oct–Dec 2026)", or with calendar quarters (Settings) "Q4 2026 (Oct–Dec 2026)". */
const quarterName = (y: number, m: number, financial = true) => {
  if (!financial) return `Q${(m - 1) / 3 + 1} ${y} (${MON[m - 1]}–${MON[m + 1]} ${y})`;
  const fy = m >= 4 ? y : y - 1;
  const q = m >= 4 ? (m - 4) / 3 + 1 : 4;
  return `Q${q} ${fyName(fy)} (${MON[m - 1]}–${MON[m + 1]} ${y})`;
};

/**
 * The two dates of a period. `first` is the day of the first record (for "since the first record"); a custom period takes `from`
 * and `to` (swapped when given the wrong way round) and falls back to this financial year to date when either is missing or wrong.
 * Only the "next" periods and chosen dates run past today.
 */
export function resolvePeriod(
  key: ReportPeriodKey,
  today: string,
  opts: {
    from?: string | null | undefined;
    to?: string | null | undefined;
    first?: string | null | undefined;
    /** Settings → funds.financialQuarters: name quarters by the financial year (default) or the calendar */
    financialQuarters?: boolean | undefined;
  } = {},
): DateRange {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const range = (from: string, to: string, label: string): DateRange => ({
    key,
    from,
    to: to > today ? today : to,
    label,
  });
  switch (key) {
    case 'today':
      return range(today, today, `Today, ${longDay(today)}`);
    case 'yesterday': {
      const t = shift(today, -1);
      return range(t, t, `Yesterday, ${longDay(t)}`);
    }
    case 'this-week':
    case 'last-week': {
      const dow = (d(today).getUTCDay() + 6) % 7; // Monday 0
      const mon = shift(today, -dow - (key === 'last-week' ? 7 : 0));
      const sun = shift(mon, 6);
      return range(
        mon,
        sun,
        `${key === 'this-week' ? 'This' : 'Last'} week, ${longDay(mon)} – ${longDay(sun)}`,
      );
    }
    case 'this-month':
      return range(ymd(y, m, 1), lastOfMonth(y, m), `${MON[m - 1]} ${y}`);
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return range(ymd(py, pm, 1), lastOfMonth(py, pm), `${MON[pm - 1]} ${py}`);
    }
    case 'this-quarter':
    case 'last-quarter': {
      let q = fyQuarter(today);
      if (key === 'last-quarter')
        q =
          q.m === 1 ? { y: q.y - 1, m: 10 } : q.m === 4 ? { y: q.y, m: 1 } : { y: q.y, m: q.m - 3 };
      const r = quarterRange(q.y, q.m);
      return range(r.from, r.to, quarterName(q.y, q.m, opts.financialQuarters !== false));
    }
    case 'this-fy':
    case 'last-fy': {
      const fy = fyStartYear(today) - (key === 'last-fy' ? 1 : 0);
      return range(ymd(fy, 4, 1), ymd(fy + 1, 3, 31), fyName(fy));
    }
    case 'this-year':
      return range(ymd(y, 1, 1), ymd(y, 12, 31), String(y));
    case 'last-year':
      return range(ymd(y - 1, 1, 1), ymd(y - 1, 12, 31), String(y - 1));
    case 'last-7':
    case 'last-30':
    case 'last-90': {
      const n = Number(key.slice(5));
      return range(shift(today, -(n - 1)), today, `Last ${n} days`);
    }
    case 'last-12m': {
      const from = shift(ymd(y - 1, m, Number(today.slice(8, 10))), 1);
      return range(from, today, 'Last 12 months');
    }
    case 'ytd':
      return range(ymd(y, 1, 1), today, `${y} to date`);
    case 'fytd': {
      const fy = fyStartYear(today);
      return range(ymd(fy, 4, 1), today, `${fyName(fy)} to date`);
    }
    case 'inception': {
      const first = opts.first && ISO.test(opts.first) && opts.first <= today ? opts.first : today;
      return range(first, today, `Since the first record (${longDay(first)})`);
    }
    case 'next-7':
    case 'next-30':
    case 'next-90': {
      const n = Number(key.slice(5));
      const to = shift(today, n);
      // looks ahead: the only presets that end after today
      return { key, from: today, to, label: `Next ${n} days, to ${longDay(to)}` };
    }
    case 'next-12m': {
      const to = shift(ymd(y + 1, m, Number(today.slice(8, 10))), -1);
      return { key, from: today, to, label: `Next 12 months, to ${longDay(to)}` };
    }
    case 'custom': {
      const ok = (s: string | null | undefined) =>
        !!s && ISO.test(s) && !Number.isNaN(d(s).getTime());
      if (!ok(opts.from) || !ok(opts.to)) return { ...resolvePeriod('fytd', today), key: 'custom' };
      const [a, b] = opts.from! <= opts.to! ? [opts.from!, opts.to!] : [opts.to!, opts.from!];
      // a chosen period may run into the future (maturities ahead)
      return { key, from: a, to: b, label: `${longDay(a)} – ${longDay(b)}` };
    }
  }
}

/**
 * The period before, for a comparison: the previous month, quarter, financial or calendar year for those; the same days a year
 * earlier for a "to date" period; otherwise the same number of days just before. Null for "since the first record".
 */
export function previousPeriod(
  r: DateRange,
  opts: { financialQuarters?: boolean | undefined } = {},
): DateRange | null {
  const y = Number(r.from.slice(0, 4));
  const m = Number(r.from.slice(5, 7));
  const named = (from: string, to: string, label: string): DateRange => ({
    key: 'custom',
    from,
    to,
    label,
  });
  switch (r.key) {
    case 'inception':
      return null;
    case 'this-month':
    case 'last-month': {
      const py = m === 1 ? y - 1 : y;
      const pm = m === 1 ? 12 : m - 1;
      return named(ymd(py, pm, 1), lastOfMonth(py, pm), `${MON[pm - 1]} ${py}`);
    }
    case 'this-quarter':
    case 'last-quarter': {
      const q = m === 1 ? { y: y - 1, m: 10 } : m === 4 ? { y, m: 1 } : { y, m: m - 3 };
      const p = quarterRange(q.y, q.m);
      return named(p.from, p.to, quarterName(q.y, q.m, opts.financialQuarters !== false));
    }
    case 'this-fy':
    case 'last-fy':
      return named(ymd(y - 1, 4, 1), ymd(y, 3, 31), fyName(y - 1));
    case 'this-year':
    case 'last-year':
      return named(ymd(y - 1, 1, 1), ymd(y - 1, 12, 31), String(y - 1));
    case 'ytd':
    case 'fytd': {
      const from = yearBack(r.from);
      const to = yearBack(r.to);
      return named(from, to, `${longDay(from)} – ${longDay(to)}`);
    }
    default: {
      const n = daysIn(r);
      const to = shift(r.from, -1);
      const from = shift(to, -(n - 1));
      return named(from, to, `${longDay(from)} – ${longDay(to)}`);
    }
  }
}

/** True when the date falls in the range, both ends included. */
export const inRange = (date: string, r: { from: string; to: string }) =>
  date >= r.from && date <= r.to;
