import { fdValueOn } from '@fwos/core';
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

/** One maturity window: the running deposits that mature within that many days from today (each window includes the shorter ones). */
export interface MaturityWindow {
  days: number;
  count: number;
  principal: number;
  /** what they pay on their dates: the bank's amount where it is on file, else the value worked out from the terms */
  comesBack: number;
}

/** Running deposits by the maturity windows in Settings (deposits.maturityAlertDays), shortest first. Pure. */
export function maturityWindows(fds: FdLine[], windows: readonly number[]): MaturityWindow[] {
  const running = fds.filter((f) => f.status === 'active' && f.daysLeft >= 0);
  return [...new Set(windows)]
    .sort((a, b) => a - b)
    .map((days) => {
      const inside = running.filter((f) => f.daysLeft <= days);
      return {
        days,
        count: inside.length,
        principal: inside.reduce((s, f) => s + f.principal, 0),
        comesBack: inside.reduce((s, f) => s + (f.bankMaturity ?? f.accruedToday), 0),
      };
    });
}

export interface InterestAhead {
  /** the first day after the period: today plus twelve months */
  until: string;
  total: number;
  /** of which from deposits that mature inside the period (the rest is interest still building up at its end) */
  fromMaturing: number;
  /** interest by the month it is earned in, oldest first (YYYY-MM) */
  byMonth: { month: string; amount: number }[];
  /** per deposit, largest first */
  rows: {
    id: string;
    bank: string;
    owner: string;
    ownerId: string;
    maturityOn: string;
    amount: number;
    matures: boolean;
  }[];
}

const addMonthsIso = (iso: string, months: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

/**
 * Interest the running deposits are expected to earn over the next twelve months, before tax, from their terms (principal, rate,
 * booking date and compounding): from today to the earlier of the maturity date and twelve months on. A deposit maturing inside the
 * period earns up to its maturity amount (the bank's amount when it is on file). Money paid back at maturity is not assumed to be
 * put in a new deposit, so nothing is counted after a deposit matures. An estimate: the bank's own figures decide.
 */
export function interestAhead(fds: FdLine[], todayIso: string): InterestAhead {
  const until = addMonthsIso(todayIso, 12);
  const byMonth = new Map<string, number>();
  const rows: InterestAhead['rows'] = [];
  for (const f of fds) {
    if (f.status !== 'active' || f.daysLeft < 0 || !(f.principal > 0)) continue;
    const end = f.maturityOn < until ? f.maturityOn : until;
    const value = (iso: string) =>
      fdValueOn({
        principal: f.principal,
        annualRate: f.rate,
        bookedOn: at(f.bookedOn),
        asOf: at(iso),
        maturityOn: at(f.maturityOn),
        ...(f.compounding ? { compounding: f.compounding } : {}),
      });
    const start = todayIso < f.bookedOn ? f.bookedOn : todayIso;
    const matures = f.maturityOn < until;
    // the bank's amount is used for the end when the deposit matures inside the period and it is on file
    const endValue = matures && f.bankMaturity !== null ? f.bankMaturity : value(end);
    const amount = Math.max(0, endValue - value(start));
    if (amount <= 0) continue;
    rows.push({
      id: f.id,
      bank: f.bank,
      owner: f.owner,
      ownerId: f.ownerId,
      maturityOn: f.maturityOn,
      amount,
      matures,
    });
    // spread over the months by the share of the days in each (interest builds up day by day)
    const days = Math.max(1, (at(end).getTime() - at(start).getTime()) / 86_400_000);
    for (let cur = start; cur < end;) {
      const next = addMonthsIso(`${cur.slice(0, 7)}-01`, 1);
      const stop = next < end ? next : end;
      const share = (at(stop).getTime() - at(cur).getTime()) / 86_400_000 / days;
      byMonth.set(cur.slice(0, 7), (byMonth.get(cur.slice(0, 7)) ?? 0) + amount * share);
      cur = stop;
    }
  }
  rows.sort((a, b) => b.amount - a.amount);
  return {
    until,
    total: rows.reduce((s, r) => s + r.amount, 0),
    fromMaturing: rows.filter((r) => r.matures).reduce((s, r) => s + r.amount, 0),
    byMonth: [...byMonth.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, amount]) => ({ month, amount })),
    rows,
  };
}
