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
  /**
   * the kind of line, when known. Units bought with a dividend (`dividend_reinvest`) cost the investor nothing: the money paid out
   * and put back is one movement, so the line is not a cash flow of the return.
   */
  kind?: string | null;
}

/** A line that moves money in or out of the investor's pocket (units bought with a reinvested dividend do not). */
export const isCashFlow = (t: { units: number; amount: number; kind?: string | null }) =>
  t.units !== 0 && t.amount !== 0 && t.kind !== 'dividend_reinvest';

export interface FundForReturns {
  assetId: string;
  ownerId: string;
  name: string;
  value: number;
  txns: FundTxn[];
  /**
   * What is known without a fund statement: the amount put in, when it began and any SIP. Used for an estimated return when
   * there are no transactions.
   */
  plan?: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean;
  };
}

/** Cash flows reconstructed from a plan: monthly instalments if there is a SIP, otherwise one purchase on the start date. */
export function approximateFlows(
  plan: NonNullable<FundForReturns['plan']>,
  today: string,
): FundTxn[] {
  if (!plan.startedOn || !(plan.invested > 0) || plan.startedOn > today) return [];
  const start = new Date(`${plan.startedOn}T00:00:00Z`);
  const end = new Date(`${today}T00:00:00Z`);
  if (plan.sipMonthly && plan.sipMonthly > 0) {
    const dates: string[] = [];
    for (let i = 0; i < 600; i++) {
      const d = new Date(start);
      d.setUTCMonth(d.getUTCMonth() + i);
      if (d > end) break;
      dates.push(d.toISOString().slice(0, 10));
    }
    if (dates.length >= 2) {
      // the instalments add up to the amount known to have been put in
      const each = plan.invested / dates.length;
      return dates.map((date) => ({ date, units: 1, amount: each }));
    }
  }
  return [{ date: plan.startedOn, units: 1, amount: plan.invested }];
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
  /** how many of those funds had no statement, so their part of the return is estimated from the start date and SIP */
  estimatedFunds: number;
}

const flowsOf = (f: FundForReturns, today: string) => [
  ...(f.txns.length > 0 ? f.txns : f.plan ? approximateFlows(f.plan, today) : [])
    .filter(isCashFlow)
    .map((t) => ({
      date: new Date(`${t.date}T00:00:00Z`),
      amount: t.units > 0 ? -Math.abs(t.amount) : Math.abs(t.amount),
    })),
  ...(f.value > 0 ? [{ date: new Date(`${today}T00:00:00Z`), amount: f.value }] : []),
];

export function returnsFor(funds: FundForReturns[], today: string): Returns {
  const used = funds.filter(
    (f) => f.txns.length > 0 || (f.plan && approximateFlows(f.plan, today).length > 0),
  );
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
    estimatedFunds: used.filter((f) => f.txns.length === 0).length,
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

/** Change in a fund's price over its last two prices: the share it moved, and the dates compared. */
export function lastNavMove(
  series: { date: string; nav: number }[],
): { pct: number; from: string; to: string } | null {
  if (series.length < 2) return null;
  const a = series[series.length - 2]!;
  const b = series[series.length - 1]!;
  if (!(a.nav > 0) || !(b.nav > 0) || b.date <= a.date) return null;
  return { pct: b.nav / a.nav - 1, from: a.date, to: b.date };
}

/** Rupees gained or lost over that move, for a holding worth `value` at the later price. */
export const moveAmount = (value: number, pct: number) => value - value / (1 + pct);
