/**
 * The yearly return of each kind of holding, for Home's "by kind of holding" cards:
 *  - fixed deposits: money-weighted (XIRR) over the deposits running today, each principal out on its booking day against its value
 *    today, worked out from its terms (an estimate until the bank's figures confirm it);
 *  - mutual funds: the funds' own XIRR from their ledgers (given);
 *  - cash: the yearly rate the balances earn at the rates on file (an XIRR needs every deposit and withdrawal, which savings
 *    accounts do not all have);
 *  - others: none (no dated money in and out to measure).
 * Pure: no I/O.
 */
import { xirr } from './xirr';

export interface ClassYearly {
  /** a yearly rate, 0.072 = 7.2% */
  rate: number;
  kind: 'xirr' | 'rate';
  estimated: boolean;
  /** one line on what it rests on */
  basis: string;
}

/** XIRR of the running deposits: each principal out on its booking day, the value of all of them back today. */
export function depositsXirr(
  deposits: { principal: number; bookedOn: string; value: number }[],
  today: string,
): ClassYearly | null {
  const live = deposits.filter((d) => d.principal > 0 && d.value > 0 && d.bookedOn < today);
  if (live.length === 0) return null;
  const at = (s: string) => new Date(`${s}T00:00:00Z`);
  const r = xirr([
    ...live.map((d) => ({ date: at(d.bookedOn), amount: -d.principal })),
    { date: at(today), amount: live.reduce((s, d) => s + d.value, 0) },
  ]);
  if (r.rate === null) return null;
  return {
    rate: r.rate,
    kind: 'xirr',
    estimated: true,
    basis: `money-weighted over ${live.length} running deposit${live.length === 1 ? '' : 's'}, from their terms`,
  };
}

/** The yearly rate cash earns: a day's interest at the rates on file, over a year, on today's balance. */
export function cashYearly(balance: number, interestPerDay: number): ClassYearly | null {
  if (!(balance > 0) || !(interestPerDay >= 0)) return null;
  return {
    rate: (interestPerDay * 365) / balance,
    kind: 'rate',
    estimated: true,
    basis:
      'the rate the balances earn, at the rates on file (not an XIRR: deposits and withdrawals are not all recorded)',
  };
}
