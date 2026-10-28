/**
 * Funds with no price source: held mutual funds that are not matched to an official scheme (no `amfi_code`), so their value is only
 * what was last recorded. A fund the person has said is not a listed fund (`no_price_source`) is not waiting for a match, so it is not
 * counted here. Read only; works with a user client (RLS) or the service role.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { columnExists } from './columns';

export interface FundAssetLike {
  id: string;
  type: string;
  status: string;
  amfi_code?: string | null;
}

export interface UnpricedFunds {
  /** held funds waiting for a match */
  waiting: string[];
  /** held funds the person marked "not a listed fund" */
  notListed: string[];
}

export async function unpricedFunds(
  db: SupabaseClient,
  assets: FundAssetLike[],
  householdId?: string,
): Promise<UnpricedFunds> {
  // a fund whose SIP was stopped is still held; a closed (sold) fund has nothing to price
  const open = assets.filter(
    (a) =>
      a.type === 'mutual_fund' && (a.status === 'active' || a.status === 'stopped') && !a.amfi_code,
  );
  if (open.length === 0) return { waiting: [], notListed: [] };
  const marked = new Set<string>();
  if (await columnExists(db, 'mf_positions', 'no_price_source')) {
    const q = db.from('mf_positions').select('asset_id').eq('no_price_source', true);
    const r = await (householdId ? q.eq('household_id', householdId) : q);
    for (const p of (r.data ?? []) as unknown as { asset_id: string }[]) marked.add(p.asset_id);
  }
  return {
    waiting: open.filter((a) => !marked.has(a.id)).map((a) => a.id),
    notListed: open.filter((a) => marked.has(a.id)).map((a) => a.id),
  };
}
