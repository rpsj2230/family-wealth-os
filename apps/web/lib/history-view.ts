/**
 * What the Import page shows for "History from all monthly tabs", worked out from the planner's answer. Pure: no database, no React.
 * The planner keeps every line it would write; the browser only ever gets this lighter view (the server plans again from the file
 * for each month it imports).
 */
import { describeMonths, formatInr, longDate, monthLabel } from '@fwos/core';
import type {
  HistoryConflict,
  HistoryMonth,
  HistoryPlan,
  HistorySummary,
  IdentityLine,
} from '@fwos/ingest';

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

// ----------------------------------------------------------------------------------------------
// Savings and cash lines the tab does not identify: what the other tabs say, and what the person chooses
// ----------------------------------------------------------------------------------------------
/** The person's answers: line id (`tab|cell`) to an account id, or '' for "leave this line out". Sent with every request. */
export type Pins = Record<string, string>;

export interface IdentityGroup {
  tab: string;
  month: string;
  lines: IdentityLine[];
}

/** The months with lines to look at, oldest first. A copy of a tab is never imported, so its lines are not asked about. */
export function identityGroups(v: HistoryView): IdentityGroup[] {
  return v.months
    .filter((m) => !m.copyOf && m.identities.length > 0)
    .map((m) => ({ tab: m.tab, month: m.month, lines: m.identities }));
}

export const allIdentityLines = (v: HistoryView): IdentityLine[] =>
  identityGroups(v).flatMap((g) => g.lines);

/** The little label on a line: how the account was found, in words that do not need the colour. */
export function identityChip(l: Pick<IdentityLine, 'state'>): {
  word: string;
  tone: 'ok' | 'info' | 'warn' | 'muted';
} {
  switch (l.state) {
    case 'certain':
      return { word: 'inferred', tone: 'ok' };
    case 'likely':
      return { word: 'inferred, likely', tone: 'info' };
    case 'pinned':
      return { word: 'chosen by you', tone: 'ok' };
    case 'blocked':
      return { word: 'not inferred', tone: 'warn' };
    case 'left_out':
      return { word: 'left out', tone: 'muted' };
    default:
      return { word: 'which account?', tone: 'warn' };
  }
}

const amountText = (l: Pick<IdentityLine, 'amount' | 'currency'>): string =>
  l.amount === null
    ? 'no balance'
    : l.currency === 'SGD'
      ? `S$${l.amount.toLocaleString('en-IN')}`
      : formatInr(l.amount, { decimals: l.amount % 1 ? 2 : 0 });

/** "F29: ESAF (Rupash), Cash, ₹88" */
export function identityHeading(l: IdentityLine): string {
  return `${l.cell}: ${l.bank ?? 'Account'} (${l.owner}), ${l.label.trim() || 'Cash'}, ${amountText(l)}`;
}

/** The lines the same answer may be given to: same label at the same place in another tab, where the account is one of its choices. */
export function sharedLines(v: HistoryView, l: IdentityLine, accountId: string): IdentityLine[] {
  const ids = new Set(l.sameAs);
  return allIdentityLines(v).filter(
    (o) =>
      ids.has(o.id) &&
      [...o.candidates, ...o.others].some((c) => c.id === accountId) &&
      o.state !== 'certain',
  );
}

/** The answers after the person chooses an account for a line ('' leaves it out; undefined takes the choice back), and optionally for its twins. */
export function chooseAccount(
  pins: Pins,
  v: HistoryView,
  l: IdentityLine,
  accountId: string | undefined,
  alsoShared: boolean,
): Pins {
  const next = { ...pins };
  const targets = [l, ...(alsoShared && accountId ? sharedLines(v, l, accountId) : [])];
  for (const t of targets) {
    if (accountId === undefined) delete next[t.id];
    else next[t.id] = accountId;
  }
  return next;
}

/** Whether every twin of a line already has the same answer, and how many twins could take it. */
export function sharedState(
  pins: Pins,
  v: HistoryView,
  l: IdentityLine,
): { count: number; all: boolean } {
  const mine = pins[l.id];
  if (!mine) return { count: 0, all: false };
  const twins = sharedLines(v, l, mine);
  return { count: twins.length, all: twins.length > 0 && twins.every((t) => pins[t.id] === mine) };
}

/** One sentence for the whole preview: what the other tabs settled and what is left for the person. */
export function identityHeadline(s: HistorySummary['identities']): string | null {
  const done = s.certain + s.pinned;
  const todo = s.likely;
  const open = s.open + s.blocked;
  if (done + todo + open + s.leftOut === 0) return null;
  const parts: string[] = [];
  if (done > 0)
    parts.push(
      `${plural(done, 'savings line')} identified ${s.pinned > 0 && s.certain === 0 ? 'by you' : 'from the other tabs'}`,
    );
  if (todo > 0) parts.push(`${todo} to confirm`);
  if (open > 0) parts.push(`${open} still need${open === 1 ? 's' : ''} your choice`);
  if (s.leftOut > 0) parts.push(`${s.leftOut} left out`);
  return parts.join('; ');
}

/**
 * The public sample has no server to plan again, so a person's answers are applied to the sample's lines here: what a server would
 * answer for the same choices. Counts of the month follow.
 */
export function applyPins(v: HistoryView, pins: Pins): HistoryView {
  const out = structuredClone(v);
  for (const m of out.months) {
    for (const l of m.identities) {
      const was = l.accepted;
      const pin = Object.hasOwn(pins, l.id) ? pins[l.id]! : undefined;
      if (pin === '') {
        Object.assign(l, {
          state: 'left_out',
          accepted: false,
          account: null,
          why: 'You chose to leave this line out.',
        });
      } else if (pin !== undefined) {
        const a = [...l.candidates, ...l.others].find((c) => c.id === pin);
        if (a)
          Object.assign(l, {
            state: 'pinned',
            accepted: true,
            account: a,
            why: 'You chose this account.',
          });
      }
      if (l.accepted !== was) {
        const d = l.accepted ? 1 : -1;
        m.matched += d;
        m.unmatched -= d;
        m.counts.new += d;
      }
    }
  }
  out.summary = { ...out.summary, ...recount(out) };
  return out;
}

function recount(v: HistoryView): Pick<HistorySummary, 'identities' | 'matched' | 'unmatched'> {
  const c = { certain: 0, likely: 0, pinned: 0, open: 0, blocked: 0, leftOut: 0 };
  for (const l of allIdentityLines(v)) {
    if (l.state === 'certain') c.certain++;
    else if (l.state === 'likely') c.likely++;
    else if (l.state === 'pinned') c.pinned++;
    else if (l.state === 'blocked') c.blocked++;
    else if (l.state === 'left_out') c.leftOut++;
    else c.open++;
  }
  const real = v.months.filter((m) => !m.copyOf);
  return {
    identities: c,
    matched: real.reduce((s, m) => s + m.matched, 0),
    unmatched: real.reduce((s, m) => s + m.unmatched, 0),
  };
}

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
