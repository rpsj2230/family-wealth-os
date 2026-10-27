import type { FdLine } from './deposits';

/** A deposit that needs a decision: it matured and nobody has said where the money went. */
export const needsConfirmation = (f: FdLine): boolean =>
  f.status === 'matured_unconfirmed' || (f.status === 'active' && f.daysLeft < 0);

/** The state of a deposit in plain words. */
export function depositStatusWord(f: FdLine): string {
  if (needsConfirmation(f)) return 'Matured, to confirm';
  switch (f.status) {
    case 'active':
      return 'Running';
    case 'renewed':
      return 'Renewed';
    case 'closed':
      return 'Closed';
    case 'matured':
      return 'Matured';
    default:
      return f.status.replace(/_/g, ' ');
  }
}

export interface DepositSummary {
  /** deposits still running (counted in net worth) */
  running: FdLine[];
  runningCount: number;
  /** their value today, with interest earned so far */
  runningValue: number;
  runningPrincipal: number;
  /** average interest rate, weighted by the amount in each deposit */
  averageRate: number | null;
  /** maturing within the window, soonest first */
  soon: FdLine[];
  soonTotal: number;
  /** matured and waiting for the person to say what happened */
  confirm: FdLine[];
  /** the next deposit to mature, if any */
  next: FdLine | null;
}

export interface MonthGroup {
  month: string;
  total: number;
  items: FdLine[];
}

/** Running deposits grouped by the month they mature, oldest month first. A deposit's bank figure is used when there is one. */
export function groupByMonth(fds: FdLine[]): MonthGroup[] {
  const map = new Map<string, FdLine[]>();
  for (const f of [...fds].sort((a, b) => a.maturityOn.localeCompare(b.maturityOn))) {
    if (f.status !== 'active' || f.daysLeft < 0) continue;
    const key = f.maturityOn.slice(0, 7);
    map.set(key, [...(map.get(key) ?? []), f]);
  }
  return [...map.entries()].map(([month, items]) => ({
    month,
    total: items.reduce((s, i) => s + (i.bankMaturity ?? i.accruedToday), 0),
    items,
  }));
}

/** The few figures at the top of the Deposits page. Pure, so the arithmetic is tested. */
export function summariseDeposits(fds: FdLine[], windowDays: number): DepositSummary {
  const running = fds.filter((f) => f.status === 'active' && f.daysLeft >= 0);
  const runningPrincipal = running.reduce((s, f) => s + f.principal, 0);
  const soon = running
    .filter((f) => f.daysLeft <= windowDays)
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const next = [...running].sort((a, b) => a.daysLeft - b.daysLeft)[0] ?? null;
  return {
    running,
    runningCount: running.length,
    runningValue: running.reduce((s, f) => s + f.accruedToday, 0),
    runningPrincipal,
    averageRate:
      runningPrincipal > 0
        ? running.reduce((s, f) => s + f.rate * f.principal, 0) / runningPrincipal
        : null,
    soon,
    soonTotal: soon.reduce((s, f) => s + (f.bankMaturity ?? f.accruedToday), 0),
    // matured within the window and not confirmed; older ones are hidden (they are in no total either)
    confirm: fds.filter((f) => needsConfirmation(f) && f.listState !== 'hidden'),
    next,
  };
}
