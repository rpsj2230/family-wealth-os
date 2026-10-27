/**
 * The net-worth history, rebuilt. Past month ends are worked out by the position engine (position.ts) and stored as snapshots marked
 * "rebuilt from history", so the trend chart and "since the start" have a point for every month the data reaches back to.
 *
 * Safe by construction: it only adds. A day that already has a snapshot recorded on the day is never planned (the database function
 * refuses it too); a day that has a rebuilt one is planned again, so running it twice gives the same rows; nothing is deleted.
 */
import type { Basis } from './estimate';
import { monthEnds } from './fund-series';
import {
  dataStarts,
  positionAsOf,
  type DayPosition,
  type PositionInput,
  type ValueBasis,
} from './position';
import type { SnapshotPayload } from './snapshot';

/** Where a stored snapshot came from: recorded on the day, or rebuilt from the history on file. */
export type SnapshotSource = 'daily' | 'import' | 'monthly_update' | 'manual' | 'rebuilt';
export const isRebuilt = (source: string | null | undefined) => source === 'rebuilt';
export const REBUILT_LABEL = 'rebuilt from history';
export const RECORDED_LABEL = 'recorded on the day';

const BASIS: Record<ValueBasis, Basis> = {
  recorded: 'carried_forward',
  terms: 'calculated',
  bank_amount: 'calculated',
  units_nav: 'calculated',
  rate: 'estimated',
  nav_scaled: 'estimated',
  sheet: 'estimated',
  fx: 'estimated',
  assumed: 'estimated',
};

/** A day's position in the shape a snapshot is stored in. */
export function snapshotFromPosition(p: DayPosition): SnapshotPayload {
  const basis: Record<Basis, number> = { calculated: 0, estimated: 0, carried_forward: 0 };
  for (const h of p.holdings)
    if (h.state === 'held' && h.value !== null && h.basis) basis[BASIS[h.basis]] += h.value;
  return {
    takenOn: p.date,
    total: p.total,
    investable: p.investable,
    byOwner: p.byOwner,
    byLiquidity: p.byLiquidity,
    byType: p.byType as Record<string, number>,
    components: {
      anchorTotal: basis.carried_forward + basis.calculated,
      interest: 0,
      market: 0,
      fx: 0,
    },
    basis,
    counted: p.counted,
    excluded: p.noData,
    latestRecordedAsOf: p.latestRecordedAsOf,
    status: p.noData > 0 ? 'has_exclusions' : 'complete',
  };
}

export interface RebuildPlan {
  /** the snapshots to store, oldest first */
  payloads: SnapshotPayload[];
  /** month ends that already have a snapshot recorded on the day: left as they are */
  keptRecorded: string[];
  /** month ends that had nothing counted at all: not stored */
  empty: string[];
  /** the first day the data reaches back to */
  from: string | null;
}

/**
 * The snapshots to add: every month end from the month the data starts in up to the last one before today, except where a snapshot
 * recorded on the day exists. A month end where nothing was held yet is not stored.
 */
export function planSnapshotRebuild(
  input: PositionInput,
  existing: { takenOn: string; source: string }[],
): RebuildPlan {
  const today = input.config.today;
  const from = dataStarts(input);
  if (!from) return { payloads: [], keptRecorded: [], empty: [], from: null };
  const recorded = new Set(existing.filter((e) => !isRebuilt(e.source)).map((e) => e.takenOn));
  const payloads: SnapshotPayload[] = [];
  const keptRecorded: string[] = [];
  const empty: string[] = [];
  for (const d of monthEnds(from, today)) {
    if (d >= today) continue;
    if (recorded.has(d)) {
      keptRecorded.push(d);
      continue;
    }
    const p = positionAsOf(input, d);
    if (p.counted === 0) {
      empty.push(d);
      continue;
    }
    payloads.push(snapshotFromPosition(p));
  }
  return { payloads, keptRecorded, empty, from };
}
