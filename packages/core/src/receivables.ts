import { daysBetween } from './fd';

export interface Receivable {
  id: string;
  lent: number;
  repayments: { amount: number; on: Date }[];
  expectedOn?: Date | null;
}

export interface ReceivableStatus {
  outstanding: number;
  repaid: number;
  status: 'settled' | 'outstanding' | 'overdue' | 'overpaid';
  daysOverdue: number;
}

/** Outstanding is computed from recorded lending and repayments only; never typed in as a balance. */
export function receivableStatus(r: Receivable, today: Date): ReceivableStatus {
  if (!(r.lent > 0)) throw new RangeError('lent must be positive');
  const repaid = r.repayments.reduce((s, p) => {
    if (!(p.amount > 0)) throw new RangeError('repayment must be positive');
    return s + p.amount;
  }, 0);
  const outstanding = Math.round((r.lent - repaid) * 100) / 100;
  if (outstanding < 0) return { outstanding, repaid, status: 'overpaid', daysOverdue: 0 };
  if (outstanding === 0) return { outstanding, repaid, status: 'settled', daysOverdue: 0 };
  const late = r.expectedOn ? daysBetween(r.expectedOn, today) : 0;
  return late > 0
    ? { outstanding, repaid, status: 'overdue', daysOverdue: late }
    : { outstanding, repaid, status: 'outstanding', daysOverdue: 0 };
}
