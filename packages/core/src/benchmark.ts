/**
 * Comparing a portfolio with a benchmark. The benchmark is a proxy: the price (NAV) of an index fund that tracks the Nifty 50, fetched
 * free from AMFI and mfapi like any other fund. It is not the index itself (it carries the fund's small expenses and tracking
 * difference), and the page says so wherever it is shown.
 *
 * The fairest comparison for a person who invests every month is "the same money, on the same days, in the index fund": the
 * what-if below. Pure.
 */
import { xirr } from './xirr';
import { daysBetweenIso as daysBetween } from './fund-timeline';
import { pointAtOrBefore, type Flow, type IndexPoint } from './return-profile';

export interface WhatIf {
  /** what the same money would be worth today in the benchmark */
  value: number;
  /** money put in less money taken out, for the flows the benchmark's history covers */
  netIn: number;
  gain: number;
  /** the annual return of those flows (XIRR); null when it cannot be solved */
  xirr: number | null;
  /** the share of the money put in (in rupees) that the benchmark's history reaches back to */
  coverage: number;
  /** flows before the benchmark's first price, left out */
  skipped: number;
}

/**
 * Puts every purchase into the benchmark at that day's price and takes every sale out of it, then values what is left at the latest
 * price. A flow on a day with no price uses the last price before it (within `gapDays`); a flow earlier than the benchmark's history
 * is left out and counted in `skipped`, and `coverage` says how much of the money that leaves out.
 */
export function benchmarkWhatIf(args: {
  flows: Flow[];
  navs: IndexPoint[];
  today: string;
  gapDays: number;
}): WhatIf | null {
  const navs = [...args.navs].sort((a, b) => a.date.localeCompare(b.date));
  const end = pointAtOrBefore(navs, args.today);
  if (!end || navs.length < 2) return null;
  const flows = [...args.flows]
    .filter((f) => f.amount !== 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (flows.length === 0) return null;
  let units = 0;
  let netIn = 0;
  let skipped = 0;
  let inAll = 0;
  let inUsed = 0;
  const cash: { date: Date; amount: number }[] = [];
  for (const f of flows) {
    if (f.amount > 0) inAll += f.amount;
    const px =
      pointAtOrBefore(navs, f.date, args.gapDays) ??
      navs.find((n) => n.date >= f.date && daysBetween(f.date, n.date) <= args.gapDays);
    if (!px || !(px.value > 0)) {
      skipped += 1;
      continue;
    }
    if (f.amount > 0) inUsed += f.amount;
    units = Math.max(0, units + f.amount / px.value);
    netIn += f.amount;
    cash.push({ date: new Date(`${f.date}T00:00:00Z`), amount: -f.amount });
  }
  if (cash.length === 0) return null;
  const value = units * end.value;
  cash.push({ date: new Date(`${end.date}T00:00:00Z`), amount: value });
  const r = xirr(cash);
  return {
    value,
    netIn,
    gain: value - netIn,
    xirr:
      r.rate !== null && (r.status === 'ok' || r.status === 'ok_multiple_roots') ? r.rate : null,
    coverage: inAll > 0 ? inUsed / inAll : 1,
    skipped,
  };
}

export interface Versus {
  key: string;
  yours: number | null;
  benchmark: number | null;
  /** yours less the benchmark, in percentage points as a fraction (0.02 = two points ahead) */
  diff: number | null;
}

/** Puts two sets of returns side by side by period key and works out the difference where both exist. */
export function versus(
  yours: { key: string; ret: number | null }[],
  bench: { key: string; ret: number | null }[],
): Versus[] {
  const b = new Map(bench.map((x) => [x.key, x.ret]));
  return yours.map((y) => {
    const o = b.get(y.key) ?? null;
    return {
      key: y.key,
      yours: y.ret,
      benchmark: o,
      diff: y.ret !== null && o !== null ? y.ret - o : null,
    };
  });
}
