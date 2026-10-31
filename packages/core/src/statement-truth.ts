/**
 * The bank's own balances, from its statement lines, as the truth for the days its statements cover:
 *
 *  - each account's balance at the end of each day it had lines (the bank prints the balance after every line; within a day the
 *    lines may come in any order, so the day's end is the one balance no other line of the day starts from);
 *  - those balances at each month's last day with lines, and each statement's closing balance, become the account's records inside
 *    the periods its statements cover, in place of balances typed or copied from the monthly sheet (rule 1). A typed balance there
 *    that is not the bank's is listed as a disagreement;
 *  - the coverage map (rule 2): for every account, the months its statements cover in full, in part or not at all, and the breaks in
 *    the chain: days between two statements no statement covers, and a statement that does not open where the one before closed.
 *
 * Pure: no I/O.
 */

export interface TruthLine {
  assetId: string;
  date: string;
  amount: number;
  balance: number | null;
}

export interface TruthStatement {
  assetId: string;
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
}

export interface BankPoint {
  date: string;
  amount: number;
}

const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const addDay = (iso: string, n = 1) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const lastDayOf = (month: string) => addDay(`${nextMonth(month)}-01`, -1);
const nextMonth = (month: string) => {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * The balance at the end of each day with lines, by account, oldest first. Within a day: the balance no other line of the day
 * starts from (a line starts from its balance less its amount); when that does not decide (equal amounts, no balances), the day
 * before's end plus the day's lines, if a line's balance agrees; otherwise the day is left out.
 */
export function dayEndBalances(lines: readonly TruthLine[]): Map<string, BankPoint[]> {
  const byAcct = new Map<string, Map<string, TruthLine[]>>();
  for (const l of lines) {
    const days = byAcct.get(l.assetId) ?? new Map<string, TruthLine[]>();
    days.set(l.date, [...(days.get(l.date) ?? []), l]);
    byAcct.set(l.assetId, days);
  }
  const out = new Map<string, BankPoint[]>();
  for (const [acct, days] of byAcct) {
    const pts: BankPoint[] = [];
    let prev: number | null = null;
    for (const date of [...days.keys()].sort()) {
      const ls = days.get(date)!;
      const told = ls.filter((l) => l.balance !== null);
      const net = ls.reduce((a, l) => a + l.amount, 0);
      let end: number | null = null;
      const ends = told.filter(
        (l) => !told.some((m) => m !== l && near(m.balance! - m.amount, l.balance!)),
      );
      if (ends.length === 1) end = ends[0]!.balance!;
      else if (prev !== null && told.some((l) => near(l.balance!, prev! + net)))
        end = Math.round((prev + net) * 100) / 100;
      else if (told.length === 1) end = told[0]!.balance!;
      if (end !== null) {
        pts.push({ date, amount: end });
        prev = end;
      } else prev = prev === null ? null : prev + net;
    }
    out.set(acct, pts);
  }
  return out;
}

export interface BankTruth {
  /** each account's balances from the bank: the last day with lines in each month, and each statement's closing day */
  points: Record<string, BankPoint[]>;
  /** the periods each account's statements cover, merged where they touch or overlap */
  spans: Record<string, { from: string; to: string }[]>;
  /** every day's end balance, to compare a typed balance with */
  dayEnds: Record<string, BankPoint[]>;
  /**
   * the balances the bank's alert e-mails gave (the balance after the last alert of a day), outside the periods a statement covers:
   * each is the bank's own balance on its day, and stands as the account's record for that day. Alerts never cover a month in full
   * (a payment with no alert may be missing), so they replace only a typed balance of the same day
   */
  alerts?: Record<string, BankPoint[]>;
  /**
   * accounts whose statements do not agree with the balances typed for them (trustBank): their balances are not used, and the
   * account is listed to check that its statements are its own (two accounts with the same last four digits)
   */
  untrusted?: string[];
}

/** Merges periods that touch or overlap. */
function merge(spans: { from: string; to: string }[]): { from: string; to: string }[] {
  const xs = [...spans].sort((a, b) => a.from.localeCompare(b.from));
  const out: { from: string; to: string }[] = [];
  for (const s of xs) {
    const last = out[out.length - 1];
    if (last && s.from <= addDay(last.to)) {
      if (s.to > last.to) last.to = s.to;
    } else out.push({ ...s });
  }
  return out;
}

export function bankTruth(
  lines: readonly TruthLine[],
  statements: readonly TruthStatement[],
  /** the lines of the bank's alert e-mails (kept apart from statements) */
  alertLines: readonly TruthLine[] = [],
): BankTruth {
  const ends = dayEndBalances(lines);
  const spansBy = new Map<string, { from: string; to: string }[]>();
  for (const s of statements)
    spansBy.set(s.assetId, [...(spansBy.get(s.assetId) ?? []), { from: s.from, to: s.to }]);
  const points: Record<string, BankPoint[]> = {};
  const spans: Record<string, { from: string; to: string }[]> = {};
  const dayEnds: Record<string, BankPoint[]> = {};
  for (const [acct, raw] of spansBy) {
    spans[acct] = merge(raw);
    const de = ends.get(acct) ?? [];
    dayEnds[acct] = de;
    const byMonth = new Map<string, BankPoint>();
    for (const p of de) byMonth.set(p.date.slice(0, 7), p);
    const pts = new Map<string, number>([...byMonth.values()].map((p) => [p.date, p.amount]));
    // a statement's closing balance on its last day (a month with no line still has the bank's balance)
    for (const s of statements)
      if (s.assetId === acct && s.closing !== null && !pts.has(s.to)) pts.set(s.to, s.closing);
    points[acct] = [...pts]
      .map(([date, amount]) => ({ date, amount }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  // alert balances: a day's last balance from the alerts, where no statement covers that day
  const alerts: Record<string, BankPoint[]> = {};
  for (const [acct, pts] of dayEndBalances(alertLines)) {
    const sp = spans[acct] ?? merge(spansBy.get(acct) ?? []);
    const outside = pts.filter((p) => !inside(p.date, sp));
    if (outside.length) alerts[acct] = outside;
  }
  return { points, spans, dayEnds, alerts };
}

const inside = (d: string, spans: readonly { from: string; to: string }[]) =>
  spans.some((s) => d >= s.from && d <= s.to);

/**
 * An account's records with the bank's balances in the periods its statements cover: a typed or sheet balance dated inside them is
 * replaced by the bank's own balances (each month's last day with lines and each statement's close) when the bank gives one that
 * month; outside them, or in a month the bank's lines give no balance, it stays. Alerts alone never replace a typed balance (they
 * are not a statement covering a period).
 */
export function withBankBalances<R extends { date: string; amount: number; sheet?: boolean }>(
  records: readonly R[],
  points: readonly BankPoint[] | undefined,
  spans: readonly { from: string; to: string }[] | undefined,
  make: (p: BankPoint) => R,
  /** the balances the bank's alerts gave: each is the record of its day (a typed balance of the same day gives way) */
  alerts: readonly BankPoint[] = [],
): R[] {
  if (!points?.length || !spans?.length) return withAlerts([...records], alerts, make);
  // a typed balance gives way only where the bank has a balance of its own in the same month: a statement whose lines carry no
  // balance replaces nothing
  const months = new Set(
    points.filter((p) => inside(p.date, spans)).map((p) => p.date.slice(0, 7)),
  );
  const kept = records.filter(
    (r) => r.sheet || !inside(r.date, spans) || !months.has(r.date.slice(0, 7)),
  );
  return withAlerts(
    [...kept, ...points.filter((p) => inside(p.date, spans)).map(make)].sort((a, b) =>
      a.date.localeCompare(b.date),
    ),
    alerts,
    make,
  );
}

/** Adds the alerts' balances as records of their days: a typed balance of the same day gives way to the bank's. */
function withAlerts<R extends { date: string; amount: number; sheet?: boolean }>(
  records: R[],
  alerts: readonly BankPoint[],
  make: (p: BankPoint) => R,
): R[] {
  if (!alerts.length) return records;
  const days = new Set(alerts.map((a) => a.date));
  return [...records.filter((r) => r.sheet || !days.has(r.date)), ...alerts.map(make)].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
}

export interface Disagreement {
  assetId: string;
  date: string;
  typed: number;
  bank: number;
}

/** Typed balances inside a covered period that are not the bank's balance at the end of that day (or its last day with lines before). */
export function disagreements(
  records: readonly { assetId: string; date: string; amount: number }[],
  truth: BankTruth,
  tolerance: number,
): Disagreement[] {
  const out: Disagreement[] = [];
  for (const r of records) {
    const spans = truth.spans[r.assetId];
    if (!spans || !inside(r.date, spans)) continue;
    const before = (truth.dayEnds[r.assetId] ?? []).filter((p) => p.date <= r.date).pop();
    if (!before) continue;
    if (!near(before.amount, r.amount, Math.max(1, tolerance)))
      out.push({ assetId: r.assetId, date: r.date, typed: r.amount, bank: before.amount });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

export interface StatementCoverageRow {
  assetId: string;
  /** months from the first to the last that should be covered, each in full, in part or not at all */
  months: { key: string; state: 'full' | 'part' | 'none' }[];
  full: number;
  /** the missing months as ranges ("2021-04 to 2021-06") */
  missing: { from: string; to: string }[];
  /** breaks in the chain of statements */
  breaks: (
    | { kind: 'gap'; from: string; to: string }
    | { kind: 'balance'; on: string; closed: number; opened: number }
  )[];
}

/**
 * The coverage map: for each account, the months from `from` (its first record or first statement, whichever is earlier) to `to`
 * (today, or its last record when no longer held), and how much of each its statements cover; and the breaks between statements.
 */
export function statementCoverage(
  accounts: readonly { assetId: string; from: string; to: string }[],
  statements: readonly TruthStatement[],
): StatementCoverageRow[] {
  return accounts.map((a) => {
    const own = statements
      .filter((s) => s.assetId === a.assetId)
      .sort((x, y) => x.from.localeCompare(y.from));
    const spans = merge(own.map((s) => ({ from: s.from, to: s.to })));
    const months: StatementCoverageRow['months'] = [];
    for (let m = a.from.slice(0, 7); m <= a.to.slice(0, 7); m = nextMonth(m)) {
      const start = m === a.from.slice(0, 7) ? a.from : `${m}-01`;
      const end = m === a.to.slice(0, 7) ? a.to : lastDayOf(m);
      const full = spans.some((s) => s.from <= start && s.to >= end);
      const part = !full && spans.some((s) => s.from <= end && s.to >= start);
      months.push({ key: m, state: full ? 'full' : part ? 'part' : 'none' });
    }
    const missing: StatementCoverageRow['missing'] = [];
    for (const m of months) {
      if (m.state === 'full') continue;
      const last = missing[missing.length - 1];
      if (last && nextMonth(last.to) === m.key) last.to = m.key;
      else missing.push({ from: m.key, to: m.key });
    }
    const breaks: StatementCoverageRow['breaks'] = [];
    for (let i = 1; i < own.length; i++) {
      const p = own[i - 1]!;
      const n = own[i]!;
      if (n.from > addDay(p.to))
        breaks.push({ kind: 'gap', from: addDay(p.to), to: addDay(n.from, -1) });
      if (
        n.from <= addDay(p.to) &&
        n.from >= p.to &&
        p.closing !== null &&
        n.opening !== null &&
        !near(p.closing, n.opening)
      )
        breaks.push({ kind: 'balance', on: n.from, closed: p.closing, opened: n.opening });
    }
    return {
      assetId: a.assetId,
      months,
      full: months.filter((m) => m.state === 'full').length,
      missing,
      breaks,
    };
  });
}

/** The last day of the month before today's: a statement for the month still running is not out yet, so it is never missing. */
export function lastFinishedMonthEnd(today: string): string {
  return addDay(`${today.slice(0, 7)}-01`, -1);
}

/**
 * Whether an account's statements are its own. They were filed to it by the bank, its last four digits and whose they are, so they
 * are trusted, and where a typed balance differs the bank's is right (a typed one may be stale). Only when the bank's balances
 * clearly belong to another account at the same bank are they set aside: they agree with fewer than half of this account's typed
 * balances, and with at least `share` of another's (three or more to judge by). Balances of nil are left out of the judging, as
 * they agree with any empty account.
 */
export function trustBank(
  truth: BankTruth,
  records: readonly { assetId: string; date: string; amount: number }[],
  /** the other accounts at the same bank, by account */
  peersOf: (assetId: string) => string[] = () => [],
  share = 0.8,
): BankTruth {
  const untrusted: string[] = [];
  const agree = (id: string, owner: string) => {
    const spans = truth.spans[owner]!;
    const judged = records
      .filter((r) => r.assetId === id && inside(r.date, spans) && Math.abs(r.amount) >= 1)
      .map((r) => {
        const b = (truth.dayEnds[owner] ?? []).filter((p) => p.date <= r.date).pop();
        if (!b || Math.abs(b.amount) < 1) return null;
        return Math.abs(b.amount - r.amount) <= Math.max(1, 0.01 * Math.abs(b.amount));
      })
      .filter((x): x is boolean => x !== null);
    return {
      n: judged.length,
      share: judged.length ? judged.filter(Boolean).length / judged.length : 0,
    };
  };
  for (const id of Object.keys(truth.spans)) {
    const own = agree(id, id);
    if (own.n === 0 || own.share >= 0.5) continue;
    const better = peersOf(id).some((p) => {
      const o = agree(p, id);
      return o.n >= 3 && o.share >= share;
    });
    if (better) untrusted.push(id);
  }
  if (!untrusted.length) return { ...truth, untrusted };
  const points = { ...truth.points };
  const spans = { ...truth.spans };
  const alerts = { ...(truth.alerts ?? {}) };
  for (const id of untrusted) {
    delete points[id];
    delete spans[id];
    delete alerts[id];
  }
  return { ...truth, points, spans, alerts, untrusted };
}
