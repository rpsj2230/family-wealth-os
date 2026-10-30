/**
 * Profit or loss by week, month, quarter, financial year or calendar year, in rupees and per cent, with a running total and the
 * comparisons people ask for (this period against the one before, one person against another, one fund against another).
 *
 * Invested or taken out is never counted as profit: the profit of a stretch of time is the change in value less the net money
 * that went in (see `chainPeriods`), and the per cent is the time-weighted return of the stretch (its sub-periods joined), so a big
 * deposit does not look like a gain and a withdrawal does not look like a loss. Quarters and years follow the Indian financial year
 * (April to March) except the calendar year. Pure.
 */
import { fyOf } from './tax';
import { addDaysIso } from './harvest-lots';
import { chainReturns, type PerfPeriod } from './return-profile';

export type PlKind = 'week' | 'month' | 'quarter' | 'fy' | 'year';

export const PL_KINDS: { key: PlKind; label: string; unit: string }[] = [
  { key: 'week', label: 'Week', unit: 'week' },
  { key: 'month', label: 'Month', unit: 'month' },
  { key: 'quarter', label: 'Quarter', unit: 'quarter' },
  { key: 'fy', label: 'Financial year', unit: 'financial year' },
  { key: 'year', label: 'Calendar year', unit: 'calendar year' },
];

export const parsePlKind = (v: string | null | undefined): PlKind =>
  PL_KINDS.some((k) => k.key === v) ? (v as PlKind) : 'month';

export interface PlBucket {
  key: string;
  label: string;
  /** the first and last day the bucket is worked out from */
  from: string;
  to: string;
  /** rupees: the change in value less the money added less withdrawn */
  gain: number;
  /** the time-weighted return of the bucket; null when no money was at work */
  ret: number | null;
  netIn: number;
  startValue: number;
  endValue: number;
  /** the bucket is not over yet, or the history began part-way through it */
  partial: boolean;
  /** some of it rests on cash flows worked out from a start date and SIP rather than a statement */
  estimated: boolean;
  /** running totals from the first bucket shown: rupees, and the joined return */
  cumGain: number;
  cumRet: number | null;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The Monday of the week a date falls in. */
export function weekStart(d: string): string {
  const wd = new Date(`${d}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDaysIso(d, -((wd + 6) % 7));
}

const dm = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;

/** Which bucket a date belongs to, with the words for it and the first and last day of the bucket. */
export function bucketOf(
  date: string,
  kind: PlKind,
): { key: string; label: string; start: string; end: string } {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  switch (kind) {
    case 'week': {
      const s = weekStart(date);
      const e = addDaysIso(s, 6);
      return { key: s, label: `${dm(s)} to ${dm(e)}`, start: s, end: e };
    }
    case 'month': {
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      return {
        key: date.slice(0, 7),
        label: `${MON[m - 1]} ${y}`,
        start: `${date.slice(0, 7)}-01`,
        end: last,
      };
    }
    case 'quarter': {
      const fyStart = m >= 4 ? y : y - 1;
      const q = Math.floor(((m - 4 + 12) % 12) / 3); // 0..3 from April
      const firstMonth = ((3 + q * 3) % 12) + 1;
      const startYear = firstMonth >= 4 ? fyStart : fyStart + 1;
      const lastMonth = ((firstMonth + 1) % 12) + 1;
      const endYear = lastMonth >= 4 ? fyStart : fyStart + 1;
      const end = new Date(Date.UTC(endYear, lastMonth, 0)).toISOString().slice(0, 10);
      return {
        key: `${fyStart}-Q${q + 1}`,
        label: `Q${q + 1} FY ${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')} (${MON[firstMonth - 1]} to ${MON[lastMonth - 1]})`,
        start: `${startYear}-${String(firstMonth).padStart(2, '0')}-01`,
        end,
      };
    }
    case 'fy': {
      const fy = fyOf(date);
      const s = Number(fy.slice(0, 4));
      return { key: fy, label: `FY ${fy}`, start: `${s}-04-01`, end: `${s + 1}-03-31` };
    }
    default:
      return { key: String(y), label: String(y), start: `${y}-01-01`, end: `${y}-12-31` };
  }
}

/**
 * Groups the periods of `chainPeriods` into buckets, oldest first. A period belongs to the bucket its last day falls in. Weeks are
 * only built for the latest `weeks` weeks, because older history is valued month by month and cannot be cut into weeks.
 * `estimatedSince` is the first day any estimated cash flow could matter (null when every flow is from a statement).
 */
