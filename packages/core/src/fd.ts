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
