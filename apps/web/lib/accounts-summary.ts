import type { AssetRow, BankBlock, ObservationRow } from '@fwos/core';

export interface AccountsSummary {
  banks: number;
  total: number;
  savings: number;
  fdInvested: number;
  fdMaturity: number;
  fdToday: number;
  /** banks whose balances are all dated this month and need nothing from you */
  banksDone: number;
  /** things only the person can settle: stale balances and unconfirmed matured deposits */
  needsYou: number;
  /** the oldest "last updated" date among the banks, or null when none has one */
  oldestUpdate: string | null;
}

/** The few figures at the top of the Accounts page. */
export function summariseBlocks(blocks: BankBlock[]): AccountsSummary {
  const dates = blocks.map((b) => b.lastUpdated).filter((d): d is string => !!d);
  return {
    banks: blocks.length,
    total: blocks.reduce((s, b) => s + b.totals.current, 0),
    savings: blocks.reduce((s, b) => s + b.totals.cash, 0),
    fdInvested: blocks.reduce((s, b) => s + b.totals.fdInvested, 0),
    fdMaturity: blocks.reduce((s, b) => s + b.totals.fdMaturity, 0),
    fdToday: blocks.reduce((s, b) => s + b.totals.fdCurrent, 0),
    banksDone: blocks.filter((b) => b.doneThisMonth).length,
    needsYou: blocks.reduce((s, b) => s + b.needsYou, 0),
    oldestUpdate: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
  };
}

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
