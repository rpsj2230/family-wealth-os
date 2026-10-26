/**
 * Returns on fund holdings from the statement's own transactions: money in is negative, money out and today's value
 * positive, solved as XIRR. Only funds with transactions are included, and the coverage is reported, so a figure is
 * never presented for money it does not describe.
 */
import { xirr, type XirrResult } from './xirr';

export interface FundTxn {
  date: string;
  /** units bought are positive, units sold are negative */
  units: number;
  /** rupees paid (positive) or received (positive); the sign of `units` says which */
  amount: number;
}

export interface FundForReturns {
  assetId: string;
  ownerId: string;
  name: string;
  value: number;
  txns: FundTxn[];
}

export interface Returns {
  /** annualised return, or null when it cannot be worked out */
  xirr: number | null;
  status: XirrResult['status'];
  invested: number;
  redeemed: number;
  value: number;
  gain: number;
  funds: number;
}

const flowsOf = (f: FundForReturns, today: string) => [
  ...f.txns
    .filter((t) => t.units !== 0 && t.amount !== 0)
    .map((t) => ({
      date: new Date(`${t.date}T00:00:00Z`),
      amount: t.units > 0 ? -Math.abs(t.amount) : Math.abs(t.amount),
    })),
  ...(f.value > 0 ? [{ date: new Date(`${today}T00:00:00Z`), amount: f.value }] : []),
];

export function returnsFor(funds: FundForReturns[], today: string): Returns {
  const used = funds.filter((f) => f.txns.length > 0);
  const flows = used.flatMap((f) => flowsOf(f, today));
  const invested = flows.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0);
  const value = used.reduce((a, f) => a + f.value, 0);
  const redeemed = flows.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0) - value;
  const r = used.length > 0 ? xirr(flows) : null;
  return {
    xirr: r && (r.status === 'ok' || r.status === 'ok_multiple_roots') ? r.rate : null,
    status: r ? r.status : 'insufficient_flows',
    invested: Math.round(invested),
    redeemed: Math.round(redeemed),
    value: Math.round(value),
    gain: Math.round(value + redeemed - invested),
    funds: used.length,
  };
}

/** Net money put in by month (purchases minus sales), cumulative, for a chart. */
export function contributionSeries(
  funds: FundForReturns[],
): { month: string; cumulative: number }[] {
  const by = new Map<string, number>();
  for (const f of funds)
    for (const t of f.txns) {
      if (t.units === 0 || t.amount === 0) continue;
      const m = t.date.slice(0, 7);
      by.set(m, (by.get(m) ?? 0) + (t.units > 0 ? Math.abs(t.amount) : -Math.abs(t.amount)));
    }
  let run = 0;
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, cumulative: Math.round((run += v)) }));
}
