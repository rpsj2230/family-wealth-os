/**
 * A fixed deposit on its contract terms, on any day: the ONE place a deposit's value, its interest (accrued, paid out, earned) and its
 * maturity value are worked out. Net worth, the history, the period figures, Reports, Tax and the e-mail all read it.
 *
 * Terms. Principal, yearly rate, booking and maturity dates, compounding, and how interest is paid:
 *  - cumulative: interest is added to the deposit (compounded at its frequency) and paid with the principal on the maturity date;
 *  - monthly / quarterly / half-yearly / yearly payout: interest of principal × rate ÷ periods a year is paid out on each period's date
 *    from the booking date (to the account the deposit is linked to), the last one on the maturity date with the principal. Between
 *    two payouts the interest of the running period accrues day by day. Paid-out interest has left the deposit: it is earned, not held.
 *
 * Days. A deposit is running from its booking date through its maturity date (it is still counted on the day it matures). From the next
 * day it has matured: it stops earning, and what it paid (its maturity proceeds) is accounted for separately (`proceedsPlan`). A
 * deposit closed before its maturity date (`endedOn` earlier than it) stops on that day; its proceeds are its value then.
 *
 * Maturity proceeds are never reinvested automatically. Until you say where they went (a savings account, a new deposit, taken out)
 * they are "awaiting confirmation" and counted once in net worth. When there is evidence they were already placed (a new deposit booked
 * at the same bank for about that amount around the date, or a later balance of the account the deposit is linked to), they are
 * "probably placed" and not counted again, so wealth is never counted twice; you are still asked to confirm. Proceeds older than the
 * window in Settings (deposits.hideMaturedAfterDays) with no evidence are assumed placed and not counted; that is said, not hidden.
 *
 * Pure: dates are YYYY-MM-DD text; no I/O.
 */
import { daysBetween, fdEffectiveRate, fdValueOn, type Compounding } from './fd';
import { addDaysIso, addMonthsIso } from './harvest-lots';

export type Payout = 'cumulative' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly';

export const PAYOUTS: { key: Payout; label: string }[] = [
  { key: 'cumulative', label: 'Cumulative (paid at maturity)' },
  { key: 'monthly', label: 'Monthly payout' },
  { key: 'quarterly', label: 'Quarterly payout' },
  { key: 'half_yearly', label: 'Half-yearly payout' },
  { key: 'yearly', label: 'Yearly payout' },
];

const MONTHS: Record<Exclude<Payout, 'cumulative'>, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  yearly: 12,
};

export const isPayout = (p: Payout | null | undefined): p is Exclude<Payout, 'cumulative'> =>
  !!p && p !== 'cumulative';

export interface DepositContract {
  principal: number;
  /** the yearly rate the deposit grows at (decimal): the stated rate, or the one that reaches the bank's maturity amount */
  rate: number;
  bookedOn: string;
  maturityOn: string;
  compounding: Compounding;
  payout?: Payout | null;
  /** the day it was closed or paid out, when known */
  endedOn?: string | null;
}

export type DepositDayState = 'not_yet' | 'running' | 'matured' | 'closed';

export interface DepositOn {
  state: DepositDayState;
  /** what the deposit holds that day: principal plus interest not yet paid out (0 unless running) */
  held: number;
  principal: number;
  /** interest earned and still in the deposit */
  accrued: number;
  /** interest paid out on or before the day */
  paidOut: number;
  /** all interest earned up to the day (accrued + paid out); fixed once it has matured or closed */
  earned: number;
  /** what it pays on the maturity date, on its terms */
  maturityValue: number;
  /** interest over the whole term */
  termInterest: number;
  /** the last day it earns: the maturity date, or the day before it was closed early */
  lastDay: string;
  /** what it paid when it matured or closed (null while running or not yet booked) */
  proceeds: number | null;
}

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const span = (a: string, b: string) => daysBetween(utc(a), utc(b));

