import { type FdForFiling } from '@fwos/core';
import { loadFdsForFiling as load } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';

/** FDs of the household in the shape the filing working papers need. */
export async function loadFdsForFiling(
  supabase: Ctx['supabase'],
): Promise<{ fds: FdForFiling[]; ownerNames: Record<string, string> }> {
  return load(supabase as unknown as SupabaseClient);
}

/** Optional TDS rate from the query string (e.g. 0.30). null = do not estimate. */
export function parseRate(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}
