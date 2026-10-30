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

/**
 * The rate savings earned this financial year: the interest earned since the financial year began (credited or still building up),
 * as a yearly rate on today's balance. Null on the year's first day or with no balance.
 */
export function savingsRateEarned(
  interest: number,
  balance: number,
  fyStart: string,
  today: string,
): ClassYearly | null {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fyStart}T00:00:00Z`)) / 86_400_000;
  if (!(balance > 0) || !(days > 0) || !Number.isFinite(interest)) return null;
  return {
    rate: (interest / balance) * (365 / days),
    kind: 'rate',
    estimated: true,
    basis: `interest earned in the ${Math.round(days)} days since ${fyStart}, as a yearly rate on today's balance`,
  };
}

export interface EarningPart {
  key: string;
  value: number;
  /** the part's yearly rate; null when it cannot be worked out */
  rate: number | null;
}

/**
 * Earning rate now: what all the money earns a year at today's rates, each part weighted by its current value (deposits and funds at
 * their XIRR, savings at the rate earned, money lent at 0%). Null when a part holding money has no rate, so the figure is never
 * flattered by leaving a part out.
 */
export function earningRateNow(
  parts: EarningPart[],
): { rate: number; total: number; perYear: number } | null {
  const held = parts.filter((p) => p.value > 0);
  const total = held.reduce((a, p) => a + p.value, 0);
  if (!(total > 0) || held.some((p) => p.rate === null)) return null;
  const perYear = held.reduce((a, p) => a + p.value * p.rate!, 0);
  return { rate: perYear / total, total, perYear };
}

/** Deposits maturing from tomorrow to `days` days from today: how many, their principal and what they pay. */
export function maturingWithin(
  deposits: { principal: number; maturityOn: string | null; maturityAmount: number | null }[],
  today: string,
  days: number,
): { count: number; principal: number; maturity: number } {
  const end = new Date(Date.parse(`${today}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const due = deposits.filter((d) => d.maturityOn && d.maturityOn > today && d.maturityOn <= end);
  return {
    count: due.length,
    principal: due.reduce((a, d) => a + d.principal, 0),
    maturity: due.reduce((a, d) => a + (d.maturityAmount ?? d.principal), 0),
  };
}
