/**
 * How the money in banks is growing, for Accounts and Deposits: the deposits' XIRR, the rate savings earned this financial year, the
 * two together at today's rates, and the interest each earned since 1 April. Worked out by the same capital ledger as Home over the
 * bank holdings alone (deposits and savings), so a figure here is the figure Home shows for the same money. Pure: no I/O.
 */
import { capitalLedger, wealthMovement, type LedgerMove } from './capital';
import { depositsXirr, earningRateNow, savingsRateEarned, type ClassYearly } from './class-yearly';
import type { PositionInput } from './position';

export interface BankGrowth {
  fd: ClassYearly | null;
  savings: ClassYearly | null;
  /** Earning rate now of the money in banks: deposits at their XIRR, savings at the rate earned, weighted by value */
  banks: { rate: number; perYear: number } | null;
  /** interest earned since the financial year began; null before the records reach it */
  interestFy: { deposits: number; savings: number; total: number } | null;
  fyStart: string;
  /** the running deposits' interest rates weighted by principal, and NRO after Indian tax (NRE interest is tax-free) */
  rates: DepositRates;
  /** what the savings would earn more a year at the deposits' average rate than at the rate they earned; null without both rates */
  savingsGap: number | null;
}

export interface DepositRates {
  all: number | null;
  nre: { rate: number; principal: number; count: number } | null;
  nro: { rate: number; principal: number; count: number; afterTax: number } | null;
}

/** The deposits' rates weighted by principal: all of them, the NRE ones, and the NRO ones with the rate left after tax. */
export function depositRates(
  deposits: { principal: number; rate: number; kind: string | null }[],
  nroTaxRate: number,
): DepositRates {
  const avg = (list: typeof deposits) => {
    const p = list.reduce((a, d) => a + d.principal, 0);
    return p > 0
      ? {
          rate: list.reduce((a, d) => a + d.principal * d.rate, 0) / p,
          principal: p,
          count: list.length,
        }
      : null;
  };
  const live = deposits.filter((d) => d.principal > 0 && Number.isFinite(d.rate));
  const nro = avg(live.filter((d) => d.kind === 'NRO'));
  return {
    all: avg(live)?.rate ?? null,
    nre: avg(live.filter((d) => d.kind === 'NRE')),
    nro: nro ? { ...nro, afterTax: nro.rate * (1 - nroTaxRate) } : null,
  };
}

const BANK_TYPES = new Set(['bank_account', 'fixed_deposit']);

/** The engine's input narrowed to the bank holdings (and to one person when asked). */
export function bankPosition(position: PositionInput, owner: string | null = null): PositionInput {
  return {
    ...position,
    assets: position.assets.filter(
      (a) => BANK_TYPES.has(a.type) && (owner === null || a.ownerId === owner),
    ),
  };
}

export function bankGrowth(a: {
  /** the bank holdings only (bankPosition) */
  position: PositionInput;
  moves: LedgerMove[];
  openingDate?: string | null;
  reinvestDays?: number;
  /** the running deposits as the page lists them: principal, booking day and today's value */
  deposits: { principal: number; bookedOn: string; value: number }[];
  fdNow: number;
  cashNow: number;
  /** each running deposit's principal, rate and NRE/NRO kind, for the average rate */
  rateRows?: { principal: number; rate: number; kind: string | null }[];
  /** Settings: tax on NRO interest */
  nroTaxRate?: number;
}): BankGrowth {
  const today = a.position.config.today;
  const ledger = capitalLedger({
    position: a.position,
    moves: a.moves,
    openingDate: a.openingDate ?? null,
    ...(a.reinvestDays !== undefined ? { reinvestDays: a.reinvestDays } : {}),
  });
  const fy = wealthMovement(ledger, 'fy', today);
  const fd = depositsXirr(a.deposits, today);
  const savings = fy.figures
    ? savingsRateEarned(fy.figures.earnings.savings, a.cashNow, fy.from, today)
    : null;
  const rates = depositRates(a.rateRows ?? [], a.nroTaxRate ?? 0);
  const banks = earningRateNow([
    { key: 'fd', value: a.fdNow, rate: fd?.rate ?? null },
    { key: 'cash', value: a.cashNow, rate: savings?.rate ?? null },
  ]);
  return {
    fd,
    savings,
    banks: banks ? { rate: banks.rate, perYear: banks.perYear } : null,
    interestFy: fy.figures
      ? {
          deposits: fy.figures.earnings.deposits,
          savings: fy.figures.earnings.savings,
          total: fy.figures.earnings.deposits + fy.figures.earnings.savings,
        }
      : null,
    fyStart: fy.from,
    rates,
    savingsGap:
      rates.all !== null && savings && a.cashNow > 0
        ? a.cashNow * (rates.all - savings.rate)
        : null,
  };
}
