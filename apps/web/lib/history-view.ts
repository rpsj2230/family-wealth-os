/**
 * What the Import page shows for "History from all monthly tabs", worked out from the planner's answer. Pure: no database, no React.
 * The planner keeps every line it would write; the browser only ever gets this lighter view (the server plans again from the file
 * for each month it imports).
 */
import { describeMonths, formatInr, longDate, monthLabel } from '@fwos/core';
import type { HistoryConflict, HistoryMonth, HistoryPlan, HistorySummary } from '@fwos/ingest';

export type ViewMonth = Omit<HistoryMonth, 'writes' | 'fdRefFills' | 'groupKeys'>;

export interface ViewHistorical {
  key: string;
  kind: 'fd' | 'cash';
  label: string;
  ownerName: string;
  bank: string | null;
  firstSeen: string;
  lastSeen: string;
  endedOn: string;
  status: 'closed' | 'matured';
  principal: number | null;
  rate: number | null;
  maturityOn: string | null;
  startEstimated: boolean;
  gaps: number;
  skipReason: string | null;
}

export interface HistoryView {
  months: ViewMonth[];
  skipped: { tab: string; reason: string }[];
  historical: ViewHistorical[];
  conflicts: HistoryConflict[];
  renewals: HistoryPlan['renewals'];
  summary: HistorySummary;
}

