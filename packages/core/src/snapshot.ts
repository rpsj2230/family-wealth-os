import type { Basis } from './estimate';
import type { NetWorthResult } from './networth';

export interface SnapshotPayload {
  takenOn: string; // YYYY-MM-DD
  total: number;
  investable: number;
  byOwner: Record<string, number>;
  byLiquidity: Record<string, number>;
  byType: Record<string, number>;
  /** how the total splits into last-recorded values and what was added since by calculation */
  components: { anchorTotal: number; interest: number; market: number; fx: number };
  basis: Record<Basis, number>;
  counted: number;
  excluded: number;
  /** newest date among the recorded values behind this snapshot */
  latestRecordedAsOf: string | null;
  status: 'complete' | 'has_exclusions';
}

export function makeSnapshot(
  nw: NetWorthResult,
  takenOn: string,
  latestRecordedAsOf: string | null,
): SnapshotPayload {
  return {
    takenOn,
    total: nw.total,
    investable: nw.investableFinancial,
    byOwner: nw.byOwner,
    byLiquidity: nw.byLiquidity,
    byType: nw.byType as Record<string, number>,
    components: {
      anchorTotal: nw.estimateTotals.anchorTotal,
      interest: nw.estimateTotals.interest,
      market: nw.estimateTotals.market,
      fx: nw.estimateTotals.fx,
    },
    basis: nw.estimateTotals.byBasis,
    counted: nw.counted,
    excluded: nw.excluded.length,
    latestRecordedAsOf,
    status: nw.excluded.length > 0 ? 'has_exclusions' : 'complete',
  };
}

export type RangeKey = '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'ALL';
export const RANGES: RangeKey[] = ['1M', '3M', '6M', '1Y', '3Y', '5Y', 'ALL'];
const MONTHS: Record<Exclude<RangeKey, 'ALL'>, number> = {
  '1M': 1,
  '3M': 3,
  '6M': 6,
  '1Y': 12,
  '3Y': 36,
  '5Y': 60,
};

export interface Point {
  date: string;
  value: number;
}

/** Points on or after (today − range). The earliest point inside the window is kept so lines start at the edge. */
export function pointsInRange(points: Point[], range: RangeKey, today: string): Point[] {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  if (range === 'ALL') return sorted;
  const t = new Date(today + 'T00:00:00Z');
  t.setUTCMonth(t.getUTCMonth() - MONTHS[range]);
  const from = t.toISOString().slice(0, 10);
  return sorted.filter((p) => p.date >= from);
}

/** Change between first and last point, as an amount and a fraction; null when fewer than two points exist. */
export function changeOver(points: Point[]): { amount: number; pct: number | null } | null {
  if (points.length < 2) return null;
  const first = points[0]!.value;
  const last = points[points.length - 1]!.value;
  return { amount: last - first, pct: first !== 0 ? (last - first) / Math.abs(first) : null };
}