/** The day the deposit stops: closed early, else its maturity date. */
export function contractEnd(c: DepositContract): { lastDay: string; early: boolean } {
  if (c.endedOn && c.endedOn <= c.maturityOn) {
    const last = addDaysIso(c.endedOn, -1);
    return { lastDay: last < c.bookedOn ? c.bookedOn : last, early: c.endedOn < c.maturityOn };
  }
  return { lastDay: c.maturityOn, early: false };
}

/** The first day the money is out of the deposit: the day it was paid out or closed (on or before its maturity date), else the day after it matured. */
export const contractOutOn = (c: DepositContract): string =>
  c.endedOn && c.endedOn <= c.maturityOn ? c.endedOn : addDaysIso(c.maturityOn, 1);

/** Every payout date of a payout deposit, from the first period's end through the maturity date (the last one). */
export function payoutDates(c: DepositContract): string[] {
  if (!isPayout(c.payout)) return [];
  const step = MONTHS[c.payout];
  const out: string[] = [];
  for (let k = 1; k < 1200; k++) {
    const d = addMonthsIso(c.bookedOn, k * step);
    if (d >= c.maturityOn) break;
    out.push(d);
  }
  out.push(c.maturityOn);
  return out;
}

/** The interest of one payout period from `from` to `to`: a full period earns principal × rate ÷ periods; a short last one, by days. */
function periodInterest(c: DepositContract, from: string, to: string): number {
  const step = MONTHS[c.payout as Exclude<Payout, 'cumulative'>];
  const full = addMonthsIso(from, step);
  if (to >= full) return (c.principal * c.rate * step) / 12;
  return (c.principal * c.rate * Math.max(0, span(from, to))) / 365;
}

/** Interest paid out on each date of a payout deposit, oldest first. */
export function payoutSchedule(c: DepositContract): { date: string; amount: number }[] {
  if (!isPayout(c.payout)) return [];
  let from = c.bookedOn;
  return payoutDates(c).map((date) => {
    const amount = periodInterest(c, from, date);
    from = date;
    return { date, amount };
  });
}

const cumulativeValue = (c: DepositContract, on: string) =>
  fdValueOn({
    principal: c.principal,
    annualRate: Math.max(0, c.rate),
    bookedOn: utc(c.bookedOn),
    asOf: utc(on),
    maturityOn: utc(c.maturityOn),
    compounding: c.compounding,
  });

/** Earned interest up to the start of `on` for a payout deposit: payouts before it, and the running period's share. */
function payoutEarned(c: DepositContract, on: string): { paidOut: number; accrued: number } {
  const sched = payoutSchedule(c);
  let paidOut = 0;
  let from = c.bookedOn;
  for (const p of sched) {
    if (p.date <= on) {
      paidOut += p.amount;
      from = p.date;
      continue;
    }
    // the running period: its interest accrues evenly over its days
    const days = Math.max(1, span(from, p.date));
    const part = Math.min(1, Math.max(0, span(from, on)) / days);
    return { paidOut, accrued: p.amount * part };
  }
  return { paidOut, accrued: 0 };
}

/**
 * The deposit on a day. The value is that of the start of the day (a period that ends today measures to now), the same convention as
 * every other figure; on the maturity date it is the maturity value.
 */
