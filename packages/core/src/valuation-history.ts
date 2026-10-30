/**
 * Portfolio value by period (Investments > Value by period): what the mutual funds were worth at the end of every week, month,
 * quarter or financial year, how that changed, how much of the change was new money and how much was real profit.
 *
 * The value at the end of a period is the position engine's (position.ts): the units held on that day times the price on or just
 * before it, or the nearest earlier record moved forward when there is no ledger (marked estimated). The gain of a period is the one
 * shared function of the period figures (`fundPeriod` in period-gains.ts): the change in value less the amount invested plus the money
 * taken out, so Home, Investments and the summaries cannot disagree. The plain change in value (as a statement shows it) and the
 * gain are both here, apart, so a month with a big purchase never reads as a good month.
 *
 * Periods:
 *  - a week runs Monday to Sunday (ISO) and is labelled by its Monday ("Week of 5 Oct 2026"); its value is the one at the end of Sunday;
 *  - a month is a calendar month; a quarter follows the financial year (April to June is Q1) or the calendar, as Settings say;
 *  - a year is a financial year, 1 April to 31 March (the portal's rule);
 *  - the latest period is cut at today and says "to date": it is not a month end. A period that starts before the first record
 *    is cut there and says so.
 * Pure: no I/O.
 */
import { addDaysIso } from './harvest-lots';
import { formatInr } from './money';
import { fundPeriod, spanBetween, type ClassPeriod } from './period-gains';
import {
  fundsOf,
  ledgerlessStart,
  valueOn,
  type PositionAsset,
  type PositionInput,
} from './position';

export type Granularity = 'week' | 'month' | 'quarter' | 'year';

export const GRANULARITIES: { key: Granularity; label: string; noun: string }[] = [
  { key: 'week', label: 'Weeks', noun: 'week' },
  { key: 'month', label: 'Months', noun: 'month' },
  { key: 'quarter', label: 'Quarters', noun: 'quarter' },
  { key: 'year', label: 'Years', noun: 'financial year' },
];

export const parseGranularity = (v: string | undefined): Granularity =>
  GRANULARITIES.find((g) => g.key === v)?.key ?? 'month';

/** How much to show: the last N periods (N from Settings, or twice that), everything, or between two dates. */
export type ValuationRange =
  | { kind: 'recent' }
  | { kind: 'double' }
  | { kind: 'all' }
  | { kind: 'between'; from: string; to: string };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (d: string | undefined): d is string =>
  !!d && ISO.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

/** `range` is "recent", "double" or "all"; `from` and `to` (dates) choose a stretch of their own. */
export function parseValuationRange(
  range: string | undefined,
  from: string | undefined,
  to: string | undefined,
): ValuationRange {
  if (validDate(from) && validDate(to) && from <= to) return { kind: 'between', from, to };
  return range === 'all'
    ? { kind: 'all' }
    : range === 'double'
      ? { kind: 'double' }
      : { kind: 'recent' };
}

// ------------------------------------------------------------------------------------------------
// Dates
// ------------------------------------------------------------------------------------------------
const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDay = (d: string) =>
  `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
const lastDayOfMonth = (y: number, m: number) => iso(new Date(Date.UTC(y, m, 0)));

/** The Monday of the ISO week a date falls in. */
export function weekStartOn(d: string): string {
  const day = utc(d).getUTCDay(); // 0 = Sunday
  return addDaysIso(d, -((day + 6) % 7));
}

/** First day of the financial year a date falls in. */
const fyStart = (d: string) => {
  const y = Number(d.slice(0, 4));
  return Number(d.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`;
};
const fyLabel = (start: string) => {
  const y = Number(start.slice(0, 4));
  return `FY ${y}-${String((y + 1) % 100).padStart(2, '0')}`;
};

export interface ValuationPeriod {
  /** stable key: the first day of the full period */
  key: string;
  /** "Week of 5 Oct 2026", "Oct 2026", "Q2 FY 2026-27", "FY 2025-26" */
  label: string;
  /** what the period covers, in words: "Jul to Sep 2026" */
  sub: string;
  /** the first and last day of the full period */
  start: string;
  end: string;
  /** the first day the figures rest on (later than `start` when the records begin inside the period) */
  from: string;
  /** the day the value is taken on: `end`, or today for the latest period */
  through: string;
  /** the latest period, cut at today: "to date", not a period end */
  toDate: boolean;
  /** the records begin inside this period, so it is shorter than a full one */
  startsInside: boolean;
}

/** The full period (first and last day) a date falls in. */
function bounds(g: Granularity, d: string): { start: string; end: string } {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  if (g === 'week') {
    const start = weekStartOn(d);
    return { start, end: addDaysIso(start, 6) };
  }
  if (g === 'month')
    return { start: `${y}-${String(m).padStart(2, '0')}-01`, end: lastDayOfMonth(y, m) };
  if (g === 'year') {
    const s = fyStart(d);
    return { start: s, end: `${Number(s.slice(0, 4)) + 1}-03-31` };
  }
  // quarters begin in January, April, July and October either way; only the numbering (which one is Q1) differs
  const sm = m - ((m - 1) % 3);
  return { start: `${y}-${String(sm).padStart(2, '0')}-01`, end: lastDayOfMonth(y, sm + 2) };
}

