/**
 * A savings account between actual balances: the ONE place its estimated balance and its interest are worked out. Net worth, the
 * history, the period figures, the reconciliation of a new balance and the e-mail all read it.
 *
 *   estimated balance on D = the last actual balance on or before D (the baseline, with its own effective date)
 *                          + confirmed money in and out after the baseline, up to D
 *                          + interest credited after the baseline (it becomes part of the balance on its credit date)
 *                          + interest accrued since the last credit, not yet credited
 *
 * Interest is worked out day by day on the balance of that day at the rate in force on that day (`RateStep`, effective-dated), after
 * the tax taken at source. A rate list with balance slabs is read either way banks use:
 *  - whole balance: the whole balance earns the rate of the slab it falls in;
 *  - incremental: each part of the balance earns the rate of its own slab (e.g. 3% up to ₹5 lakh and 3.5% on the part above it).
 * Banks credit savings interest in lumps (quarterly in India: 30 Jun, 30 Sep, 31 Dec, 31 Mar; some monthly); until it is credited it is
 * accrued. A new actual balance replaces the estimate and becomes the next baseline from its effective date (the date the balance
 * applies to, never the day the e-mail arrived).
 *
 * Reconciliation (`reconcileBalance`): what the old baseline, the confirmed movements and the interest predicted for the date of a new
 * actual balance is compared with it. A difference is never treated as profit or as invested: it is an "unexplained adjustment",
 * kept apart until it is classified.
 *
 * Pure: dates are YYYY-MM-DD text; no I/O.
 */
import { addDaysIso } from './harvest-lots';

export type SlabMethod = 'whole' | 'incremental';
export type CreditEvery = 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

/** One slab of a rate list: the rate on balances up to `upTo` (null: no upper limit). Slabs are in rising order of `upTo`. */
export interface SavingsSlab {
  upTo: number | null;
  rate: number;
}

/** The rates in force from a day (inclusive) until the next step. */
export interface RateStep {
  from: string;
  slabs: SavingsSlab[];
  method: SlabMethod;
  /** where the rate comes from, for the words: the account's own rate, the bank's rate list, the assumed rate in Settings */
  source: 'account' | 'rates_list' | 'assumed';
}

export interface SavingsTxn {
  date: string;
  /** money in positive, money out negative */
  amount: number;
}

export interface SavingsTerms {
  schedule: RateStep[];
  /** tax taken at source on the interest (decimal) */
  tds: number;
  credit: CreditEvery;
}

export interface SavingsState {
  /** the estimate: balance plus accrued interest */
  value: number;
  /** the balance with credited interest, before what is accrued */
  balance: number;
  /** accrued since the last credit, not yet credited */
  accrued: number;
  /** credited after the baseline */
  credited: number;
  /** all interest after the baseline (credited + accrued), after tax at source */
  interest: number;
  /** confirmed money in and out after the baseline */
  moved: number;
  days: number;
  /** the yearly rate on the balance of the last day (whole-balance equivalent) */
  rate: number;
  source: RateStep['source'] | null;
}

/** The yearly rate a balance earns under one step, as a single rate on the whole balance. */
export function yearlyRateOn(balance: number, step: Pick<RateStep, 'slabs' | 'method'>): number {
  const slabs = [...step.slabs].sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
  if (slabs.length === 0 || !(balance > 0)) return slabs[0]?.rate ?? 0;
  if (step.method === 'whole') {
    const hit = slabs.find((s) => s.upTo === null || balance <= s.upTo) ?? slabs[slabs.length - 1]!;
    return Math.max(0, hit.rate);
  }
  let interest = 0;
  let lower = 0;
  for (const s of slabs) {
    const upper = s.upTo ?? Infinity;
    if (balance <= lower) break;
    const part = Math.min(balance, upper) - lower;
    interest += part * Math.max(0, s.rate);
    lower = upper;
  }
  // a balance above the last capped slab earns the last slab's rate
  const top = slabs[slabs.length - 1]!;
  if (top.upTo !== null && balance > top.upTo)
    interest += (balance - top.upTo) * Math.max(0, top.rate);
  return interest / balance;
}

/** The step in force on a day: the last one starting on or before it, else the first (a rate known only from later applies before). */
export function stepOn(schedule: RateStep[], day: string): RateStep | null {
  let best: RateStep | null = null;
  for (const s of schedule) if (s.from <= day && (!best || s.from >= best.from)) best = s;
  if (best) return best;
  return [...schedule].sort((a, b) => a.from.localeCompare(b.from))[0] ?? null;
}

/** Whether interest is credited at the end of this day. */
export function isCreditDay(day: string, every: CreditEvery): boolean {
  const next = addDaysIso(day, 1);
  if (next.slice(8, 10) !== '01') return false;
  const m = Number(next.slice(5, 7));
  switch (every) {
    case 'monthly':
      return true;
    case 'quarterly':
      return m === 1 || m === 4 || m === 7 || m === 10;
    case 'half_yearly':
      return m === 4 || m === 10;
    case 'yearly':
      return m === 4;
  }
}

/**
 * The account at the start of `on`, from a baseline and the confirmed movements after it. A balance is the balance at the end of its
 * day, and a movement dated d is in the balance at the end of d; each night earns on the balance at the end of its day. So the value on
 * the baseline's own day is the baseline, and a movement dated d is in the value from d+1.
 */
