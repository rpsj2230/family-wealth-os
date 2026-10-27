import { fyBounds, type RealisedRow } from '@fwos/core';
import { pageAll } from './paging';
import { fundLedger, type CasTxn } from '@fwos/ingest';
import { loadSettings } from './settings';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Every sale of fund units in a financial year, matched to the purchases it used (oldest first), from the fund statements. */
export async function loadRealisedGains(
  db: SupabaseClient,
  fy: string,
  householdId?: string,
): Promise<{ rows: RealisedRow[]; ownerNames: Record<string, string>; funds: number }> {
  const { start, end } = fyBounds(fy);
  const sel = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return householdId ? q.eq('household_id', householdId) : q;
  };
  const [tx, pos, assets, owners] = await Promise.all([
    pageAll<{
      asset_id: string;
      txn_on: string;
      kind: CasTxn['kind'];
      amount: number;
      units: number;
      nav: number | null;
      balance_units: number | null;
      description: string | null;
      source: string | null;
    }>((from, to) =>
      sel(
        'mf_transactions',
        'asset_id, txn_on, kind, amount, units, nav, balance_units, description, source',
      )
        .order('txn_on', { ascending: true })
        .order('id')
        .range(from, to),
    ),
    sel('mf_positions', 'asset_id, fund_name, invested, isin'),
    sel('assets', 'id, owner_id').eq('type', 'mutual_fund'),
    sel('owners', 'id, display_name'),
  ]);
  const posOf = new Map(
    (
      (pos.data ?? []) as unknown as {
        asset_id: string;
        fund_name: string;
        invested: number | null;
        isin: string | null;
      }[]
    ).map((p) => [p.asset_id, p]),
  );
  const ownerOf = new Map(
    ((assets.data ?? []) as unknown as { id: string; owner_id: string }[]).map((a) => [
      a.id,
      a.owner_id,
    ]),
  );
  const unitTolerance = (await loadSettings(db, householdId)).config.funds.unitTolerance;
  const byAsset = new Map<string, (CasTxn & { source: string | null })[]>();
  for (const t of tx)
    byAsset.set(t.asset_id, [
      ...(byAsset.get(t.asset_id) ?? []),
      {
        date: t.txn_on,
        kind: t.kind,
        description: t.description ?? '',
        amount: Number(t.amount),
        units: Number(t.units),
        nav: t.nav === null ? null : Number(t.nav),
        balance: t.balance_units === null ? null : Number(t.balance_units),
        source: t.source,
      },
    ]);
  const rows: RealisedRow[] = [];
  for (const [assetId, txns] of byAsset) {
    const owner = ownerOf.get(assetId);
    const p = posOf.get(assetId);
    if (!owner || !p) continue;
    // same-day lines are put in the order their running balance gives, so a sale and a purchase on one day cannot swap places
    const res = fundLedger({
      txns,
      costValue: Number(p.invested ?? 0) || null,
      unitsHeld: null,
      unitTolerance,
    });
    for (const x of res.realised)
      if (x.soldOn >= start && x.soldOn <= end)
        rows.push({
          ownerId: owner,
          fund: p.fund_name,
          isin: p.isin,
          soldOn: x.soldOn,
          // units from before the statement have no known date or cost
          acquiredOn: x.acquiredOn === '1900-01-01' ? '1900-01-01' : x.acquiredOn,
          units: x.units,
          proceeds: x.proceeds,
          cost: x.cost,
        });
  }
  return {
    rows,
    funds: byAsset.size,
    ownerNames: Object.fromEntries(
      ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map((o) => [
        o.id,
        o.display_name,
      ]),
    ),
  };
}