function labelOf(g: Granularity, start: string, end: string, financialQuarters: boolean) {
  if (g === 'week')
    return { label: `Week of ${niceDay(start)}`, sub: `${niceDay(start)} to ${niceDay(end)}` };
  if (g === 'month')
    return {
      label: `${MONTHS[Number(start.slice(5, 7)) - 1]} ${start.slice(0, 4)}`,
      sub: `${niceDay(start)} to ${niceDay(end)}`,
    };
  if (g === 'year') return { label: fyLabel(start), sub: `${niceDay(start)} to ${niceDay(end)}` };
  const sm = Number(start.slice(5, 7));
  const em = Number(end.slice(5, 7));
  const span = `${MONTHS[sm - 1]} to ${MONTHS[em - 1]} ${end.slice(0, 4)}`;
  if (financialQuarters) {
    const n = Math.floor(((sm - 4 + 12) % 12) / 3) + 1;
    return { label: `Q${n} ${fyLabel(fyStart(start))}`, sub: span };
  }
  return { label: `Q${Math.floor((sm - 1) / 3) + 1} ${start.slice(0, 4)}`, sub: span };
}

/**
 * Every period from the one the first record falls in to the one today falls in, oldest first. The first is cut where the records
 * begin and the last at today.
 */
export function periodsFor(
  g: Granularity,
  first: string,
  today: string,
  financialQuarters = true,
): ValuationPeriod[] {
  const out: ValuationPeriod[] = [];
  let at = first <= today ? first : today;
  for (let guard = 0; guard < 5000; guard++) {
    const b = bounds(g, at);
    const toDate = b.end >= today;
    const l = labelOf(g, b.start, b.end, financialQuarters);
    const from = b.start < first ? first : b.start;
    out.push({
      key: b.start,
      label: toDate ? `${l.label} (to date)` : l.label,
      sub: l.sub,
      start: b.start,
      end: b.end,
      from,
      through: toDate ? today : b.end,
      toDate,
      startsInside: b.start < first,
    });
    if (toDate) break;
    at = addDaysIso(b.end, 1);
  }
  return out;
}

/** The periods a range asks for: the last N (the default, or twice it), all of them, or those that touch two dates. */
export function pickPeriods(
  periods: ValuationPeriod[],
  range: ValuationRange,
  recent: number,
): ValuationPeriod[] {
  if (range.kind === 'all') return periods;
  if (range.kind === 'between')
    return periods.filter((p) => p.end >= range.from && p.start <= range.to);
  const n = range.kind === 'double' ? recent * 2 : recent;
  return periods.slice(-n);
}

// ------------------------------------------------------------------------------------------------
// The rows
// ------------------------------------------------------------------------------------------------
export interface ValuationRow {
  period: ValuationPeriod;
  /** the funds' worth at the end of the period; null with no data */
  value: number | null;
  /** the value rests on a record moved forward, a price move on a recorded value or a plan: not units times a price */
  estimated: boolean;
  /** against the end of the period before, as a statement shows it, new money included; null when there is no earlier value */
  change: number | null;
  changePct: number | null;
  /** invested less money withdrawn in the period */
  netIn: number;
  /** what the funds earned: the change less the amount invested plus the money withdrawn; null with no data */
  gain: number | null;
  /** the gain as a share of the money at work in the period */
  gainPct: number | null;
  /** the money at work: the value at the start of the period plus each purchase for the days it was held */
  base: number;
  /** how many funds had a value at the end */
  funds: number;
  /** change between monthly fund values that neither the price nor the SIP plan explains, left out of `gain` (funds with no ledger); and how many funds it comes from */
  unexplained: number;
  unexplainedGross: number;
  unexplainedFunds: number;
}

export interface ValuationHistory {
  rows: ValuationRow[];
  /** every period the records reach back to, before the range was applied */
  total: number;
  firstDate: string | null;
  today: string;
  granularity: Granularity;
  range: ValuationRange;
  /** the funds held today, and how many have no transaction ledger (only a plan or monthly values): their gains are approximate */
  ledger: { held: number; withoutLedger: number };
}

const fundsOfInput = (input: PositionInput, owner: string | null): PositionAsset[] =>
  input.assets.filter(
    (a) => a.type === 'mutual_fund' && a.status !== 'gifted' && (!owner || a.ownerId === owner),
  );

/** The first day any fund has anything on file (a ledger line, a flow, a value). */
function firstFundDate(assets: PositionAsset[]): string | null {
  const days = assets.flatMap((a) =>
    [
      a.fund?.txns[0]?.date,
      ledgerlessStart(a) ?? a.fund?.flows[0]?.date,
      ...(a.fund?.snapshots ?? []).slice(0, 1).map((s) => s.date),
      ...a.records.slice(0, 1).map((r) => r.date),
    ].filter((x): x is string => !!x),
  );
  return days.sort()[0] ?? null;
}

