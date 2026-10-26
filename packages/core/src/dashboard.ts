/**
 * Pure helpers behind the dashboard: shares for the allocation rings, the liquidity ladder, the list of what is coming up,
 * how fresh the data is, and a straight-line "if this pace holds" path. No I/O.
 */
import type { SeriesPoint } from './fund-series';

const DAY = 86_400_000;
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((t(to) - t(from)) / DAY);
const addDays = (d: string, n: number) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);

export interface Share {
  key: string;
  label: string;
  value: number;
  /** of the total of the positive values, 0–1 */
  share: number;
}

/**
 * Turns amounts by key into shares, largest first. Zero and negative amounts are left out; anything beyond the `top` largest
 * is folded into one "Other" share so a ring stays readable.
 */
export function toShares(
  amounts: Record<string, number>,
  labels: Record<string, string> = {},
  top = 6,
): Share[] {
  const rows = Object.entries(amounts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, v]) => s + v, 0);
  if (total <= 0) return [];
  const head = rows.slice(0, top);
  const rest = rows.slice(top).reduce((s, [, v]) => s + v, 0);
  const out = head.map(([key, value]) => ({
    key,
    label: labels[key] ?? key,
    value,
    share: value / total,
  }));
  if (rest > 0) out.push({ key: '__other', label: 'Other', value: rest, share: rest / total });
  return out;
}

/** The upper edge, in days from today, of each step of the ladder after "now". */
export const LADDER_DAYS = { d30: 30, d90: 90, d180: 180, y1: 365 } as const;

export interface LadderItem {
  name: string;
  on: string;
  amount: number;
}
export interface LadderStep {
  key: 'now' | 'd30' | 'd90' | 'd180' | 'y1' | 'later';
  label: string;
  amount: number;
  items: LadderItem[];
}

/**
 * When money becomes available without selling anything: what is in accounts now, then deposits by maturity date. Deposits that
 * should already have matured count as "now" (they only need confirming). The steps are not cumulative; `cumulative` is.
 */
export function liquidityLadder(input: {
  cashNow: number;
  deposits: { name: string; maturityOn: string; amount: number }[];
  today: string;
}): (LadderStep & { cumulative: number })[] {
  const steps: LadderStep[] = [
    { key: 'now', label: 'In accounts now', amount: input.cashNow, items: [] },
    { key: 'd30', label: `Deposits maturing in ${LADDER_DAYS.d30} days`, amount: 0, items: [] },
    { key: 'd90', label: `${LADDER_DAYS.d30 + 1}–${LADDER_DAYS.d90} days`, amount: 0, items: [] },
    { key: 'd180', label: `${LADDER_DAYS.d90 + 1}–${LADDER_DAYS.d180} days`, amount: 0, items: [] },
    { key: 'y1', label: '6–12 months', amount: 0, items: [] },
    { key: 'later', label: 'Beyond a year', amount: 0, items: [] },
  ];
  for (const d of input.deposits) {
    if (!(d.amount > 0)) continue;
    const left = daysBetween(input.today, d.maturityOn);
    const step =
      steps[
        left <= 0
          ? 0
          : left <= LADDER_DAYS.d30
            ? 1
            : left <= LADDER_DAYS.d90
              ? 2
              : left <= LADDER_DAYS.d180
                ? 3
                : left <= LADDER_DAYS.y1
                  ? 4
                  : 5
      ]!;
    step.amount += d.amount;
    step.items.push({ name: d.name, on: d.maturityOn, amount: d.amount });
  }
  let run = 0;
  return steps.map((s) => ({ ...s, cumulative: (run += s.amount) }));
}

export type EventKind = 'deposit' | 'policy' | 'task' | 'receivable' | 'tax' | 'other';
export interface UpcomingEvent {
  date: string;
  kind: EventKind;
  title: string;
  amount?: number | null;
  href: string;
}

/** Dated things in the next `withinDays` days (and anything overdue, shown first), soonest first. */
export function upcomingEvents(
  events: UpcomingEvent[],
  today: string,
  withinDays = 90,
  limit = 8,
): (UpcomingEvent & { daysLeft: number })[] {
  return events
    .map((e) => ({ ...e, daysLeft: daysBetween(today, e.date) }))
    .filter((e) => e.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.title.localeCompare(b.title))
    .slice(0, limit);
}

export interface FreshnessSummary {
  total: number;
  /** recorded within its window, or worked out from contract terms */
  fresh: number;
  aging: number;
  stale: number;
  missing: number;
  /** share (0–1) that is fresh */
  freshShare: number;
  oldestDays: number | null;
}

export function freshnessSummary(
  lines: { freshness: string; ageDays: number | null }[],
): FreshnessSummary {
  const s: FreshnessSummary = {
    total: lines.length,
    fresh: 0,
    aging: 0,
    stale: 0,
    missing: 0,
    freshShare: 0,
    oldestDays: null,
  };
  for (const l of lines) {
    if (
      l.freshness === 'current' ||
      l.freshness === 'calculated' ||
      l.freshness === 'imported_unverified'
    )
      s.fresh++;
    else if (l.freshness === 'older_than_expected') s.aging++;
    else if (l.freshness === 'stale') s.stale++;
    else s.missing++;
    if (l.ageDays !== null && (s.oldestDays === null || l.ageDays > s.oldestDays))
      s.oldestDays = l.ageDays;
  }
  s.freshShare = s.total > 0 ? s.fresh / s.total : 1;
  return s;
}

/** Change over the last `days` days from a dated series: the amount, the share, and the value it started from. */
export function changeSince(
  points: { date: string; value: number }[],
  days: number,
): { amount: number; pct: number | null; from: string } | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1]!;
  const cutoff = addDays(last.date, -days);
  const base = [...points].reverse().find((p) => p.date <= cutoff);
  if (!base || base.date >= last.date) return null;
  return {
    amount: last.value - base.value,
    pct: base.value > 0 ? last.value / base.value - 1 : null,
    from: base.date,
  };
}

/** A straight line forward from the last point at `monthlyChange` a month, one point per year-end of the horizon. */
export function linearPath(
  last: { date: string; value: number },
  monthlyChange: number,
  years: number,
): SeriesPoint[] {
  const out: SeriesPoint[] = [];
  for (let y = 1; y <= years; y++) {
    const d = new Date(`${last.date}T00:00:00Z`);
    d.setUTCFullYear(d.getUTCFullYear() + y);
    out.push({
      date: d.toISOString().slice(0, 10),
      value: Math.max(0, Math.round(last.value + monthlyChange * 12 * y)),
      invested: null,
    });
  }
  return out;
}