export function savingsOn(
  baseline: { date: string; amount: number },
  txns: SavingsTxn[],
  terms: SavingsTerms,
  on: string,
): SavingsState {
  const moves = txns
    .filter((t) => t.date > baseline.date && t.date < on)
    .sort((a, b) => a.date.localeCompare(b.date));
  let balance = baseline.amount;
  let accrued = 0;
  let credited = 0;
  let moved = 0;
  let days = 0;
  let rate = 0;
  let source: RateStep['source'] | null = null;
  let k = 0;
  const net = 1 - Math.min(Math.max(terms.tds, 0), 0.99);
  // each night from the baseline's day through the day before `on` earns on the balance at the end of its day
  for (let d = baseline.date; d < on; d = addDaysIso(d, 1)) {
    while (k < moves.length && moves[k]!.date <= d) {
      balance += moves[k]!.amount;
      moved += moves[k]!.amount;
      k++;
    }
    const step = stepOn(terms.schedule, d);
    rate = step ? yearlyRateOn(Math.max(0, balance), step) : 0;
    source = step?.source ?? null;
    accrued += (Math.max(0, balance) * rate * net) / 365;
    days++;
    if (isCreditDay(d, terms.credit)) {
      balance += accrued;
      credited += accrued;
      accrued = 0;
    }
  }
  while (k < moves.length) {
    balance += moves[k]!.amount;
    moved += moves[k]!.amount;
    k++;
  }
  if (days === 0) {
    const step = stepOn(terms.schedule, on);
    rate = step ? yearlyRateOn(Math.max(0, balance), step) : 0;
    source = step?.source ?? null;
  }
  return {
    value: balance + accrued,
    balance,
    accrued,
    credited,
    interest: credited + accrued,
    moved,
    days,
    rate,
    source,
  };
}

/** Interest an account earned between the start of `from` and the start of `to`, with no record in between. */
export function savingsInterestBetween(
  baseline: { date: string; amount: number },
  txns: SavingsTxn[],
  terms: SavingsTerms,
  from: string,
  to: string,
): number {
  if (!(to > from)) return 0;
  const a = from <= baseline.date ? 0 : savingsOn(baseline, txns, terms, from).interest;
  return savingsOn(baseline, txns, terms, to).interest - a;
}

// ------------------------------------------------------------------------------------------------
// Reconciliation of a new actual balance
// ------------------------------------------------------------------------------------------------
export interface ReconcileSuggestion {
  kind:
    | 'fd_proceeds'
    | 'fd_payout'
    | 'outside_money_in'
    | 'money_out'
    | 'interest_credit'
    /** the same sum went the other way in another of the family's accounts within a few days */
    | 'transfer'
    /** the sum left the account to open a new deposit booked within a few days */
    | 'fd_funding';
  amount: number;
  /** the holding it probably came from or went to, when there is one */
  assetId?: string;
  label: string;
}

export interface Reconciliation {
  baseline: { date: string; amount: number };
  actual: { date: string; amount: number };
  expected: number;
  interest: number;
  moved: number;
  /** actual less expected: positive = more money than predicted */
  difference: number;
  /** within the tolerance (rounding, a small charge, the bank's own day count): nothing to explain */
  explained: boolean;
  suggestions: ReconcileSuggestion[];
}

/**
 * Compare a new actual balance with what was predicted for its date. `tolerance` is in rupees (Settings); a difference within it, or
 * within the interest the account could have earned beyond the estimate (a credit on a different day), is explained. `candidates` are
 * known events that could explain a difference (maturity proceeds awaiting confirmation, payouts due to this account); any one within
 * 2% of the difference is offered first. Otherwise the difference is offered as outside money in, or money withdrawn.
 */
export function reconcileBalance(args: {
  baseline: { date: string; amount: number };
  actual: { date: string; amount: number };
  txns: SavingsTxn[];
  terms: SavingsTerms;
  tolerance: number;
  candidates?: {
    kind: 'fd_proceeds' | 'fd_payout';
    amount: number;
    assetId: string;
    label: string;
  }[];
}): Reconciliation {
  // the actual balance is that of the end of its day: the estimate at the start of the day plus what moved on it
  const s = savingsOn(args.baseline, args.txns, args.terms, args.actual.date);
  const sameDay = args.txns
    .filter((t) => t.date === args.actual.date && t.date > args.baseline.date)
    .reduce((a, t) => a + t.amount, 0);
  const expected = s.value + sameDay;
  const difference = args.actual.amount - expected;
  const explained = Math.abs(difference) <= Math.max(0, args.tolerance);
  const suggestions: ReconcileSuggestion[] = [];
  if (!explained) {
    const near = (x: number) =>
      Math.abs(x - difference) <= Math.max(args.tolerance, Math.abs(difference) * 0.02);
    for (const c of args.candidates ?? [])
      if (near(c.amount))
        suggestions.push({ kind: c.kind, amount: c.amount, assetId: c.assetId, label: c.label });
    suggestions.push(
      difference > 0
        ? {
            kind: 'outside_money_in',
            amount: difference,
            label: 'Money added from outside (salary, a gift, a sale)',
          }
        : { kind: 'money_out', amount: difference, label: 'Money withdrawn or spent' },
    );
  }
  return {
    baseline: args.baseline,
    actual: args.actual,
    expected,
    interest: s.interest,
    moved: s.moved + sameDay,
    difference,
    explained,
    suggestions,
  };
}
