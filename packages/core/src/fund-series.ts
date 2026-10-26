/**
 * How a fund (or all funds) progressed: value against the money put in, month by month, and where that leads if the pace holds.
 * The best source wins for each month: the transaction ledger times the fund's price on that date, then a recorded snapshot, then a
 * recorded value. Pure: the caller supplies what is stored.
 */
export interface SeriesPoint {
  date: string;
  value: number;
  /** cost of the units held on that date; null when it is not known */
  invested: number | null;
}

export interface FundHistory {
  /** units bought (positive) or sold (negative), with the rupees paid or received */
  txns: { date: string; units: number; amount: number }[];
  /** prices, oldest first */
  navs: { date: string; nav: number }[];
  /** recorded values, oldest first */
  observations: { date: string; value: number }[];
  snapshots: { date: string; value: number; invested: number | null }[];
  plan?: { invested: number; startedOn: string | null };
}

const lastOnOrBefore = <T extends { date: string }>(
  list: T[],
  d: string,
  maxGapDays = Infinity,
): T | null => {
  let best: T | null = null;
  for (const x of list) {
    if (x.date > d) break;
    best = x;
  }
  if (!best) return null;
  const gap = (Date.parse(`${d}T00:00:00Z`) - Date.parse(`${best.date}T00:00:00Z`)) / 86_400_000;
  return gap <= maxGapDays ? best : null;
};

/** The last day of every month from the month of `from` up to the month of `to`, and `to` itself last. */
export function monthEnds(from: string, to: string): string[] {
  const out: string[] = [];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let i = 0; i < 1200; i++) {
    const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    if (end >= to) break;
    out.push(end);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  out.push(to);
  return out;
}

export function fundSeries(
  h: FundHistory,
  today: string,
  current?: { value: number; invested: number | null },
): SeriesPoint[] {
  const txns = [...h.txns].sort((a, b) => a.date.localeCompare(b.date));
  const firsts = [
    txns[0]?.date,
    h.observations[0]?.date,
    h.snapshots[0]?.date,
    h.plan?.startedOn ?? undefined,
  ].filter((x): x is string => !!x);
  if (firsts.length === 0)
    return current ? [{ date: today, value: current.value, invested: current.invested }] : [];
  const start = firsts.sort()[0]!;
  const points: SeriesPoint[] = [];
  // units and cost held after each transaction (a sale takes out the same share of both)
  const held: { date: string; units: number; invested: number }[] = [];
  let units = 0;
  let invested = 0;
  for (const t of txns) {
    if (t.units > 0) {
      units += t.units;
      invested += Math.abs(t.amount);
    } else if (t.units < 0) {
      const share = units > 0 ? Math.min(1, -t.units / units) : 1;
      invested -= invested * share;
      units = Math.max(0, units + t.units);
    }
    held.push({ date: t.date, units, invested });
  }
  for (const d of monthEnds(start, today)) {
    const hold = lastOnOrBefore(held, d);
    const nav = lastOnOrBefore(h.navs, d, 12);
    if (hold && nav) {
      points.push({ date: d, value: hold.units * nav.nav, invested: hold.invested });
      continue;
    }
    const snap = lastOnOrBefore(h.snapshots, d);
    if (snap) {
      points.push({ date: d, value: snap.value, invested: snap.invested });
      continue;
    }
    const obs = lastOnOrBefore(h.observations, d);
    if (obs)
      points.push({
        date: d,
        value: obs.value,
        invested: hold
          ? hold.invested
          : h.plan?.startedOn && d >= h.plan.startedOn
            ? h.plan.invested
            : null,
      });
  }
  if (current) {
    const last = points[points.length - 1];
    if (last && last.date === today)
      points[points.length - 1] = {
        date: today,
        value: current.value,
        invested: current.invested ?? last.invested,
      };
    else points.push({ date: today, value: current.value, invested: current.invested });
  }
  return points;
}

/** Adds several funds together month by month, carrying each fund's last known figures forward. */
export function combineSeries(all: SeriesPoint[][]): SeriesPoint[] {
  const dates = [...new Set(all.flatMap((s) => s.map((p) => p.date)))].sort();
  const out: SeriesPoint[] = [];
  for (const d of dates) {
    let value = 0;
    let invested = 0;
    let known = 0;
    let anyInvested = false;
    for (const s of all) {
      const p = lastOnOrBefore(s, d);
      if (!p) continue;
      known += 1;
      value += p.value;
      if (p.invested !== null) {
        invested += p.invested;
        anyInvested = true;
      }
    }
    if (known > 0)
      out.push({
        date: d,
        value: Math.round(value),
        invested: anyInvested ? Math.round(invested) : null,
      });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
// If the pace holds
// ------------------------------------------------------------------------------------------------
/** Value after `months` of growing at `annualReturn` (a fraction a year) with `monthly` added at the end of every month. */
export function corpusValue(
  value: number,
  monthly: number,
  annualReturn: number,
  months: number,
): number {
  const rm = Math.pow(1 + annualReturn, 1 / 12) - 1;
  if (Math.abs(rm) < 1e-12) return value + monthly * months;
  const g = Math.pow(1 + rm, months);
  return value * g + monthly * ((g - 1) / rm);
}

export interface Projection {
  years: number;
  date: string;
  /** a slower, expected and faster path: the return less and plus `spread` */
  low: number;
  expected: number;
  high: number;
  /** of which money still to be put in */
  contributions: number;
}

const addYears = (iso: string, y: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCFullYear(d.getUTCFullYear() + y);
  return d.toISOString().slice(0, 10);
};

export function projectCorpus(args: {
  today: string;
  value: number;
  monthly: number;
  annualReturn: number;
  horizons: number[];
  spread?: number;
}): Projection[] {
  const r = Math.max(-0.5, Math.min(0.4, args.annualReturn));
  const spread = args.spread ?? 0.03;
  return args.horizons
    .filter((y) => y > 0)
    .map((y) => ({
      years: y,
      date: addYears(args.today, y),
      low: Math.round(corpusValue(args.value, args.monthly, Math.max(0, r - spread), y * 12)),
      expected: Math.round(corpusValue(args.value, args.monthly, r, y * 12)),
      high: Math.round(corpusValue(args.value, args.monthly, r + spread, y * 12)),
      contributions: Math.round(args.monthly * y * 12),
    }));
}

/** Points for a chart: the expected path at the end of each year up to the longest horizon. */
export function projectionPath(args: {
  today: string;
  value: number;
  monthly: number;
  annualReturn: number;
  years: number;
}): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let y = 1; y <= args.years; y++)
    out.push({
      date: addYears(args.today, y),
      value: Math.round(corpusValue(args.value, args.monthly, args.annualReturn, y * 12)),
      invested: null,
    });
  return out;
}

/** How fast a series has been moving over its last (up to) twelve months. */
export function paceFromSeries(
  points: { date: string; value: number }[],
): { monthlyChange: number; annualGrowth: number | null; months: number } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = addYears(last.date, -1);
  const base = [...points].reverse().find((p) => p.date <= cutoff) ?? points[0]!;
  const months = Math.max(
    1,
    Math.round(
      (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${base.date}T00:00:00Z`)) /
        (30.4375 * 86_400_000),
    ),
  );
  if (base.date >= last.date) return null;
  return {
    monthlyChange: (last.value - base.value) / months,
    annualGrowth: base.value > 0 ? Math.pow(last.value / base.value, 12 / months) - 1 : null,
    months,
  };
}
