/**
 * The daily valuation (brief §12): after the day's prices and exchange rates are in, every household is valued by the central engine
 * and the day's net worth is stored as its snapshot, so the history grows every day whether or not anyone opens the app. One snapshot a
 * day per household; a later run on the same day replaces it (the day's latest knowledge wins). Runs with the service role, so each
 * household is read and written explicitly by its id.
 */
import { makeSnapshot } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';

export interface DailyValuationReport {
  households: number;
  saved: number;
  failed: { household: string; message: string }[];
}

export async function runDailyValuation(
  db: SupabaseClient,
  opts: { today: Date },
): Promise<DailyValuationReport> {
  const takenOn = opts.today.toISOString().slice(0, 10);
  const hh = await db.from('households').select('id');
  if (hh.error) throw new Error(`households: ${hh.error.message}`);
  const report: DailyValuationReport = { households: 0, saved: 0, failed: [] };
  for (const h of (hh.data ?? []) as { id: string }[]) {
    report.households++;
    try {
      const l = await loadPortfolioData(db, { householdId: h.id, today: opts.today });
      if (l.assetRows.length === 0) continue;
      const latest = l.obsRows.reduce<string | null>(
        (m, o) => (!m || o.as_of > m ? o.as_of : m),
        null,
      );
      const s = makeSnapshot(l.portfolio.netWorth, takenOn, latest);
      const r = await db.from('snapshots').upsert(
        {
          household_id: h.id,
          taken_on: s.takenOn,
          total: s.total,
          investable: s.investable,
          by_owner: s.byOwner,
          by_liquidity: s.byLiquidity,
          by_type: s.byType,
          components: s.components,
          basis: s.basis,
          counted: s.counted,
          excluded: s.excluded,
          latest_recorded_as_of: s.latestRecordedAsOf,
          status: s.status,
          source: 'daily',
          created_at: new Date().toISOString(),
        },
        { onConflict: 'household_id,taken_on' },
      );
      if (r.error) throw new Error(r.error.message);
      report.saved++;
    } catch (e) {
      // the household is named by the first part of its id only: no names or amounts in the log
      report.failed.push({ household: h.id.slice(0, 8), message: (e as Error).message });
    }
  }
  return report;
}
