/**
 * A fund's units rebuilt from the plan the household gave, for a fund with no transaction ledger and no unit count: the start date, the
 * money invested, the SIP amount and every change of it with its date. Each instalment buys `amount / NAV` units, at the price of the
 * day it is due or, when the fund was not priced that day (a weekend, a holiday), of the next day it was, as the fund house does. One
 * function for every place a fund's value is worked out (Home, Investments, Value by period, the daily summary), so a fund is worth
 * `units held that day times the price of that day` whether the units come from a statement or from this plan.
 *
 * What the plan can and cannot say:
 *  - the instalments are the plan's own (`plannedInstalments`: the amount in force on each date, none after a stop);
 *  - the money in is checked against the amount invested that the household recorded (as of the day it was last recorded): if the plan
 *    puts in less, the difference is an opening purchase on the start date (the part of the money the plan does not explain, bought at
 *    the start); if the plan puts in more, every instalment is scaled down so the plan's money in equals the amount invested (units
 *    are never invented beyond the money the household says it put in);
 *  - an instalment with no price at all on or soon after its day (before the scheme existed, or not priced yet) is left out until it
 *    has one, and counted in `skipped`.
 * Everything here is an estimate and is labelled so. A statement or ledger takes over the moment it is on file. Pure; no I/O.
 */
import { plannedInstalments, type SipPlan } from './estimate';

export interface PlanLine {
  /** the day the money went in */
  date: string;
  /** rupees put in */
  amount: number;
  /** the opening purchase (money the instalments do not explain) or a SIP instalment */
  kind: 'opening' | 'sip';
  /** the price used and the day it is from (the due day, or the next priced day) */
  nav: number;
  navDate: string;
  units: number;
}

export interface PlanLedger {
  /** oldest first */
  lines: PlanLine[];
  /** total rupees put in by the lines */
  moneyIn: number;
  /** how the plan was made to agree with the amount invested: as is, an opening purchase added, or the instalments scaled down */
  adjusted: 'none' | 'opening' | 'scaled';
  /** the amount invested less the plan's money in on the day it was recorded, before the adjustment (rupees; 0 when none was recorded) */
  gap: number;
  /** instalments left out because no price was known for them */
  skipped: number;
  /** units held after the last line */
  units: number;
}

export interface PlanSpec {
  /** the day the fund was started (the first instalment, or the one purchase) */
  startedOn: string | null;
  /** the money invested in total, as recorded (0 or null when not recorded) */
  invested: number | null;
  /** the day the amount invested was recorded; the instalments after it are not in it. Null: today */
  investedAsOf: string | null;
  sip: SipPlan | null;
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const dayBefore = (d: string) => {
  const t = utc(d);
  t.setUTCDate(t.getUTCDate() - 1);
  return t;
};
const daysApart = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

/** The first price on or after a day, within `gapDays` of it (the price the fund house deals at); null when there is none. */
export function navOnOrAfter(
  navs: { date: string; nav: number }[],
  date: string,
  gapDays: number,
): { date: string; nav: number } | null {
  let lo = 0;
  let hi = navs.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (navs[mid]!.date >= date) {
      hit = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  const n = hit >= 0 ? navs[hit]! : null;
  return n && n.nav > 0 && daysApart(date, n.date) <= gapDays ? n : null;
}

/**
 * The fund's purchases rebuilt from its plan, with the units each bought at the price of its day; null when there is nothing to build
 * from (no start date and no plan, no amount invested, no prices).
 * `tolerance` is the share of the amount invested the plan may be out by before it is adjusted (Settings).
 */
export function planLedger(
  spec: PlanSpec,
  navs: { date: string; nav: number }[],
  today: string,
  opts: { gapDays: number; tolerance: number; includeSip?: boolean | undefined },
): PlanLedger | null {
  if (navs.length === 0 || !spec.startedOn || spec.startedOn > today) return null;
  const invested = spec.invested !== null && spec.invested > 0 ? spec.invested : 0;
  const instalments =
    opts.includeSip === false
      ? []
      : plannedInstalments(spec.sip, dayBefore(spec.startedOn), utc(today));
  if (instalments.length === 0 && invested === 0) return null;

  const asOf = spec.investedAsOf && spec.investedAsOf < today ? spec.investedAsOf : today;
  const planned = instalments.filter((i) => i.date <= asOf).reduce((a, i) => a + i.amount, 0);
  const gap = invested > 0 ? invested - planned : 0;
  let adjusted: PlanLedger['adjusted'] = 'none';
  let scale = 1;
  let opening = 0;
  if (invested > 0) {
    if (instalments.length === 0) {
      opening = invested;
      adjusted = 'opening';
    } else if (gap > invested * opts.tolerance) {
      opening = gap;
      adjusted = 'opening';
    } else if (gap < -invested * opts.tolerance && planned > 0) {
      scale = invested / planned;
      adjusted = 'scaled';
    }
  }

  const raw: { date: string; amount: number; kind: PlanLine['kind'] }[] = [
    ...(opening > 0 ? [{ date: spec.startedOn, amount: opening, kind: 'opening' as const }] : []),
    ...instalments.map((i) => ({ date: i.date, amount: i.amount * scale, kind: 'sip' as const })),
  ];
  const lines: PlanLine[] = [];
  let skipped = 0;
  for (const r of raw) {
    const n = navOnOrAfter(navs, r.date, opts.gapDays);
    if (!n) {
      skipped++;
      continue;
    }
    lines.push({ ...r, nav: n.nav, navDate: n.date, units: r.amount / n.nav });
  }
  if (lines.length === 0) return null;
  return {
    lines,
    moneyIn: lines.reduce((a, l) => a + l.amount, 0),
    adjusted,
    gap,
    skipped,
    units: lines.reduce((a, l) => a + l.units, 0),
  };
}

/** Units held on a day: every purchase up to and including it. */
export function planUnitsOn(ledger: PlanLedger, on: string): number {
  let u = 0;
  for (const l of ledger.lines) {
    if (l.date > on) break;
    u += l.units;
  }
  return u;
}
