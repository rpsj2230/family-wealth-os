/**
 * A fund from the holder's side: what their own money did, as opposed to what one unit of the fund did. The fund's price line goes
 * back to its launch; these figures start with the holder's first purchase and count only their money.
 *
 *  - `ownPeriods`: for each period (last month, last year, since the first purchase…) the value at its start, the money put in and
 *    taken out inside it, the value at its end, the profit in rupees and the return on the money (money-weighted: XIRR per year for a
 *    period of a year or more; the profit on the money at work for a shorter one).
 *  - `shadowLine`: what the same purchases and sales, on the same days, would be worth had they gone into another line (a benchmark).
 *  - `heldLine`: the fund's price line cut to the time the holder has had money in it, so a month grid or a fall from the high does
 *    not reach back to years before they invested.
 *
 * Pure: no I/O.
 */
import { addMonthsIso } from './harvest-lots';
import {
  periodAnchor,
  pointAtOrBefore,
  type Flow,
  type IndexPoint,
  type PeriodDef,
} from './return-profile';
import { xirr } from './xirr';

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const days = (from: string, to: string) => Math.round((ms(to) - ms(from)) / DAY);

export interface OwnPeriodRow {
  def: PeriodDef;
  /** the day the period is counted from: its start, or the first purchase when that came later */
  from: string;
  to: string;
  startValue: number;
  /** purchases inside the period */
  putIn: number;
  /** sales and payouts inside the period, as a positive amount */
  takenOut: number;
  endValue: number;
  /** end value less start value less the net money put in: what the market added */
  gain: number;
  /** the return on the holder's money: per year (XIRR) when `annualised`, otherwise the profit on the money at work */
  ret: number | null;
  annualised: boolean;
  /** the period reaches back before the first purchase, so it counts from the first purchase */
  sinceFirst: boolean;
}

/**
 * The holder's own figures over each period. `points` are dated values of the holding (today's last); `flows` are purchases
 * (positive) and sales (negative). A period that starts before the first purchase is counted from the first purchase, and only the
 * first such period is kept (the longer ones would repeat it), so the list reads from the shortest period to "since you started".
 */
export function ownPeriods(args: {
  points: IndexPoint[];
  flows: Flow[];
  today: string;
  defs: PeriodDef[];
  /** a period of at least this many months shows a return per year */
  annualiseAfterMonths: number;
}): OwnPeriodRow[] {
  const pts = [...args.points].filter((p) => p.date <= args.today).sort(byDate);
  const flows = [...args.flows].filter((f) => f.date <= args.today && f.amount !== 0).sort(byDate);
  const end = pts[pts.length - 1];
  const firstFlow = flows[0]?.date ?? null;
  if (!end || !firstFlow) return [];
  const out: OwnPeriodRow[] = [];
  let reachedStart = false;
  for (const def of args.defs) {
    if (reachedStart) break;
    const anchor = periodAnchor(def.key, args.today);
    const sinceFirst = anchor === null || anchor < firstFlow;
    if (sinceFirst) reachedStart = true;
    // the value at the start: the holding as it stood at the close of the anchor day (nothing before the first purchase)
    const from = sinceFirst ? firstFlow : anchor!;
    const startValue = sinceFirst ? 0 : (pointAtOrBefore(pts, from)?.value ?? 0);
    const inside = flows.filter((f) => (sinceFirst ? f.date >= from : f.date > from));
    const putIn = inside.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
    const takenOut = -inside.filter((f) => f.amount < 0).reduce((a, f) => a + f.amount, 0);
    const gain = end.value - startValue - (putIn - takenOut);
    const span = days(from, end.date);
    const annualised = addMonthsIso(from, args.annualiseAfterMonths) <= end.date;
    let ret: number | null = null;
    if (annualised) {
      const cf = [
        ...(startValue > 0 ? [{ date: new Date(ms(from)), amount: -startValue }] : []),
        ...inside.map((f) => ({ date: new Date(ms(f.date)), amount: -f.amount })),
        { date: new Date(ms(end.date)), amount: end.value },
      ];
      ret = xirr(cf).rate;
    } else if (span > 0) {
      // Modified Dietz: each flow counts for the part of the period it was invested
      const atWork =
        startValue +
        inside.reduce((a, f) => a + (f.amount * Math.max(0, days(f.date, end.date))) / span, 0);
      ret = atWork > 0 ? gain / atWork : null;
    }
    out.push({
      def,
      from,
      to: end.date,
      startValue,
      putIn,
      takenOut,
      endValue: end.value,
      gain,
      ret,
      annualised,
      sinceFirst,
    });
  }
  return out;
}

/**
 * What the holder's own purchases and sales would be worth on each date of `dates` had they gone into `line` instead, on the same
 * days and for the same amounts. A sale takes out the same rupees. Dates before the first flow, or with no price of the line on or
 * before them, are left out.
 */
export function shadowLine(flows: Flow[], line: IndexPoint[], dates: string[]): IndexPoint[] {
  const ordered = [...flows].filter((f) => f.amount !== 0).sort(byDate);
  const priceOn = (d: string) => pointAtOrBefore(line, d)?.value ?? null;
  const out: IndexPoint[] = [];
  for (const d of [...new Set(dates)].sort()) {
    if (!ordered[0] || d < ordered[0].date) continue;
    let units = 0;
    let known = true;
    for (const f of ordered) {
      if (f.date > d) break;
      const p = priceOn(f.date);
      if (p === null || !(p > 0)) {
        known = false;
        break;
      }
      units = Math.max(0, units + f.amount / p);
    }
    const now = priceOn(d);
    if (!known || now === null) continue;
    out.push({ date: d, value: units * now });
  }
  return out;
}

/**
 * The price line from the holder's first purchase on (the price on that day or the last one before it, then every later price), so
 * month grids, falls from the high and rolling returns cover only the time their money was in the fund.
 */
export function heldLine(line: IndexPoint[], firstOn: string | null): IndexPoint[] {
  if (!firstOn) return line;
  const start = pointAtOrBefore(line, firstOn);
  const after = line.filter((p) => p.date > firstOn);
  return start ? [start, ...after] : after;
}

const byDate = (a: { date: string }, b: { date: string }) => a.date.localeCompare(b.date);
