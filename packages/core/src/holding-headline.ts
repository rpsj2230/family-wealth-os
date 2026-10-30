/**
 * The figures of the dark headline on one holding's own page (money words v6): a fixed deposit, a savings account, and the few a fund's
 * page adds to what its detail already has (the SIP's status, how far it is ahead of its benchmark on the same money). Every figure rests
 * on a rule that already exists: the valuation engine's current value (the figure Deposits, Accounts and Home show), the deposit's
 * contract (deposit-contract.ts), the period figures (period-gains.ts), the tax rate on NRO interest from Settings. Pure: no I/O.
 */
import {
  contractOfStored,
  depositInterestBetween,
  depositOn,
  isPayout,
  maturityAmountOf,
  payoutSchedule,
  type DepositDayState,
  type Payout,
  type StoredDeposit,
} from './deposit-contract';
import type { Compounding } from './fd';
import {
  fyStartOn,
  recentWindow,
  savingsPeriod,
  spanBetween,
  type SavingsAccount,
} from './period-gains';
import { afterTaxRate } from './rates';
import { xirr } from './xirr';

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const daysFrom = (a: string, b: string) =>
  Math.round((utc(b).getTime() - utc(a).getTime()) / 86_400_000);

// ------------------------------------------------------------------------------------------------
// Rate after tax
// ------------------------------------------------------------------------------------------------
export interface AfterTax {
  /** the yearly rate left after Indian tax; the rate itself when the account type is not known */
  rate: number;
  kind: 'NRE' | 'NRO' | 'unknown';
  /** the tax taken off (NRO: Settings); 0 for NRE; null when the account type is not known */
  taxRate: number | null;
}

/**
 * The interest rate after Indian tax: NRE interest is tax-free, NRO interest is taxed at `nroTaxRate` (Settings), by the same rule the
 * rate board uses (rates.ts afterTaxRate), with the kind and the tax taken kept for the words.
 */
export function rateAfterTax(
  rate: number,
  accountKind: string | null,
  nroTaxRate: number,
): AfterTax {
  if (accountKind === 'NRE') return { rate, kind: 'NRE', taxRate: 0 };
  if (accountKind === 'NRO')
    return { rate: afterTaxRate(rate, 'NRO', nroTaxRate), kind: 'NRO', taxRate: nroTaxRate };
  return { rate, kind: 'unknown', taxRate: null };
}

// ------------------------------------------------------------------------------------------------
// A fixed deposit
// ------------------------------------------------------------------------------------------------
export interface DepositHeadlineInput {
  today: string;
  deposit: StoredDeposit;
  /** the valuation engine's current value of this deposit (what every other page shows); null: worked out from its terms here */
  current: number | null;
  accountKind: string | null;
  /** Settings: tax on NRO interest */
  nroTaxRate: number;
  /** Settings: how far the rate implied by the bank's maturity amount may be from the stated rate (estimates.observedRateGap) */
  rateGap?: number;
  /** this bank and name in the deposit-insurance position (dicgc.ts): every deposit and balance added together, and the limit */
  cover: { limit: number; total: number } | null;
}

export interface DepositHeadline {
  state: DepositDayState;
  /** the one current value of the deposit */
  current: number;
  invested: number;
  /** interest earned and still in the deposit: Current value − Invested */
  profit: number;
  profitPct: number | null;
  /** interest already paid out to an account (Booked profit) */
  paidOut: number;
  /** the deposit's own XIRR: the principal on its booking day, each payout on its date and the current value today */
  xirr: number | null;
  statedRate: number;
  /** the rate it grows at (the stated one, or the one that reaches the bank's maturity amount) */
  rate: number;
  compounding: Compounding;
  payout: Payout;
  bookedOn: string;
  maturityOn: string;
  /** days from today to the maturity date (negative once it is past) */
  daysLeft: number;
  maturity: number;
  /** all the interest over its term */
  totalInterest: number;
  /** what is still to come: total interest less what is earned so far */
  interestToCome: number;
  /** the share of the total interest earned so far; null with no interest over the term */
  earnedShare: number | null;
  /** interest earned since 1 April (credited, paid out or still in the deposit) */
  interestFy: number;
  fyStart: string;
  afterTax: AfterTax;
  /** inside the insured limit at this bank in this name; null when the bank is outside the scheme or the limit is unknown */
  insured: { yes: boolean; limit: number; total: number } | null;
}

export function depositHeadline(i: DepositHeadlineInput): DepositHeadline {
  const d = i.deposit;
  const gap = i.rateGap ?? 0.02;
  const contract = contractOfStored(d, gap);
  const day = depositOn(contract, i.today);
  const terms = day.state === 'running' ? day.held : (day.proceeds ?? 0);
  const current = i.current ?? terms;
  const invested = Number(d.principal);
  const profit = current - invested;
  const paidOut = day.paidOut;
  const maturity = maturityAmountOf(d, gap);
  const payout = contract.payout ?? 'cumulative';
  const totalInterest = isPayout(payout) ? day.termInterest : maturity - invested;
  const earned = profit + paidOut;
  const flows = [
    { date: utc(d.booked_on), amount: -invested },
    ...payoutSchedule(contract)
      .filter((p) => p.date < i.today && p.date < d.maturity_on)
      .map((p) => ({ date: utc(p.date), amount: p.amount })),
    { date: utc(i.today), amount: current },
  ];
  const r = d.booked_on < i.today && current > 0 && invested > 0 ? xirr(flows).rate : null;
  const fyStart = fyStartOn(i.today);
  return {
    state: day.state,
    current,
    invested,
    profit,
    profitPct: invested > 0 ? profit / invested : null,
    paidOut,
    xirr: r,
    statedRate: Number(d.rate),
    rate: contract.rate,
    compounding: d.compounding,
    payout,
    bookedOn: d.booked_on,
    maturityOn: d.maturity_on,
    daysLeft: daysFrom(i.today, d.maturity_on),
    maturity,
    totalInterest,
    interestToCome: day.state === 'running' ? Math.max(0, totalInterest - earned) : 0,
    earnedShare: totalInterest > 0 ? Math.min(1, Math.max(0, earned / totalInterest)) : null,
    interestFy: depositInterestBetween(contract, fyStart, i.today),
    fyStart,
    afterTax: rateAfterTax(Number(d.rate), i.accountKind, i.nroTaxRate),
    insured:
      i.cover && i.cover.limit > 0
        ? { yes: i.cover.total <= i.cover.limit, limit: i.cover.limit, total: i.cover.total }
        : null,
  };
}

