/**
 * Savings and cash, the way Deposits shows deposits: which bank holds how much and what the balances earn. Pure functions over the bank
 * blocks the Accounts page builds, so every figure agrees with the overview there. Money held by others (no bank) and fixed deposits are
 * not part of this view.
 */
import { OTHER_HOLDINGS_KEY, type BankBlock, type BankRow } from './accounts-view';
import { bankRowFigures } from './bank-overview';

/** A savings account that counts in the totals. */
const counted = (r: BankRow) => r.kind === 'cash' && bankRowFigures(r).counted;

/** Only the savings accounts of the banks, in the shape bankOverview() reads. */
export function cashBlocks(blocks: BankBlock[]): BankBlock[] {
  return blocks
    .filter((b) => b.key !== OTHER_HOLDINGS_KEY)
    .map((b) => ({
      ...b,
      sections: b.sections
        .map((s) => ({ ...s, rows: s.rows.filter((r) => r.kind === 'cash') }))
        .filter((s) => s.rows.length > 0),
    }))
    .filter((b) => b.sections.length > 0);
}

export interface CashBankShare {
  bankId: string;
  bank: string;
  count: number;
  balance: number;
  /** share of all savings and cash (0 to 1) */
  share: number;
  /** average rate weighted by balance (decimal), from the rate each account earns; null when none is known */
  avgRate: number | null;
  /** interest a year at those rates, after the tax taken at source (an estimate) */
  interestYear: number;
  /** accounts whose balance is older than the freshness window */
  stale: number;
  /** the oldest balance date among the accounts, if any */
  oldest: string | null;
}

export function cashByBank(
  blocks: BankBlock[],
  /** the rate each account earns, by asset id (decimal) */
  rates: Record<string, number | undefined>,
  /** tax deducted at source on the interest (decimal) */
  tdsRate: number,
  defaultRate: number,
): CashBankShare[] {
  const rows = blocks.map((b) => ({
    b,
    accts: b.sections.flatMap((s) => s.rows).filter(counted),
  }));
  const total = rows.reduce(
    (a, r) => a + r.accts.reduce((x, f) => x + Math.max(0, f.current ?? 0), 0),
    0,
  );
  return rows
    .filter((r) => r.accts.length > 0)
    .map(({ b, accts }) => {
      const bal = (r: BankRow) => Math.max(0, r.current ?? 0);
      const balance = accts.reduce((a, r) => a + bal(r), 0);
      const rateOf = (r: BankRow) => rates[r.assetId] ?? defaultRate;
      const inr = accts.filter((r) => r.currency === 'INR');
      const inrBal = inr.reduce((a, r) => a + bal(r), 0);
      const dates = accts.map((r) => r.asOf).filter((d): d is string => !!d);
      return {
        bankId: b.key,
        bank: b.name,
        count: accts.length,
        balance,
        share: total > 0 ? balance / total : 0,
        avgRate: inrBal > 0 ? inr.reduce((a, r) => a + bal(r) * rateOf(r), 0) / inrBal : null,
        interestYear: inr.reduce((a, r) => a + bal(r) * rateOf(r) * (1 - tdsRate), 0),
        stale: accts.filter((r) => r.stale).length,
        oldest: dates.length > 0 ? dates.reduce((a, c) => (a < c ? a : c)) : null,
      } satisfies CashBankShare;
    })
    .sort((a, b) => b.balance - a.balance);
}

/** The largest single account, with its bank, for the "largest balance" figure. */
export function largestCash(
  blocks: BankBlock[],
): { code: string; bank: string; amount: number } | null {
  let best: { code: string; bank: string; amount: number } | null = null;
  for (const b of blocks)
    for (const s of b.sections)
      for (const r of s.rows) {
        if (!counted(r)) continue;
        const amount = r.current ?? 0;
        if (!best || amount > best.amount) best = { code: r.code, bank: b.name, amount };
      }
  return best;
}