export function depositOn(c: DepositContract, on: string): DepositOn {
  const payout = isPayout(c.payout);
  const sched = payout ? payoutSchedule(c) : [];
  const termInterest = payout
    ? sched.reduce((a, p) => a + p.amount, 0)
    : cumulativeValue(c, c.maturityOn) - c.principal;
  const maturityValue = payout
    ? c.principal + (sched[sched.length - 1]?.amount ?? 0)
    : c.principal + termInterest;
  const end = contractEnd(c);
  const base = { principal: c.principal, maturityValue, termInterest, lastDay: end.lastDay };
  if (on < c.bookedOn)
    return {
      ...base,
      state: 'not_yet',
      held: 0,
      accrued: 0,
      paidOut: 0,
      earned: 0,
      proceeds: null,
    };

  const at = (d: string) => {
    if (!payout) {
      const v = cumulativeValue(c, d);
      return { held: v, accrued: v - c.principal, paidOut: 0 };
    }
    const e = payoutEarned(c, d);
    // on the maturity date the last payout is the one paid with the principal: it is still in the deposit's proceeds, not paid out
    const last = sched[sched.length - 1];
    if (last && d >= c.maturityOn)
      return {
        held: c.principal + last.amount,
        accrued: last.amount,
        paidOut: e.paidOut - last.amount,
      };
    return { held: c.principal + e.accrued, accrued: e.accrued, paidOut: e.paidOut };
  };

  if (c.endedOn && c.endedOn <= c.maturityOn && on >= c.endedOn) {
    const v = at(c.endedOn);
    return {
      ...base,
      state: end.early ? 'closed' : 'matured',
      held: 0,
      accrued: 0,
      paidOut: v.paidOut,
      earned: v.accrued + v.paidOut,
      proceeds: v.held,
    };
  }
  if (on > c.maturityOn) {
    const v = at(c.maturityOn);
    return {
      ...base,
      state: 'matured',
      held: 0,
      accrued: 0,
      paidOut: v.paidOut,
      earned: v.accrued + v.paidOut,
      proceeds: v.held,
    };
  }
  const v = at(on);
  return {
    ...base,
    state: 'running',
    held: v.held,
    accrued: v.accrued,
    paidOut: v.paidOut,
    earned: v.accrued + v.paidOut,
    proceeds: null,
  };
}

/** Interest a deposit earned between the start of `from` and the start of `to` (accrued and paid out alike). */
export function depositInterestBetween(c: DepositContract, from: string, to: string): number {
  if (!(to > from)) return 0;
  return Math.max(0, depositOn(c, to).earned - depositOn(c, from).earned);
}

// ------------------------------------------------------------------------------------------------
// Maturity proceeds: where the money went
// ------------------------------------------------------------------------------------------------
export type ProceedsStatus =
  /** nobody said where they went and nothing shows it: counted in net worth until you do */
  | 'awaiting'
  /** a new deposit or a later balance probably holds them: not counted again; please confirm */
  | 'probably_placed'
  /** you said where they went */
  | 'confirmed'
  /** older than the window in Settings with no evidence: assumed placed and not counted */
  | 'assumed_placed';

export interface ProceedsEvidence {
  /** a deposit booked around the maturity date at the same bank for about the proceeds, or marked as renewed from it */
  renewal?: { assetId: string; name: string; bookedOn: string; principal: number } | null;
  /** a balance of the linked account (or of the same person's account at the same bank) recorded after the maturity date */
  laterBalance?: { assetId: string; name: string; date: string } | null;
}

export interface ProceedsInput {
  /** the asset's status: matured, renewed and closed say the person settled it */
  status: string;
  /** the day after the last day it earned: the money is out of the deposit from this day */
  outOn: string;
  amount: number;
  today: string;
  hideAfterDays: number;
  /** movements you confirmed out of this deposit's proceeds (to an account, a new deposit, or out of the family) */
  confirmed: { on: string; amount: number }[];
  evidence: ProceedsEvidence;
  /** the day the deposit was recorded as gone (paid out or closed; the History import writes it from the monthly tabs) */
  endedOn?: string | null;
}

export interface ProceedsPlan {
  status: ProceedsStatus;
  amount: number;
  /** from this day the money is no longer counted as proceeds (it is in its new place, or assumed so); null = still counted today */
  placedOn: string | null;
  /** of the amount, what is still counted as proceeds today */
  countedToday: number;
  note: string;
}

const SETTLED = new Set(['matured', 'renewed', 'closed']);

