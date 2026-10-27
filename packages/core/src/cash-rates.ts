import { savingsRateFor, type RateOffer } from './rates';

export interface CashRate {
  rate: number;
  /** where the figure comes from: set on the account, read from the bank's rates, or the household's assumed rate */
  tag: 'own' | 'market' | 'assumed';
  note: string;
}

/**
 * The interest rate each savings account earns today: the rate set on the account, else the slab it falls in on the bank's
 * rates on file, else the assumed savings rate (marked as such). This is the rule the Accounts page uses (`cashRatesFor` in the
 * web app's rates view, which a test holds equal to this), so the daily summary can work out "earned today" without the web app.
 */
export function savingsRatesOf(
  rows: {
    assetId: string;
    kind: string;
    status: string;
    accountKind: 'NRE' | 'NRO' | null;
    current: number | null;
    bank: string;
  }[],
  own: ReadonlyMap<string, number | null>,
  offers: RateOffer[],
  assumed: number,
): Record<string, CashRate> {
  const out: Record<string, CashRate> = {};
  for (const r of rows) {
    if (r.kind !== 'cash' || r.status !== 'active') continue;
    const mine = own.get(r.assetId);
    if (mine !== null && mine !== undefined) {
      out[r.assetId] = { rate: mine, tag: 'own', note: 'Rate set on this account' };
      continue;
    }
    const m = savingsRateFor(offers, r.bank, r.accountKind, Math.max(0, r.current ?? 0));
    if (m)
      out[r.assetId] = {
        rate: m.rate,
        tag: 'market',
        note: `${r.bank} savings rate${m.slab ? ` for balances ${m.slab}` : ''}, checked ${m.checkedOn}`,
      };
    else
      out[r.assetId] = {
        rate: assumed,
        tag: 'assumed',
        note: 'No rate on file for this bank: the assumed savings rate from Settings is used',
      };
  }
  return out;
}