// ------------------------------------------------------------------------------------------------
// A savings account
// ------------------------------------------------------------------------------------------------
export interface SavingsHeadlineInput {
  today: string;
  /** the valuation engine's current value (what Accounts and Home show); null when the account has no balance on file */
  current: number | null;
  /** how the engine reached it: the last confirmed balance, money moved since, interest credited since and accrued, not yet credited */
  detail: {
    baseline: { date: string; amount: number };
    moved: number;
    credited: number;
    accrued: number;
  } | null;
  /** the account as the period figures read it: its rate, tax at source and every balance on file (period-gains.ts) */
  account: SavingsAccount;
  accountKind: string | null;
  /** Settings: tax on NRO interest */
  nroTaxRate: number;
  /** the family's running deposits' interest rate, weighted by principal (bank-growth.ts depositRates); null with none running */
  depositRate: number | null;
}

export interface SavingsHeadline {
  current: number;
  /** what the account earned in the last day, the rule Accounts uses for today's change */
  todayChange: number;
  /** the last balance the bank showed and its date */
  balance: { amount: number; date: string } | null;
  moved: number;
  credited: number;
  /** interest earned since the last balance and not credited yet */
  uncredited: number;
  /** the current value rests on interest worked out by the app, not on a bank figure alone */
  estimated: boolean;
  rate: number;
  afterTax: AfterTax;
  /** interest earned since 1 April, worked out from the balances on file at the account's rate after tax at source */
  interestFy: number;
  fyStart: string;
  /** what the balance earns a year more (+) or less (−) than at the deposits' rate; null without both rates */
  vsDeposits: { perYear: number; depositRate: number } | null;
}

export function savingsHeadline(i: SavingsHeadlineInput): SavingsHeadline {
  const balances = [...i.account.balances].sort((a, b) => a.date.localeCompare(b.date));
  const last = balances[balances.length - 1] ?? null;
  const balance = i.detail
    ? { amount: i.detail.baseline.amount, date: i.detail.baseline.date }
    : last
      ? { amount: last.amount, date: last.date }
      : null;
  const current = i.current ?? balance?.amount ?? 0;
  const uncredited = i.detail?.accrued ?? 0;
  const credited = i.detail?.credited ?? 0;
  const moved = i.detail?.moved ?? 0;
  const fyStart = fyStartOn(i.today);
  const fy = savingsPeriod([i.account], spanBetween(fyStart, i.today));
  const day = savingsPeriod([i.account], recentWindow(i.today, 1));
  const rate = Math.max(0, i.account.rate);
  return {
    current,
    todayChange: day.profit,
    balance,
    moved,
    credited,
    uncredited,
    estimated: Math.abs(uncredited) >= 0.5 || Math.abs(credited) >= 0.5,
    rate,
    afterTax: rateAfterTax(rate, i.accountKind, i.nroTaxRate),
    interestFy: fy.profit,
    fyStart,
    vsDeposits:
      i.depositRate !== null && current > 0
        ? { perYear: current * (rate - i.depositRate), depositRate: i.depositRate }
        : null,
  };
}

// ------------------------------------------------------------------------------------------------
// A mutual fund
// ------------------------------------------------------------------------------------------------
export type SipStatus = 'running' | 'paused' | 'stopped' | 'none';

export const SIP_STATUS_WORD: Record<SipStatus, string> = {
  running: 'Running',
  paused: 'Paused',
  stopped: 'Stopped',
  none: 'None',
};

/**
 * The SIP's status: Running, Paused until a date (nothing in force today, a later instalment amount planned), Stopped, or None.
 * `plan` is the dated SIP plan when there is one (the amount in force today and the next planned change).
 */
export function sipStatus(i: {
  monthly: number | null;
  stopped: boolean;
  plan?: { now: number; next: { on: string; monthly: number } | null } | null;
}): { status: SipStatus; until: string | null; monthly: number | null } {
  const p = i.plan ?? null;
  if (p && p.now === 0 && p.next && p.next.monthly > 0)
    return { status: 'paused', until: p.next.on, monthly: p.next.monthly };
  if (p && p.now > 0) return { status: 'running', until: null, monthly: p.now };
  if (i.monthly && i.monthly > 0)
    return i.stopped
      ? { status: 'stopped', until: null, monthly: i.monthly }
      : { status: 'running', until: null, monthly: i.monthly };
  return { status: 'none', until: null, monthly: null };
}

/** How far your XIRR is from the benchmark's on the same money, in percentage points; null without both. */
export function pointsAhead(yours: number | null, bench: number | null): number | null {
  if (yours === null || bench === null || !Number.isFinite(yours) || !Number.isFinite(bench))
    return null;
  return Math.round((yours - bench) * 1000) / 10;
}