/** Where a deposit's proceeds stand, and from which day they stop being counted as proceeds. */
export function proceedsPlan(i: ProceedsInput): ProceedsPlan {
  const placedSum = i.confirmed.reduce((a, m) => a + m.amount, 0);
  const lastMove =
    i.confirmed
      .map((m) => m.on)
      .sort()
      .pop() ?? null;
  const tolerance = Math.max(1, i.amount * 0.001);
  if (placedSum >= i.amount - tolerance || (SETTLED.has(i.status) && i.confirmed.length > 0))
    return {
      status: 'confirmed',
      amount: i.amount,
      placedOn: lastMove ?? i.outOn,
      countedToday: 0,
      note: 'You confirmed where the proceeds went.',
    };
  if (SETTLED.has(i.status)) {
    // settled before movements were recorded: the evidence (or the maturity date) says when they were placed
    const when =
      (i.endedOn && i.endedOn > i.outOn ? i.endedOn : null) ??
      i.evidence.renewal?.bookedOn ??
      i.evidence.laterBalance?.date ??
      i.outOn;
    return {
      status: 'confirmed',
      amount: i.amount,
      placedOn: when < i.outOn ? i.outOn : when,
      countedToday: 0,
      note: 'Marked as matured; where the proceeds went is not recorded.',
    };
  }
  const evidenceDay = [
    i.evidence.renewal?.bookedOn,
    i.evidence.laterBalance?.date,
    i.endedOn && i.endedOn >= i.outOn ? i.endedOn : null,
  ]
    .filter((d): d is string => !!d)
    .sort()[0];
  if (evidenceDay) {
    const where = i.evidence.renewal
      ? `a new deposit (${i.evidence.renewal.name}) booked on ${i.evidence.renewal.bookedOn}`
      : i.evidence.laterBalance
        ? `the balance of ${i.evidence.laterBalance.name} recorded on ${i.evidence.laterBalance.date}`
        : `another account (the deposit is recorded as gone on ${i.endedOn})`;
    return {
      status: 'probably_placed',
      amount: i.amount,
      placedOn: evidenceDay < i.outOn ? i.outOn : evidenceDay,
      countedToday: 0,
      note: `Probably already in ${where}, so not counted twice. Please confirm.`,
    };
  }
  const age = span(i.outOn, i.today);
  if (age > i.hideAfterDays)
    return {
      status: 'assumed_placed',
      amount: i.amount,
      placedOn: i.outOn,
      countedToday: 0,
      note: `Matured more than ${i.hideAfterDays} days ago with nothing to show where the money went: assumed already in another account and not counted.`,
    };
  const remaining = Math.max(0, i.amount - placedSum);
  return {
    status: 'awaiting',
    amount: i.amount,
    placedOn: null,
    countedToday: remaining,
    note: 'Awaiting confirmation: counted once in net worth until you say where it went. Never reinvested automatically.',
  };
}

/** Whether the proceeds are counted as proceeds on a day. */
export const proceedsCountedOn = (p: ProceedsPlan, outOn: string, on: string): boolean =>
  on >= outOn && (p.placedOn === null || on < p.placedOn);

/**
 * Find the evidence that proceeds were already placed, among the household's other holdings. A renewal is a deposit marked as renewed
 * from this one, or one of the same person at the same bank booked from 3 days before to 15 days after the money left, whose principal
 * is the proceeds or the old principal (within 2%). A later balance is one of the linked account (its last four digits), else of a
 * savings account of the same person at the same bank, recorded on or after the day the money left.
 */
