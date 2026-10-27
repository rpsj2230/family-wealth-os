/**
 * Rebuilds the net-worth history from what is on file and stores it as snapshots marked "rebuilt" (see core snapshot-rebuild.ts).
 * Only adds: a day recorded on the day is never touched (the database function refuses it too), nothing is deleted, and running it
 * again gives the same rows. Used by the button on Import > History and by the step that follows a history import.
 */
import { planSnapshotRebuild, type RebuildPlan } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPositionInput } from './position';
import { loadPortfolioData } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';

export interface RebuildResult {
  ok: boolean;
  /** months stored (added or refreshed) */
  written: number;
  /** month ends planned */
  planned: number;
  /** month ends left alone because a snapshot recorded on the day exists */
  keptRecorded: number;
  /** month ends with nothing held */
  empty: number;
  from: string | null;
  error?: string;
}

const CHUNK = 40;

/** The snapshots stored so far for the household: the day and where each came from. */
export async function loadSnapshotSources(
  db: SupabaseClient,
  householdId?: string,
): Promise<{ takenOn: string; source: string }[]> {
  const rows = await pageAll<{ taken_on: string; source: string }>((from, to) => {
    const q = db.from('snapshots').select('taken_on, source');
    return (householdId ? q.eq('household_id', householdId) : q)
      .order('taken_on')
      .range(from, to);
  });
  return rows.map((r) => ({ takenOn: r.taken_on, source: r.source }));
}

export async function rebuildSnapshots(
  db: SupabaseClient,
  householdId: string,
  opts: { today?: Date } = {},
): Promise<RebuildResult> {
  const empty: RebuildResult = {
    ok: true,
    written: 0,
    planned: 0,
    keptRecorded: 0,
    empty: 0,
    from: null,
  };
  try {
    const loaded = await loadPortfolioData(db, {
      householdId,
      ...(opts.today ? { today: opts.today } : {}),
    });
    if (loaded.assetRows.length === 0) return empty;
    const { config } = await loadSettings(db, householdId);
    const input = await loadPositionInput(db, loaded, { householdId, config, allPrices: true });
    const plan: RebuildPlan = planSnapshotRebuild(input, await loadSnapshotSources(db, householdId));
    let written = 0;
    for (let i = 0; i < plan.payloads.length; i += CHUNK) {
      const r = await db.rpc('backfill_snapshots', {
        p_household: householdId,
        p: plan.payloads.slice(i, i + CHUNK),
      });
      if (r.error) throw new Error(r.error.message);
      written += Number(r.data ?? 0);
    }
    return {
      ok: true,
      written,
      planned: plan.payloads.length,
      keptRecorded: plan.keptRecorded.length,
      empty: plan.empty.length,
      from: plan.from,
    };
  } catch (e) {
    return { ...empty, ok: false, error: (e as Error).message };
  }
}
