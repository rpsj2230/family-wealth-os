/**
 * The workbook keeps one tab per month, named like "Oct 2026". This module reads those names, finds the tab for a month, picks the most
 * recent earlier tab as the template for a new one, names the new tab in the same style and decides where it goes. Pure: no network.
 */

export interface SheetTab {
  sheetId: number;
  title: string;
  /** position among the workbook's tabs, 0 = leftmost */
  index: number;
  hidden: boolean;
}

/** How a tab's name is written, so a new tab can be named the same way. */
export interface TitleStyle {
  /** "October" instead of "Oct" */
  long: boolean;
  /** what stands between month and year: " ", "-", "'" … */
  sep: string;
  /** "26" instead of "2026" */
  shortYear: boolean;
  /** "OCT", "oct" or "Oct" */
  letters: 'title' | 'upper' | 'lower';
  /** the year comes first ("2026 Oct") */
  yearFirst: boolean;
  /** the month is a number ("10-2026") */
  numeric: boolean;
}

export interface MonthTab extends SheetTab {
  year: number;
  /** 1 to 12 */
  month: number;
  style: TitleStyle;
}

export interface YearMonth {
  year: number;
  month: number;
}

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** "oct", "october", "sept" … to 1..12, or null. A name must be at least three letters and the start of the month's full name. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase();
  if (w.length < 3) return null;
  const i = LONG.findIndex((m) => m.toLowerCase().startsWith(w));
  return i >= 0 ? i + 1 : null;
}

const letterCase = (w: string): TitleStyle['letters'] =>
  w === w.toUpperCase() ? 'upper' : w === w.toLowerCase() ? 'lower' : 'title';

const fullYear = (y: string): number => (y.length === 2 ? 2000 + Number(y) : Number(y));
const isLong = (w: string): boolean => w.length > 3 && w.toLowerCase() !== 'sept';

/**
 * Reads a tab name as a month: "Oct 2026", "October 2026", "Oct-2026", "Oct'26", "oct 26", "2026 Oct", "10-2026".
 * Anything else ("Summary", "Oct 2026 - before sync", "Oct 2026 (old)") is not a month tab, so a safety copy is never taken for one.
 */
export function parseMonthTitle(title: string): (YearMonth & { style: TitleStyle }) | null {
  const t = title.trim();
  let m = /^([A-Za-z]{3,9})\.?([\s\-_/.,']*)(\d{4}|\d{2})$/.exec(t);
  if (m) {
    const month = monthOf(m[1]!);
    if (month === null) return null;
    return {
      year: fullYear(m[3]!),
      month,
      style: {
        long: isLong(m[1]!),
        sep: m[2]!,
        shortYear: m[3]!.length === 2,
        letters: letterCase(m[1]!),
        yearFirst: false,
        numeric: false,
      },
    };
  }
  m = /^(\d{4})([\s\-_/.,']*)([A-Za-z]{3,9})$/.exec(t);
  if (m) {
    const month = monthOf(m[3]!);
    if (month === null) return null;
    return {
      year: Number(m[1]),
      month,
      style: {
        long: isLong(m[3]!),
        sep: m[2]!,
        shortYear: false,
        letters: letterCase(m[3]!),
        yearFirst: true,
        numeric: false,
      },
    };
  }
  m = /^(\d{1,2})([-/.])(\d{4})$/.exec(t);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12)
    return {
      year: Number(m[3]),
      month: Number(m[1]),
      style: {
        long: false,
        sep: m[2]!,
        shortYear: false,
        letters: 'title',
        yearFirst: false,
        numeric: true,
      },
    };
  return null;
}

export const DEFAULT_STYLE: TitleStyle = {
  long: false,
  sep: ' ',
  shortYear: false,
  letters: 'title',
  yearFirst: false,
  numeric: false,
};

/** The name of a month's tab, written like the tabs that already exist. */
export function formatMonthTitle(ym: YearMonth, style: TitleStyle = DEFAULT_STYLE): string {
  const year = style.shortYear ? String(ym.year % 100).padStart(2, '0') : String(ym.year);
  if (style.numeric) return `${String(ym.month).padStart(2, '0')}${style.sep}${year}`;
  let name = (style.long ? LONG : SHORT)[ym.month - 1]!;
  if (style.letters === 'upper') name = name.toUpperCase();
  else if (style.letters === 'lower') name = name.toLowerCase();
  return style.yearFirst ? `${year}${style.sep}${name}` : `${name}${style.sep}${year}`;
}

/** Every visible tab that is named like a month, oldest first. A hidden tab (the safety copy) is never one. */
export function monthTabs(tabs: SheetTab[]): MonthTab[] {
  const out: MonthTab[] = [];
  for (const t of [...tabs].sort((a, b) => a.index - b.index)) {
    if (t.hidden) continue;
    const p = parseMonthTitle(t.title);
    if (!p) continue;
    // two tabs for one month ("Oct 2026" and "October 2026"): the left-most one counts
    if (out.some((x) => x.year === p.year && x.month === p.month)) continue;
    out.push({ ...t, year: p.year, month: p.month, style: p.style });
  }
  return out.sort((a, b) => a.year - b.year || a.month - b.month);
}

const ordinal = (x: YearMonth) => x.year * 12 + x.month;

/** The tab for this month, if there is one. */
export function findMonthTab(tabs: MonthTab[], target: YearMonth): MonthTab | null {
  return tabs.find((t) => ordinal(t) === ordinal(target)) ?? null;
}

/** The most recent tab of an earlier month: the sheet a new month is copied from. */
export function pickTemplate(tabs: MonthTab[], target: YearMonth): MonthTab | null {
  const earlier = tabs.filter((t) => ordinal(t) < ordinal(target));
  return earlier.length === 0 ? null : earlier.reduce((a, b) => (ordinal(b) > ordinal(a) ? b : a));
}

/** Whether the newest month sits at the left or the right of the tab bar, judged from the tabs that exist. */
export function tabOrder(tabs: MonthTab[]): 'newest_left' | 'newest_right' | 'unknown' {
  const byIndex = [...tabs].sort((a, b) => a.index - b.index);
  let asc = 0;
  let desc = 0;
  for (let i = 1; i < byIndex.length; i++) {
    const d = ordinal(byIndex[i]!) - ordinal(byIndex[i - 1]!);
    if (d > 0) asc++;
    else if (d < 0) desc++;
  }
  return asc > desc ? 'newest_right' : desc > asc ? 'newest_left' : 'unknown';
}

/** Where the new tab goes (zero-based): beside the template, on the side the workbook already puts its newer months. */
export function insertIndexFor(order: ReturnType<typeof tabOrder>, template: MonthTab): number {
  return order === 'newest_left' ? template.index : template.index + 1;
}

/** The calendar month of a moment in a time zone (Asia/Singapore). */
export function monthIn(timeZone: string, now: Date): YearMonth & { iso: string } {
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone }).format(now);
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)), iso };
}
