/**
 * Which months do we have a figure for, account by account? Built from the dated observations (balances) and the terms of the
 * deposits, so the Import page can show, in plain words, where the history is complete and where it has holes, and the "?"
 * explainers can say how far back a growth figure really goes. Pure: no I/O.
 *
 * A savings or cash account has a value in a month when any observation is dated in it. Between its first and last month a month
 * without one is a gap; after its last month an account that is still open is late (the months since it was last updated). A
 * deposit has no gaps: its value on any day follows from its terms, so every month from the one it was booked in to the one it
 * ended in (or today, while it runs) is covered by its terms.
 */
export type CoverageKind = 'cash' | 'fd';
export type CoverageState =
  /** an observation is dated in the month */
  | 'value'
  /** a deposit is held: its value follows from its terms */
  | 'terms'
  /** between the first and last month with a value, and none this month */
  | 'gap'
  /** an open account not updated since: the months after its last value */
  | 'late'
  /** before the account has a value or after it ended */
  | 'none';

export interface CoverageAccount {
  id: string;
  label: string;
  owner: string;
  bank: string | null;
  kind: CoverageKind;
  /** the asset's status: 'active', 'closed', 'matured', ... */
  status: string;
  /** a deposit: the day it was booked and the day it ended (paid out) or matures */
  from?: string | null;
  to?: string | null;
}

export interface CoverageObservation {
  asset_id: string;
  as_of: string;
  superseded_by?: string | null;
}

export interface CoverageRow {
  id: string;
  label: string;
  owner: string;
  bank: string | null;
  kind: CoverageKind;
  status: string;
  cells: { month: string; state: CoverageState }[];
  /** first and last month with a value (YYYY-MM) */
  first: string | null;
  last: string | null;
  /** months with a value */
  count: number;
  gapMonths: string[];
  lateMonths: string[];
}

export interface Coverage {
  months: string[];
  rows: CoverageRow[];
  totals: { accounts: number; withGaps: number; gaps: number; late: number; complete: number };
}

const monthOf = (d: string) => d.slice(0, 7);
const ord = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1;
const fromOrd = (o: number) => `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}`;

/** Every month from `a` to `b`, both included. */
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  for (let o = ord(a); o <= ord(b); o++) out.push(fromOrd(o));
  return out;
}

/** "Mar 2024" for "2024-03". */
export function monthLabel(m: string): string {
  const names = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${names[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
}

/** Runs of months written in words: "Jul to Sep 2021, Dec 2021". */
export function describeMonths(list: string[]): string {
  const sorted = [...new Set(list)].sort();
  const runs: string[][] = [];
  for (const m of sorted) {
    const last = runs[runs.length - 1];
    if (last && ord(m) === ord(last[last.length - 1]!) + 1) last.push(m);
    else runs.push([m]);
  }
  return runs
    .map((r) =>
      r.length === 1
        ? monthLabel(r[0]!)
        : r[0]!.slice(0, 4) === r[r.length - 1]!.slice(0, 4)
          ? `${monthLabel(r[0]!).slice(0, 3)} to ${monthLabel(r[r.length - 1]!)}`
          : `${monthLabel(r[0]!)} to ${monthLabel(r[r.length - 1]!)}`,
    )
    .join(', ');
}

const OPEN = new Set(['active', 'stopped', 'matured_unconfirmed']);

export function buildCoverage(
  accounts: CoverageAccount[],
  observations: CoverageObservation[],
  today: string,
): Coverage {
  const now = monthOf(today);
  const withValue = new Map<string, Set<string>>();
  for (const o of observations) {
    if (o.superseded_by) continue;
    const set = withValue.get(o.asset_id) ?? withValue.set(o.asset_id, new Set()).get(o.asset_id)!;
    set.add(monthOf(o.as_of));
  }
  // the grid starts at the earliest month any account has a figure for
  let start = now;
  for (const a of accounts) {
    const mine = [...(withValue.get(a.id) ?? [])];
    const first = a.kind === 'fd' ? (a.from ? monthOf(a.from) : null) : (mine.sort()[0] ?? null);
    if (first && first < start) start = first;
  }
  const months = monthsBetween(start, now);

  const rows: CoverageRow[] = accounts.map((a) => {
    const have = withValue.get(a.id) ?? new Set<string>();
    const cells: CoverageRow['cells'] = [];
    const gapMonths: string[] = [];
    const lateMonths: string[] = [];
    let first: string | null = null;
    let last: string | null = null;
    let count = 0;
    if (a.kind === 'fd') {
      const from = a.from ? monthOf(a.from) : null;
      const open = OPEN.has(a.status);
      // a running deposit is held until today; one that ended, until the month it ended in
      const ended = a.to ? monthOf(a.to) : from;
      const upto = open || ended === null || ended > now ? now : ended;
      for (const m of months) {
        const held = from !== null && m >= from && m <= upto;
        cells.push({ month: m, state: held ? 'terms' : 'none' });
        if (held) {
          count++;
          first ??= m;
          last = m;
        }
      }
    } else {
      const mine = [...have].sort();
      first = mine[0] ?? null;
      last = mine[mine.length - 1] ?? null;
      count = mine.length;
      const open = OPEN.has(a.status);
      for (const m of months) {
        let state: CoverageState = 'none';
        if (have.has(m)) state = 'value';
        else if (first && last && m > first && m < last) {
          state = 'gap';
          gapMonths.push(m);
        } else if (open && last && m > last && m < now) {
          state = 'late';
          lateMonths.push(m);
        }
        cells.push({ month: m, state });
      }
    }
    return {
      id: a.id,
      label: a.label,
      owner: a.owner,
      bank: a.bank,
      kind: a.kind,
      status: a.status,
      cells,
      first,
      last,
      count,
      gapMonths,
      lateMonths,
    };
  });
  return {
    months,
    rows,
    totals: {
      accounts: rows.length,
      withGaps: rows.filter((r) => r.gapMonths.length > 0).length,
      gaps: rows.reduce((s, r) => s + r.gapMonths.length, 0),
      late: rows.filter((r) => r.lateMonths.length > 0).length,
      complete: rows.filter((r) => r.gapMonths.length === 0 && r.lateMonths.length === 0).length,
    },
  };
}

/** One account in words: where its history begins, how far it runs and what is missing. */
export function coverageSentence(r: CoverageRow): string {
  if (r.kind === 'fd')
    return r.first
      ? `Held ${monthLabel(r.first)} to ${r.last ? monthLabel(r.last) : 'now'}; every month follows from its terms.`
      : 'No booking date on file.';
  if (!r.first) return 'No balance recorded yet.';
  const parts = [
    `Balances from ${monthLabel(r.first)} to ${monthLabel(r.last!)} (${r.count} ${r.count === 1 ? 'month' : 'months'}).`,
  ];
  if (r.gapMonths.length) parts.push(`Missing: ${describeMonths(r.gapMonths)}.`);
  if (r.lateMonths.length) parts.push(`Not updated since: ${describeMonths(r.lateMonths)}.`);
  return parts.join(' ');
}
