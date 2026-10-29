import { cache } from 'react';
import { makeSnapshot } from '@fwos/core';
import { loadPortfolioData, todayDate as _today } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';

type Supabase = Ctx['supabase'];

export const todayDate = _today;

/**
 * Loads everything needed to value the household and returns the built portfolio. RLS limits rows to the caller's household.
 * Once per page: every loader on the page that asks for it shares the one read (the client is the page's own, so the cache key).
 */
export const loadPortfolio = cache(async function loadPortfolio(supabase: Supabase) {
  return loadPortfolioData(supabase as unknown as SupabaseClient);
});

/** Stores today's snapshot (one per day; the latest save of the day wins). Never throws: a snapshot must not break a save. */
export async function recordSnapshot(
  supabase: Supabase,
  householdId: string,
  source: 'daily' | 'import' | 'monthly_update',
) {
  try {
    const { today, obsRows, assetRows, portfolio } = await loadPortfolio(supabase);
    if (assetRows.length === 0) return;
    const latest = obsRows.reduce<string | null>((m, o) => (!m || o.as_of > m ? o.as_of : m), null);
    const snap = makeSnapshot(portfolio.netWorth, today.toISOString().slice(0, 10), latest);
    await supabase.rpc('save_snapshot', { p_household: householdId, p: snap, p_source: source });
  } catch {
    // best effort
  }
}