export function valuationHistory(args: {
  position: PositionInput;
  granularity: Granularity;
  range: ValuationRange;
  /** only this person's funds; null for everyone */
  owner: string | null;
  /** Settings: the default number of periods, and the kind of quarter */
  recent: number;
  financialQuarters: boolean;
}): ValuationHistory {
  const { position, granularity, range } = args;
  const c = position.config;
  const today = c.today;
  const assets = fundsOfInput(position, args.owner);
  const first = firstFundDate(assets);
  const held = assets.filter((a) => {
    const v = valueOn(a, today, c, position.current);
    return v.state === 'held' && (v.value ?? 0) > 0;
  });
  const ledger = {
    held: held.length,
    withoutLedger: held.filter((a) => !a.fund?.hasStatement).length,
  };
  const empty: ValuationHistory = {
    rows: [],
    total: 0,
    firstDate: first,
    today,
    granularity,
    range,
    ledger,
  };
  if (!first) return empty;
  const all = periodsFor(granularity, first, today, args.financialQuarters);
  const chosen = pickPeriods(all, range, args.recent);

  // the funds with their value on every day measured: the day before each period starts and its last day
  const days = [...new Set(chosen.flatMap((p) => [addDaysIso(p.from, -1), p.through]))].sort();
  // the same function Home's period figures read the funds from
  const holdings = fundsOf(position, days, args.owner);

  const at = (d: string) => {
    let value = 0;
    let n = 0;
    let estimated = false;
    for (const a of assets) {
      const v = valueOn(a, d, c, position.current);
      // a fund sold out has a value of nothing; one not yet bought, or with nothing on file, has no value
      if (v.state === 'held' || v.state === 'ended') {
        value += v.value ?? 0;
        n++;
        if (v.state === 'held' && v.estimated) estimated = true;
      }
    }
    return { value: n > 0 ? value : null, funds: n, estimated };
  };

  const rows: ValuationRow[] = chosen.map((p) => {
    const end = at(p.through);
    const before = at(addDaysIso(p.from, -1));
    // the period's own figures: from its first day to the start of the next (to the start of today for the latest)
    const w = spanBetween(p.from, p.toDate ? today : addDaysIso(p.through, 1), p.through);
    const cell: ClassPeriod = fundPeriod(holdings, w, today);
    const hasEnd = end.value !== null;
    const change = hasEnd && before.value !== null ? end.value! - before.value : null;
    return {
      period: p,
      value: end.value,
      estimated: end.estimated || (hasEnd && cell.estimated),
      change,
      changePct: change !== null && before.value! > 0 ? change / before.value! : null,
      netIn: cell.putIn - cell.takenOut,
      gain: hasEnd ? cell.profit : null,
      gainPct: hasEnd ? cell.pct : null,
      base: cell.base,
      funds: end.funds,
      unexplained: cell.unexplained,
      unexplainedGross: cell.unexplainedGross,
      unexplainedFunds: cell.unexplainedFunds,
    };
  });
  return { rows, total: all.length, firstDate: first, today, granularity, range, ledger };
}

// ------------------------------------------------------------------------------------------------
// Words and the download
// ------------------------------------------------------------------------------------------------
/** "−₹1,23,456" or "+₹1,23,456" with Indian grouping; "no data" for nothing. */
export function signedRupees(n: number | null, plus = true): string {
  if (n === null) return 'no data';
  const r = Math.round(n);
  return `${r < 0 ? '−' : plus && r > 0 ? '+' : ''}${formatInr(Math.abs(r))}`;
}
export function signedShare(n: number | null, digits = 2): string {
  if (n === null) return '–';
  const v = n * 100;
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${Math.abs(v).toFixed(digits)}%`;
}

export const VALUATION_CSV_HEAD = [
  'Period',
  'From',
  'To',
  'Portfolio value (INR)',
  'Change (INR)',
  'Change (%)',
  'Added less withdrawn (INR)',
  'Profit (INR)',
  'Overall return (%)',
  'Basis',
];

/** The table as rows of text for a spreadsheet: plain numbers, a blank for no data, and the basis in words. */
export function valuationCsvRows(h: ValuationHistory): string[][] {
  const num = (n: number | null, d = 2) => (n === null ? '' : n.toFixed(d));
  const pct = (n: number | null) => (n === null ? '' : (n * 100).toFixed(2));
  return [
    VALUATION_CSV_HEAD,
    ...h.rows.map((r) => [
      r.period.label,
      r.period.from,
      r.period.through,
      num(r.value),
      num(r.change),
      pct(r.changePct),
      r.value === null ? '' : num(r.netIn),
      num(r.gain),
      pct(r.gainPct),
      r.value === null ? 'no data' : r.estimated ? 'estimated' : 'units times price',
    ]),
  ];
}
