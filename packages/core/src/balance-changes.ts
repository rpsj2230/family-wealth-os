/**
 * The last two recorded balances of each account and the change between them: what the account held at the previous reading, what
 * it holds at the latest one, and how many days ago that was. A change between two readings is a move in the balance (money in and
 * out, interest, transfers together), never a profit by itself.
 *
 * Pure: no I/O. Superseded readings are left out, and two readings on one day count once (the one entered last), as the latest
 * balance on every other page is chosen.
 */
import type { ObservationRow } from './portfolio';

export interface BalanceChange {
  assetId: string;
  currency: string;
  latest: { date: string; amount: number };
  /** the reading before the latest one, on an earlier day; null when only one is on file */
  previous: { date: string; amount: number } | null;
  /** latest less previous, in the account's own currency; null without a previous reading */
  change: number | null;
  /** days from the latest reading to today */
  days: number;
}

const dayMs = 86_400_000;

export function balanceChanges(
  observations: Pick<
    ObservationRow,
    'asset_id' | 'amount' | 'currency' | 'as_of' | 'created_at' | 'superseded_by'
  >[],
  assetIds: Iterable<string>,
  today: string,
): BalanceChange[] {
  const want = new Set(assetIds);
  const byAsset = new Map<string, Map<string, (typeof observations)[number]>>();
  for (const o of observations) {
    if (o.superseded_by || !want.has(o.asset_id)) continue;
    const days = byAsset.get(o.asset_id) ?? new Map();
    const cur = days.get(o.as_of);
    if (!cur || o.created_at > cur.created_at) days.set(o.as_of, o);
    byAsset.set(o.asset_id, days);
  }
  const out: BalanceChange[] = [];
  for (const [assetId, days] of byAsset) {
    const sorted = [...days.values()].sort((a, b) => b.as_of.localeCompare(a.as_of));
    const last = sorted[0]!;
    const prev = sorted[1] ?? null;
    out.push({
      assetId,
      currency: last.currency,
      latest: { date: last.as_of, amount: Number(last.amount) },
      previous: prev ? { date: prev.as_of, amount: Number(prev.amount) } : null,
      change: prev ? Number(last.amount) - Number(prev.amount) : null,
      days: Math.round(
        (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${last.as_of}T00:00:00Z`)) / dayMs,
      ),
    });
  }
  return out;
}
