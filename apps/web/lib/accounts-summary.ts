import type { AssetRow, ObservationRow } from '@fwos/core';

/** The latest recorded value of each asset (an earlier value replaced by a correction is ignored). */
export function latestObservations(obs: ObservationRow[]) {
  const latest = new Map<
    string,
    { as_of: string; amount: number; currency: string; fx_rate: number | null; source: string }
  >();
  for (const o of obs) {
    if (o.superseded_by) continue;
    const cur = latest.get(o.asset_id);
    if (!cur || o.as_of > cur.as_of)
      latest.set(o.asset_id, {
        as_of: o.as_of,
        amount: o.amount,
        currency: o.currency,
        fx_rate: o.fx_rate,
        source: o.source,
      });
  }
  return latest;
}

export interface ForeignLine {
  assetId: string;
  ownerId: string;
  name: string;
  currency: string;
  /** the balance in its own currency, with the date it was recorded */
  amount: number | null;
  asOf: string | null;
  /** rupees per unit used today, and the date of that rate */
  rate: number | null;
  rateDate: string | null;
  /** worth in rupees today */
  inr: number | null;
}

/** Active accounts that are not in rupees: the balance as recorded, the exchange rate used and what it is worth in rupees today. */
export function foreignLines(
  assets: AssetRow[],
  obs: ObservationRow[],
  valueInr: Map<string, number | null>,
  fx: Record<string, { rate: number; date: string }>,
): ForeignLine[] {
  const latest = latestObservations(obs);
  return assets
    .filter((a) => a.currency !== 'INR' && a.status === 'active')
    .map((a) => {
      const o = latest.get(a.id);
      const live = fx[a.currency];
      return {
        assetId: a.id,
        ownerId: a.owner_id,
        name: a.label ?? a.nickname,
        currency: a.currency,
        amount: o ? o.amount : null,
        asOf: o ? o.as_of : null,
        rate: live ? live.rate : null,
        rateDate: live ? live.date : null,
        inr: valueInr.get(a.id) ?? null,
      };
    });
}