export function toView(plan: HistoryPlan): HistoryView {
  return {
    months: plan.months.map(({ writes: _w, fdRefFills: _f, groupKeys: _g, ...m }) => m),
    skipped: plan.skipped,
    historical: plan.historical.map((h) => ({
      key: h.key,
      kind: h.kind,
      label: h.label,
      ownerName: h.ownerName,
      bank: h.bank,
      firstSeen: h.firstSeen,
      lastSeen: h.lastSeen,
      endedOn: h.endedOn,
      status: h.status,
      principal: h.fd?.principal ?? null,
      rate: h.fd?.rate ?? null,
      maturityOn: h.fd?.maturityOn ?? null,
      startEstimated: h.fd?.startEstimated ?? false,
      gaps: h.gaps,
      skipReason: h.skipReason,
    })),
    conflicts: plan.conflicts,
    renewals: plan.renewals,
    summary: plan.summary,
  };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "28 months found, Jun 2021 to Oct 2026; 3 months do not add up; 12 closed deposits would be added; 5 conflicts". */
export function headline(s: HistorySummary): string {
  if (s.months === 0) return 'No tab named like a month was found.';
  const parts = [
    `${plural(s.months, 'month')} found, ${monthLabel(s.from!)} to ${monthLabel(s.to!)}`,
    s.notAdding === 0
      ? 'every month adds up'
      : `${plural(s.notAdding, 'month')} ${s.notAdding === 1 ? 'does' : 'do'} not add up`,
  ];
  if (s.doubtful > 0) parts.push(`${plural(s.doubtful, 'tab')} to date`);
  parts.push(
    `${plural(s.closedDeposits, 'closed deposit')} would be added`,
    ...(s.closedAccounts > 0 ? [`${plural(s.closedAccounts, 'closed account')}`] : []),
    plural(s.conflicts, 'conflict'),
  );
  return parts.join('; ');
}

export function asOfText(m: Pick<ViewMonth, 'asOf' | 'asOfSource'>): {
  date: string;
  source: string;
} {
  const source = {
    summary: "Summary tab's date of checking",
    cell: "the tab's own date",
    month_end: 'month end',
    today: 'today (month not over)',
  }[m.asOfSource];
  return { date: longDate(m.asOf), source };
}

/** The tick or cross for the check against the tab's own total, with the difference in rupees. */
export function checkText(m: Pick<ViewMonth, 'verdict' | 'difference' | 'checks'>): {
  mark: '✓' | '✗' | '–';
  word: string;
  detail: string;
} {
  if (m.verdict === 'unchecked')
    return { mark: '–', word: 'No total to check', detail: 'The tab has no total row.' };
  if (m.verdict === 'ok')
    return { mark: '✓', word: 'Adds up', detail: m.checks.map((c) => c.label).join('; ') };
  const bad = m.checks.filter((c) => !c.ok);
  const diff = m.difference;
  const word =
    diff !== null && Math.abs(diff) >= 1
      ? `Off by ${formatInr(Math.abs(diff))}`
      : 'Does not match the Summary';
  return { mark: '✗', word, detail: bad.map((c) => c.label).join('; ') };
}

/** The choices for a tab whose date is in doubt. The first, "not yet", keeps it out of the import. */
export function dateChoices(
  m: Pick<ViewMonth, 'tab' | 'month' | 'doubt' | 'overridden'>,
): { value: string; label: string }[] {
  if (!m.doubt && !m.overridden) return [];
  const out = [{ value: '', label: 'Not sure yet: leave this tab out' }];
  if (m.doubt?.suggested)
    out.push({ value: m.doubt.suggested, label: `${monthLabel(m.doubt.suggested)} (suggested)` });
  out.push({ value: m.month, label: `${monthLabel(m.month)} (as titled)` });
  return out;
}

/** The tabs the page selects at first: months that add up and are not in doubt. */
export const defaultSelection = (v: HistoryView): string[] =>
  v.months.filter((m) => m.defaultSelected).map((m) => m.tab);

/** The order to import in: oldest month first, and a copy only after its original. */
export function importOrder(v: HistoryView, selected: Iterable<string>): string[] {
  const pick = new Set(selected);
  return v.months
    .filter((m) => pick.has(m.tab))
    .sort(
      (a, b) =>
        a.month.localeCompare(b.month) ||
        Number(!!a.copyOf) - Number(!!b.copyOf) ||
        a.tab.localeCompare(b.tab),
    )
    .map((m) => m.tab);
}

/** Only the conflicts of the months that will be imported need an answer. */
export const conflictsOf = (v: HistoryView, selected: Iterable<string>): HistoryConflict[] => {
  const pick = new Set(selected);
  return v.conflicts.filter((c) => pick.has(c.tab));
};

export function conflictText(c: HistoryConflict): string {
  const cur = c.currency === 'INR' ? 'INR' : c.currency;
  const f = (n: number) =>
    cur === 'INR' ? formatInr(n, { decimals: n % 1 ? 2 : 0 }) : `S$${n.toLocaleString('en-IN')}`;
  return `${c.assetLabel}, ${longDate(c.asOf)}: on file ${f(c.existing.amount)} (${sourceWord(c.existing.source)}); the sheet says ${f(c.sheetAmount)}.`;
}

function sourceWord(s: string): string {
  return (
    (
      {
        manual: 'entered by hand',
        email: 'read from a bank email',
        statement: 'from a statement',
        cas: 'from a fund statement',
        workbook: 'from the workbook',
        api: 'from a connection',
        calculated: 'worked out',
      } as Record<string, string>
    )[s] ?? s
  );
}

/** Closed deposits and accounts, one plain line each. */
export function historicalText(h: ViewHistorical): string {
  const who = `${h.bank ?? 'Account'} (${h.ownerName})`;
  if (h.kind === 'fd')
    return `${who}: ${h.principal === null ? 'deposit' : formatInr(h.principal)} deposit, listed ${monthLabel(h.firstSeen)} to ${monthLabel(h.lastSeen)}, ${h.status === 'matured' ? 'matured' : 'closed early'} about ${longDate(h.endedOn)} (estimated${h.startEstimated ? ', and so is its start' : ''}).`;
  return `${who}: ${h.label}, listed ${monthLabel(h.firstSeen)} to ${monthLabel(h.lastSeen)}, closed about ${longDate(h.endedOn)} (estimated).`;
}

export function resultText(r: {
  months: number;
  failed: number;
  observations: number;
  addedAssets: number;
  checks: number;
  identical: number;
  conflictsReplaced: number;
  conflictsKept: number;
}): string {
  const bits = [
    `${plural(r.observations, 'balance')} added`,
    `${plural(r.addedAssets, 'closed record')} added`,
    `${plural(r.identical, 'value')} already on file`,
  ];
  if (r.checks) bits.push(`${plural(r.checks, 'fund value')} kept for checking`);
  if (r.conflictsReplaced)
    bits.push(`${plural(r.conflictsReplaced, 'value')} replaced as you chose`);
  if (r.conflictsKept) bits.push(`${plural(r.conflictsKept, 'conflict')} kept as on file`);
  const head = `${plural(r.months - r.failed, 'month')} imported`;
  return `${head}${r.failed ? `, ${r.failed} to run again` : ''}. ${bits.join(', ')}.`;
}

export { describeMonths };
