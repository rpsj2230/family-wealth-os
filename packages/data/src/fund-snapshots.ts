import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';

/**
 * Writes today's units, price, value and amount invested for every fund, so the history of each fund (and of all funds together)
 * keeps growing every day without anyone typing anything. A snapshot entered by hand for the same day is never overwritten.
 * Returns how many were written.
 */
export async function recordFundSnapshots(
  db: SupabaseClient,
  householdId: string,
  today?: Date,
): Promise<number> {
  const l = await loadPortfolioData(db, { householdId, ...(today ? { today } : {}) });
  const pos = (
    await db.from('mf_positions').select('asset_id, invested').eq('household_id', householdId)
  ).data as { asset_id: string; invested: number | null }[] | null;
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null]),
  );
  const asOf = l.today.toISOString().slice(0, 10);
  const rows = (pos ?? [])
    .map((p) => {
      const v = value.get(p.asset_id);
      const info = l.fundInfo[p.asset_id];
      if (v === null || v === undefined || !(v >= 0)) return null;
      return {
        asset_id: p.asset_id,
        household_id: householdId,
        as_of: asOf,
        units: info?.units ?? null,
        nav: info?.nav ?? null,
        value: Math.round(v * 100) / 100,
        invested: p.invested === null ? null : Number(p.invested),
        source: 'daily',
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);
  if (rows.length === 0) return 0;
  const { error } = await db
    .from('mf_snapshots')
    .upsert(rows, { onConflict: 'asset_id,as_of', ignoreDuplicates: true });
  if (error) throw new Error(`fund snapshots: ${error.message}`);
  return rows.length;
}
