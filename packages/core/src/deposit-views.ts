/**
 * Two views of the fixed deposits behind the Deposits page: which bank holds how much, and what matures in which year.
 * Pure: they read the bank blocks the Accounts page already builds, so every figure agrees with the overview panel.
 */
import { OTHER_HOLDINGS_KEY, type BankBlock, type BankRow } from './accounts-view';

export interface BankShare {
  bankId: string;
  bank: string;
  count: number;
  invested: number;
  current: number;
  maturity: number;
  /** share of today's value in deposits */
  share: number;
  /** average rate, weighted by the amount invested */
  avgRate: number | null;
  next: { date: string; amount: number } | null;
}

/** A running deposit: past its date and unconfirmed ones are not part of the totals. */
const running = (r: BankRow) =>
  r.kind === 'fd' && !!r.fd && r.status === 'active' && !r.fd.needsConfirmation;

export function depositsByBank(blocks: BankBlock[], today: string): BankShare[] {
  const rows = blocks.map((b) => ({
    b,
    fds: b.sections.flatMap((s) => s.rows).filter(running),
  }));
  const total = rows.reduce((a, r) => a + r.fds.reduce((x, f) => x + (f.current ?? 0), 0), 0);
  return rows
    .filter((r) => r.fds.length > 0)
    .map(({ b, fds }) => {
      const invested = fds.reduce((a, f) => a + f.fd!.principal, 0);
      const current = fds.reduce((a, f) => a + (f.current ?? 0), 0);
      const upcoming = fds
        .filter((f) => f.fd!.maturityOn >= today)
        .sort((x, y) => x.fd!.maturityOn.localeCompare(y.fd!.maturityOn));
      const nextOn = upcoming[0]?.fd!.maturityOn ?? null;
      return {
        bankId: b.key,
        bank: b.name,
        count: fds.length,
        invested,
        current,
        maturity: fds.reduce((a, f) => a + f.fd!.maturityAmount, 0),
        share: total > 0 ? current / total : 0,
        avgRate:
          invested > 0
            ? fds.reduce((a, f) => a + f.fd!.principal * f.fd!.rate, 0) / invested
            : null,
        next: nextOn
          ? {
              date: nextOn,
              amount: upcoming
                .filter((f) => f.fd!.maturityOn === nextOn)
                .reduce((a, f) => a + f.fd!.maturityAmount, 0),
            }
          : null,
      } satisfies BankShare;
    })
    .sort((a, b) => b.current - a.current);
}

export interface MaturityYear {
  /** calendar year of maturity */
  year: string;
  count: number;
  amount: number;
}

/** What the running deposits pay, by the calendar year they mature in. */
export function maturityLadder(blocks: BankBlock[]): MaturityYear[] {
  const by = new Map<string, MaturityYear>();
  for (const f of blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)).filter(running)) {
    const year = f.fd!.maturityOn.slice(0, 4);
    const s = by.get(year) ?? { year, count: 0, amount: 0 };
    s.count += 1;
    s.amount += f.fd!.maturityAmount;
    by.set(year, s);
  }
  return [...by.values()].sort((a, b) => a.year.localeCompare(b.year));
}

/**
 * Only the fixed deposits of the banks, in the shape bankOverview() reads, so the Deposits page can show the same overview
 * as Accounts for deposits alone. Money held by others (no bank) and savings accounts are left out.
 */
export function fixedDepositBlocks(blocks: BankBlock[]): BankBlock[] {
  return blocks
    .filter((b) => b.key !== OTHER_HOLDINGS_KEY)
    .map((b) => ({
      ...b,
      sections: b.sections
        .map((s) => ({ ...s, rows: s.rows.filter((r) => r.kind === 'fd' && !!r.fd) }))
        .filter((s) => s.rows.length > 0),
    }))
    .filter((b) => b.sections.length > 0);
}
