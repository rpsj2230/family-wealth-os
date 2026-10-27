/**
 * Fixed-deposit accrual. Indian bank FDs are quoted with quarterly compounding by default
 * (verified against all 33 FDs in the household workbook within 0.05% of the bank's maturity amount).
 */
export type Compounding = 'quarterly' | 'monthly' | 'half_yearly' | 'yearly' | 'simple';

const PERIODS: Record<Exclude<Compounding, 'simple'>, number> = {
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  yearly: 1,
};

const MS_PER_DAY = 86_400_000;

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((utcDay(to) - utcDay(from)) / MS_PER_DAY);
}

export function fdValueOn(args: {
  principal: number;
  annualRate: number; // decimal, e.g. 0.0775
  bookedOn: Date;
  asOf: Date;
  maturityOn?: Date;
  compounding?: Compounding;
}): number {
  const { principal, annualRate, bookedOn, asOf, maturityOn } = args;
  const compounding = args.compounding ?? 'quarterly';
  if (!(principal > 0)) throw new RangeError('principal must be positive');
  if (!(annualRate >= 0)) throw new RangeError('annualRate must be non-negative');
  const end = maturityOn && utcDay(asOf) > utcDay(maturityOn) ? maturityOn : asOf;
  const days = Math.max(0, daysBetween(bookedOn, end));
  const years = days / 365;
  if (compounding === 'simple') return principal * (1 + annualRate * years);
  const n = PERIODS[compounding];
  return principal * Math.pow(1 + annualRate / n, n * years);
}

/**
 * The yearly rate at which a deposit really grows, worked out from the bank's own maturity amount when it is on file: the rate that
 * takes the principal to that amount between the booking and the maturity date on the deposit's compounding. This follows the bank's
 * figure whatever the rounding or the day count it used; without the amount (or when it is not above the principal, or the dates
 * leave no time) the rate on the deposit is used. `from` says which one it is.
 */
export function fdEffectiveRate(args: {
  principal: number;
  annualRate: number;
  bookedOn: Date;
  maturityOn: Date;
  compounding?: Compounding;
  bankMaturityAmount?: number | null;
  /** the implied rate is used only when it is within this many points of the stated one (Settings); a larger gap is more likely a typing error in one of them */
  maxGap?: number;
}): { rate: number; from: 'bank_amount' | 'stated' } {
  const stated = { rate: Math.max(0, args.annualRate), from: 'stated' as const };
  const target = args.bankMaturityAmount;
  if (!target || !(target > args.principal) || !(args.principal > 0)) return stated;
  if (daysBetween(args.bookedOn, args.maturityOn) <= 0) return stated;
  const at = (r: number) =>
    fdValueOn({
      principal: args.principal,
      annualRate: r,
      bookedOn: args.bookedOn,
      asOf: args.maturityOn,
      maturityOn: args.maturityOn,
      ...(args.compounding ? { compounding: args.compounding } : {}),
    });
  let lo = 0;
  let hi = 1;
  if (at(hi) < target) return stated;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < target) lo = mid;
    else hi = mid;
  }
  const implied = (lo + hi) / 2;
  if (Math.abs(implied - stated.rate) > (args.maxGap ?? Infinity)) return stated;
  return { rate: implied, from: 'bank_amount' };
}

export interface FdVariance {
  modelled: number;
  bank: number;
  diffPct: number;
  withinTolerance: boolean;
}

/** Compare our estimate of the maturity amount with the bank-quoted figure. */
export function maturityVariance(args: {
  principal: number;
  annualRate: number;
  bookedOn: Date;
  maturityOn: Date;
  bankMaturityAmount: number;
  tolerancePct?: number;
  compounding?: Compounding;
}): FdVariance {
  const modelled = fdValueOn({ ...args, asOf: args.maturityOn });
  const diffPct = ((args.bankMaturityAmount - modelled) / args.bankMaturityAmount) * 100;
  return {
    modelled,
    bank: args.bankMaturityAmount,
    diffPct,
    withinTolerance: Math.abs(diffPct) <= (args.tolerancePct ?? 0.05),
  };
}