export function findProceedsEvidence(args: {
  deposit: {
    assetId: string;
    ownerId: string;
    institutionId: string | null;
    linkedLast4: string | null;
    principal: number;
  };
  outOn: string;
  amount: number;
  deposits: {
    assetId: string;
    ownerId: string;
    institutionId: string | null;
    name: string;
    bookedOn: string;
    principal: number;
    renewedFrom: string | null;
  }[];
  accounts: {
    assetId: string;
    ownerId: string;
    institutionId: string | null;
    last4: string | null;
    name: string;
    currency: string;
    balanceDates: string[];
  }[];
}): ProceedsEvidence {
  const d = args.deposit;
  const near = (x: number, y: number) => y > 0 && Math.abs(x - y) / y <= 0.02;
  const lo = addDaysIso(args.outOn, -3);
  const hi = addDaysIso(args.outOn, 15);
  const renewal =
    args.deposits.find((x) => x.renewedFrom === d.assetId) ??
    args.deposits.find(
      (x) =>
        x.assetId !== d.assetId &&
        x.ownerId === d.ownerId &&
        x.institutionId !== null &&
        x.institutionId === d.institutionId &&
        x.bookedOn >= lo &&
        x.bookedOn <= hi &&
        (near(x.principal, args.amount) || near(x.principal, d.principal)),
    ) ??
    null;
  const linked = d.linkedLast4
    ? args.accounts.filter((a) => a.last4 === d.linkedLast4 && a.ownerId === d.ownerId)
    : [];
  const pool = linked.length
    ? linked
    : args.accounts.filter(
        (a) =>
          a.ownerId === d.ownerId &&
          a.institutionId !== null &&
          a.institutionId === d.institutionId &&
          a.currency === 'INR',
      );
  let later: ProceedsEvidence['laterBalance'] = null;
  for (const a of pool) {
    const first = a.balanceDates.filter((x) => x >= args.outOn).sort()[0];
    if (first && (!later || first < later.date))
      later = { assetId: a.assetId, name: a.name, date: first };
  }
  return {
    renewal: renewal
      ? {
          assetId: renewal.assetId,
          name: renewal.name,
          bookedOn: renewal.bookedOn,
          principal: renewal.principal,
        }
      : null,
    laterBalance: later,
  };
}

// ------------------------------------------------------------------------------------------------
// One answer for every page: a deposit's terms as stored, valued by the contract above
// ------------------------------------------------------------------------------------------------
/** A deposit's terms as stored (database row names), with what the contract needs. */
export interface StoredDeposit {
  principal: number;
  rate: number;
  booked_on: string;
  maturity_on: string;
  compounding: Compounding;
  payout?: string | null;
  bank_maturity_amount?: number | null;
  ended_on?: string | null;
}

/**
 * The contract of a stored deposit at the rate it grows at: for a cumulative deposit, the rate that reaches the bank's maturity amount
 * when that is on file and within `rateGap` of the stated rate (the bank's own rounding and day count), else the stated rate.
 */
export function contractOfStored(d: StoredDeposit, rateGap = 0.02): DepositContract {
  const payout = (d.payout ?? 'cumulative') as Payout;
  const rate = isPayout(payout)
    ? Math.max(0, Number(d.rate))
    : fdEffectiveRate({
        principal: Number(d.principal),
        annualRate: Number(d.rate),
        bookedOn: utc(d.booked_on),
        maturityOn: utc(d.maturity_on),
        compounding: d.compounding,
        bankMaturityAmount: d.bank_maturity_amount ?? null,
        maxGap: rateGap,
      }).rate;
  return {
    principal: Number(d.principal),
    rate,
    bookedOn: d.booked_on,
    maturityOn: d.maturity_on,
    compounding: d.compounding,
    payout,
    endedOn: d.ended_on ?? null,
  };
}

/** What a stored deposit pays on its maturity date: the bank's own figure for a cumulative deposit when it is on file, else its terms. */
export function maturityAmountOf(d: StoredDeposit, rateGap = 0.02): number {
  if (!isPayout((d.payout ?? 'cumulative') as Payout) && d.bank_maturity_amount)
    return Number(d.bank_maturity_amount);
  return depositOn(contractOfStored(d, rateGap), d.maturity_on).maturityValue;
}

/** What a stored deposit holds at the start of a day while it runs (principal plus interest not yet paid out); 0 before or after. */
export const heldValueOf = (d: StoredDeposit, on: string, rateGap = 0.02): number =>
  depositOn(contractOfStored(d, rateGap), on).held;

/** Interest a stored deposit earned between the start of two days, paid out or not (nothing after it matured or closed). */
export const interestOfStored = (
  d: StoredDeposit,
  from: string,
  to: string,
  rateGap = 0.02,
): number => depositInterestBetween(contractOfStored(d, rateGap), from, to);