export function periodPL(
  periods: PerfPeriod[],
  kind: PlKind,
  today: string,
  opts: { weeks: number; estimatedSince: string | null },
): PlBucket[] {
  const weekFloor = kind === 'week' ? weekStart(addDaysIso(today, -7 * (opts.weeks - 1))) : null;
  const by = new Map<string, { b: ReturnType<typeof bucketOf>; list: PerfPeriod[] }>();
  for (const p of periods) {
    const b = bucketOf(p.to, kind);
    if (weekFloor !== null && b.start < weekFloor) continue;
    const e = by.get(b.key) ?? { b, list: [] };
    e.list.push(p);
    by.set(b.key, e);
  }
  const first = periods[0]?.from ?? null;
  let cum = 0;
  const rets: (number | null)[] = [];
  return [...by.values()]
    .sort((a, c) => a.b.start.localeCompare(c.b.start))
    .map(({ b, list }) => {
      const gain = list.reduce((a, p) => a + p.gain, 0);
      const ret = list.some((p) => p.ret !== null) ? chainReturns(list.map((p) => p.ret)) : null;
      cum += gain;
      rets.push(ret);
      const to = list[list.length - 1]!.to;
      const from = list[0]!.from;
      return {
        key: b.key,
        label: b.label,
        from,
        to,
        gain,
        ret,
        netIn: list.reduce((a, p) => a + p.flow, 0),
        startValue: list[0]!.startValue,
        endValue: list[list.length - 1]!.endValue,
        partial: to < b.end || (first !== null && from >= b.start),
        estimated: opts.estimatedSince !== null && to >= opts.estimatedSince,
        cumGain: cum,
        cumRet: chainReturns(rets),
      };
    });
}

/** The latest `n` buckets (or all of them); the running totals are worked out again from the first one kept. */
export function lastBuckets(buckets: PlBucket[], n: number): PlBucket[] {
  const keep = buckets.slice(-Math.max(1, n));
  let cum = 0;
  const rets: (number | null)[] = [];
  return keep.map((b) => {
    cum += b.gain;
    rets.push(b.ret);
    return { ...b, cumGain: cum, cumRet: chainReturns(rets) };
  });
}

export interface PlCompare {
  current: PlBucket;
  previous: PlBucket;
  /** this one less the one before, in rupees and in return points (0.02 = two points) */
  diffGain: number;
  diffRet: number | null;
  /** the current bucket is not over yet, so the comparison is of a part against a whole */
  partial: boolean;
}

/** The latest bucket against the one before it. Null with fewer than two buckets. */
export function compareWithPrevious(buckets: PlBucket[]): PlCompare | null {
  if (buckets.length < 2) return null;
  const current = buckets[buckets.length - 1]!;
  const previous = buckets[buckets.length - 2]!;
  return {
    current,
    previous,
    diffGain: current.gain - previous.gain,
    diffRet: current.ret !== null && previous.ret !== null ? current.ret - previous.ret : null,
    partial: current.partial,
  };
}

export interface PlSeries {
  id: string;
  label: string;
  /** the colour the page gives this series (a person's colour or a palette slot) */
  colour: string;
  buckets: PlBucket[];
}

export interface PlRow {
  key: string;
  label: string;
  partial: boolean;
  cells: { id: string; gain: number | null; ret: number | null; estimated: boolean }[];
}

/** Lines several series up by bucket, oldest first, for a side-by-side table and grouped bars. A series with no bucket there has no figure. */
export function alignSeries(series: PlSeries[], limit: number): PlRow[] {
  const keys = new Map<string, { label: string; start: string; partial: boolean }>();
  for (const s of series)
    for (const b of s.buckets) {
      const e = keys.get(b.key);
      keys.set(b.key, {
        label: b.label,
        start: e?.start ?? b.from,
        partial: (e?.partial ?? false) || b.partial,
      });
    }
  return [...keys.entries()]
    .sort(([, a], [, b]) => a.start.localeCompare(b.start))
    .slice(-Math.max(1, limit))
    .map(([key, k]) => ({
      key,
      label: k.label,
      partial: k.partial,
      cells: series.map((s) => {
        const b = s.buckets.find((x) => x.key === key);
        return {
          id: s.id,
          gain: b ? b.gain : null,
          ret: b ? b.ret : null,
          estimated: b ? b.estimated : false,
        };
      }),
    }));
}
