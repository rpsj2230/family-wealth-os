import { depositListState } from './deposit-state';
import { daysBetween } from './fd';

/** Used when no thresholds are supplied; the real ones come from Settings (deposits.maturityAlertDays). */
export const ALERT_THRESHOLDS: readonly number[] = [7, 15, 30, 60, 90];

export interface MaturingFd {
  id: string;
  name: string;
  maturityOn: Date;
  status: string;
}

export interface MaturityAlert {
  id: string;
  name: string;
  daysLeft: number;
  /** smallest alert window the FD falls into, e.g. 6 days left -> 7 */
  window: number;
}

/** FDs maturing within the largest alert window, soonest first. Already-matured or inactive FDs are not alerted here. */
export function maturityAlerts(
  fds: MaturingFd[],
  today: Date,
  thresholds: readonly number[] = ALERT_THRESHOLDS,
): MaturityAlert[] {
  const sorted = [...thresholds].sort((a, b) => a - b);
  const max = sorted[sorted.length - 1] ?? 0;
  const out: MaturityAlert[] = [];
  for (const f of fds) {
    if (f.status !== 'active') continue;
    const daysLeft = daysBetween(today, f.maturityOn);
    if (daysLeft < 0 || daysLeft > max) continue;
    const window = sorted.find((t) => daysLeft <= t)!;
    out.push({ id: f.id, name: f.name, daysLeft, window });
  }
  return out.sort((a, b) => a.daysLeft - b.daysLeft);
}

/**
 * Matured but still marked active: needs the user to confirm renewal or credit. With `hideAfterDays` (Settings: deposits.hideMaturedAfterDays)
 * one that matured longer ago than that is left out: it is hidden from the lists and no longer asked about.
 */
export function overdueMaturities(
  fds: MaturingFd[],
  today: Date,
  hideAfterDays?: number,
): MaturingFd[] {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return fds.filter(
    (f) =>
      f.status === 'active' &&
      daysBetween(f.maturityOn, today) > 0 &&
      (hideAfterDays === undefined ||
        depositListState({
          status: f.status,
          maturityOn: iso(f.maturityOn),
          today: iso(today),
          hideAfterDays,
        }) === 'confirm'),
  );
}
