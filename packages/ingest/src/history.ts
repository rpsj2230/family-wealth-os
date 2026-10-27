/**
 * History from every monthly tab. `planHistory` reads each tab of the household workbook that is named like a month, in any order, and
 * says what importing it would do: which lines are accounts already on file, which belong to a deposit or account that is not (and
 * would be added as a closed, estimated record), which cannot be tied to anything, what disagrees with a value already on file, and
 * whether the tab adds up to its own total. It writes nothing; `history-import.ts` applies one month of the plan.
 *
 * Rules that matter:
 *  - a tab's date is the date of its own check when that falls in its month (the Summary tab's "Date of Checking", else the
 *    "Current / This Time" cell), otherwise the month end (never later than today); the plan says which;
 *  - a tab that cannot be what its title says (out of order among the tabs, or holding deposits that start after the month it
 *    stands for) is flagged, left out of the timeline and not selected by default; a "Copy of" tab is never allowed to win over its
 *    original;
 *  - nothing is invented: a deposit whose tab gives no start date keeps an empty start; a deposit that left is closed on the first
 *    month it is missing from, flagged as estimated; lines two accounts could be are listed, not written.
 */
import ExcelJS from 'exceljs';
import { DEFAULT_CONFIG } from '@fwos/core';
import { addDaysIso, daysBetween } from './history-dates';
import {
  classifyHistoryRow,
  detectLayout,
  monthEnd,
  outOfSequence,
  readSummary,
  tabDateCell,
  ymFromKey,
  ymKey,
  ymOrdinal,
  type DetectedLayout,
  type SummaryLine,
} from './history-layout';
import {
  bankKey,
  fdKey,
  matchDeposits,
  matchOther,
  personKey,
  type ExistingAsset,
  type HistRow,
  type RowKind,
} from './history-match';
import { formatMonthTitle, parseMonthTitle, type YearMonth } from './sheet-months';
import { DEFAULT_MINORS, DEFAULT_OWNERS, isoDate, num } from './sheet-rows';
import { cellValue, planWorksheet, type ImportPlan } from './workbook';

// ----------------------------------------------------------------------------------------------
// Inputs
// ----------------------------------------------------------------------------------------------
export interface HistoryExistingObs {
  id: string;
  assetId: string;
  asOf: string;
  amount: number;
  currency: string;
  source: string;
  sourceRef: string | null;
  confidence: string;
  supersededBy: string | null;
}

export interface HistoryExisting {
  assets: ExistingAsset[];
  observations: HistoryExistingObs[];
}

export interface HistoryOptions {
  /** YYYY-MM-DD: a month that is not over yet is dated today, never later */
  today: string;
  ownerNames?: string[];
  minors?: string[];
  defaultOwner?: string;
  existing?: HistoryExisting;
  /** the person's answer for a tab whose date is in doubt: tab title to "YYYY-MM" */
  monthOverrides?: Record<string, string>;
  /** a deposit that starts more than this many days after the end of its tab's month makes the tab suspect (Settings) */
  startsAfterDays?: number;
}

/** Source references: a value written by this importer is recognised by its reference. */
export const HIST_REF = 'hist:';
export const HIST_FUND_REF = 'histfund:';

// ----------------------------------------------------------------------------------------------
// Outputs
// ----------------------------------------------------------------------------------------------
export interface HistoryCheck {
  label: string;
  expected: number | null;
  actual: number;
  ok: boolean;
}

export interface UnmatchedRow {
  cell: string;
  label: string;
  owner: string | null;
  bank: string | null;
  amount: number | null;
  reason: string;
  /** "ambiguous" when two or more accounts could be it; "unread" when the line could not be read at all */
  why: 'not_on_file' | 'ambiguous' | 'unread' | 'not_created';
}

export interface WriteObs {
  /** tab and cell: stable */
  id: string;
  tab: string;
  cell: string;
  /** the reference stored with the value: hist:<tab>:<cell> */
  ref: string;
  /** the account on file, or null for a historical account added in this plan */
  assetId: string | null;
  groupKey: string | null;
  label: string;
  kind: 'balance' | 'valuation';
  amount: number;
  currency: 'INR' | 'SGD';
  fxRate: number | null;
  asOf: string;
  /** a fund's value kept only to check the statement against */
  check: boolean;
  status: 'new' | 'identical' | 'conflict' | 'copy_dropped';
}

export interface HistoryConflict {
  id: string;
  tab: string;
  cell: string;
  assetId: string;
  assetLabel: string;
  asOf: string;
  currency: 'INR' | 'SGD';
  sheetAmount: number;
  existing: { id: string; amount: number; source: string; confidence: string };
}

export interface HistoricalAsset {
  key: string;
  kind: 'fd' | 'cash';
  label: string;
  ownerName: string;
  bank: string | null;
  accountKind: 'NRE' | 'NRO' | null;
  joint: boolean;
  last4: string | null;
  currency: 'INR' | 'SGD';
  holderName: string | null;
  firstSeen: string;
  lastSeen: string;
  /** the first month it is missing from: when it is taken to have ended */
  endedMonth: string;
  endedOn: string;
  status: 'closed' | 'matured';
  tabs: string[];
  /** months between first and last seen with no tab listing it */
  gaps: number;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string;
    startEstimated: boolean;
    maturityOn: string;
    maturityAmount: number | null;
    ref: string | null;
  } | null;
  /** why it is not added, when it is not */
  skipReason: string | null;
}

export interface RenewalSuggestion {
  from: string;
  to: string;
  month: string;
  text: string;
}

export interface HistoryMonth {
  tab: string;
  /** the month the tab is taken to stand for, YYYY-MM */
  month: string;
  /** "Copy of Oct 2026": a copy of another tab */
  copyOf: string | null;
  asOf: string;
  asOfSource: 'summary' | 'cell' | 'month_end' | 'today';
  asOfNote: string | null;
  layout: { headerRow: number | null; standard: boolean; found: string[]; totalRef: string | null };
  rowsRead: number;
  matched: number;
  created: number;
  unmatched: number;
  unmatchedRows: UnmatchedRow[];
  checks: HistoryCheck[];
  verdict: 'ok' | 'mismatch' | 'unchecked';
  /** what was read less what the tab's own total says */
  difference: number | null;
  /** the Summary tab's total for this month, when it has one */
  summaryTotal: number | null;
  warnings: string[];
  /** why the date or the contents of this tab cannot be trusted; such a tab is not selected by default */
  doubt: {
    kinds: ('out_of_order' | 'newer_contents')[];
    text: string;
    suggested: string | null;
  } | null;
  /** a tab whose rows are close to those of a much later tab */
  likeTab: string | null;
  /** the person set the month */
  overridden: boolean;
  counts: {
    new: number;
    identical: number;
    conflicts: number;
    copyDropped: number;
    checks: number;
  };
  selectable: boolean;
  defaultSelected: boolean;
  /** the historical accounts and deposits (keys in `historical`) this month's lines belong to */
  groupKeys: string[];
  /** rows to write: kept on the plan, left out of what is sent to the browser */
  writes: WriteObs[];
  fdRefFills: { assetId: string; ref: string; cell: string }[];
}

export interface HistorySummary {
  months: number;
  from: string | null;
  to: string | null;
  notAdding: number;
  unchecked: number;
  doubtful: number;
  closedDeposits: number;
  closedAccounts: number;
  conflicts: number;
  matched: number;
  unmatched: number;
  newValues: number;
  identicalValues: number;
}

export interface HistoryPlan {
  months: HistoryMonth[];
  skipped: { tab: string; reason: string }[];
  historical: HistoricalAsset[];
  conflicts: HistoryConflict[];
  renewals: RenewalSuggestion[];
  summary: HistorySummary;
}

// ----------------------------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------------------------
const round2 = (n: number) => Math.round(n * 100) / 100;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
const monthOfIso = (d: string) => d.slice(0, 7);

const SKIP_COPY = /^copy of\s+(.+?)(?:\s*\(\d+\))?$/i;

interface TabRead {
  title: string;
  index: number;
  ym: YearMonth;
  titleYm: YearMonth;
  copyOf: string | null;
  ws: ExcelJS.Worksheet;
  det: DetectedLayout;
  plan: ImportPlan;
  asOf: string;
  asOfSource: HistoryMonth['asOfSource'];
  asOfNote: string | null;
  sumAll: number;
  latestDated: { date: string; what: string } | null;
  rows: HistRow[];
  unread: UnmatchedRow[];
  summary: SummaryLine | null;
  overridden: boolean;
  doubt: HistoryMonth['doubt'];
  trusted: boolean;
  warnings: string[];
}

function toRows(
  plan: ImportPlan,
  tab: string,
  defaultOwner: string,
  layoutCols: { f: string },
): HistRow[] {
  const owner = new Map(plan.owners.map((o) => [o.key, o.displayName]));
  const inst = new Map(plan.institutions.map((i) => [i.key, i.name]));
  const obs = new Map(plan.observations.map((o) => [o.assetKey, o]));
  const fd = new Map(plan.fixedDeposits.map((f) => [f.assetKey, f]));
  const fund = new Map(plan.funds.map((f) => [f.assetKey, f]));
  const loan = new Map(plan.receivables.map((r) => [r.assetKey, r]));
  const out: HistRow[] = [];
  for (const a of plan.assets) {
    const bank = a.institutionKey ? (inst.get(a.institutionKey) ?? null) : null;
    const base = {
      tab,
      row: a.row ?? Number(/:(\d+)$/.exec(a.key)?.[1] ?? 0),
      key: a.key,
      label: a.label ?? a.nickname,
      ownerName: owner.get(a.ownerKey) ?? defaultOwner,
      bank,
      holderName: a.holderName ?? null,
      last4: a.identifierLast4 ?? null,
      accountKind: a.accountKind === 'NRE' || a.accountKind === 'NRO' ? a.accountKind : null,
      joint: !!a.isJoint,
      name: a.nickname,
      dated: null as string | null,
      fxRate: null as number | null,
    };
    const o = obs.get(a.key);
    const rowNo = base.row;
    if (a.type === 'fixed_deposit') {
      const f = fd.get(a.key);
      if (!f) continue;
      out.push({
        ...base,
        cell: `${layoutCols.f}${rowNo}`,
        kind: 'fd',
        ownerAssumed: false,
        currency: 'INR',
        amount: f.principal,
        fd: {
          principal: f.principal,
          rate: f.rate,
          bookedOn: f.bookedOn || null,
          maturityOn: f.maturityOn,
          maturityAmount: f.bankMaturityAmount,
          ref: f.ref ?? null,
        },
      });
      continue;
    }
    let kind: RowKind;
    let ownerAssumed: boolean;
    if (a.type === 'bank_account') {
      kind = a.currency === 'SGD' ? 'cash_sg' : 'cash';
      ownerAssumed = kind === 'cash_sg';
    } else if (a.type === 'third_party_held') {
      kind = a.accountKind || a.institutionKey ? 'held' : 'third_party';
      ownerAssumed = true;
    } else if (a.type === 'mutual_fund' || a.type === 'ulip') {
      kind = a.type === 'ulip' ? 'ulip' : 'fund';
      ownerAssumed = !!a.ownerAssumed;
    } else if (a.type === 'receivable') {
      kind = 'loan';
      ownerAssumed = true;
    } else continue;
    const l = loan.get(a.key);
    const fnd = fund.get(a.key);
    out.push({
      ...base,
      cell: o?.sourceRef ?? `${layoutCols.f}${rowNo}`,
      kind,
      ownerAssumed,
      currency: a.currency,
      amount: o?.amount ?? Number.NaN,
      fxRate: o?.fxRate ?? null,
      name: l?.counterparty ?? fnd?.fundName ?? a.nickname,
      startedOn: fnd?.startedOn ?? null,
      goal: fnd?.goalTag ?? null,
      dated: l?.lentOn ?? null,
      fd: null,
    });
  }
  return out;
}

function sumColumn(ws: ExcelJS.Worksheet, det: DetectedLayout): number {
  let s = 0;
  for (let r = det.layout.firstRow; r <= det.layout.lastRow; r++) {
    const v = num(cellValue(ws, `${det.layout.columns.f}${r}`));
    if (v !== null) s += v;
  }
  return round2(s);
}

// ----------------------------------------------------------------------------------------------
// planHistory
// ----------------------------------------------------------------------------------------------
export async function planHistory(
  source: string | Buffer | Uint8Array,
  opts: HistoryOptions,
): Promise<HistoryPlan> {
  const wb = new ExcelJS.Workbook();
  if (typeof source === 'string') await wb.xlsx.readFile(source);
  else await wb.xlsx.load(source as unknown as ArrayBuffer);
  return planHistoryFrom(wb, opts);
}

export function planHistoryFrom(wb: ExcelJS.Workbook, opts: HistoryOptions): HistoryPlan {
  const ownerNames = opts.ownerNames ?? DEFAULT_OWNERS;
  const minors = opts.minors ?? DEFAULT_MINORS;
  const defaultOwner = opts.defaultOwner ?? ownerNames[0]!;
  const existing: HistoryExisting = opts.existing ?? { assets: [], observations: [] };
  const overrides = opts.monthOverrides ?? {};
  const skipped: HistoryPlan['skipped'] = [];

  // ---- which tabs are what ------------------------------------------------------------------
  interface Cand {
    ws: ExcelJS.Worksheet;
    index: number;
    title: string;
    ym: YearMonth;
    copyOf: string | null;
  }
  const primaries: Cand[] = [];
  const copies: Cand[] = [];
  let summaryMap = new Map<string, SummaryLine>();
  wb.worksheets.forEach((ws, index) => {
    const title = ws.name;
    if (/^summary$/i.test(title.trim())) {
      summaryMap = readSummary(ws);
      skipped.push({
        tab: title,
        reason: `Not a month. Its ${summaryMap.size} monthly totals and check dates are used to double-check the months.`,
      });
      return;
    }
    const p = parseMonthTitle(title);
    if (p) {
      primaries.push({ ws, index, title, ym: { year: p.year, month: p.month }, copyOf: null });
      return;
    }
    const c = SKIP_COPY.exec(title.trim());
    const cp = c ? parseMonthTitle(c[1]!) : null;
    if (c && cp) {
      copies.push({ ws, index, title, ym: { year: cp.year, month: cp.month }, copyOf: c[1]! });
      return;
    }
    skipped.push({
      tab: title,
      reason: /start date/i.test(title)
        ? 'Not a month: a table of start dates and amounts. It is not read.'
        : 'Not named like a month.',
    });
  });
  // two tabs for one month: the left-most counts
  const seen = new Map<string, Cand>();
  const primary: Cand[] = [];
  for (const c of [...primaries].sort((a, b) => a.index - b.index)) {
    const k = ymKey(c.ym);
    if (seen.has(k)) {
      skipped.push({
        tab: c.title,
        reason: `A second tab for the same month; "${seen.get(k)!.title}" is used.`,
      });
      continue;
    }
    seen.set(k, c);
    primary.push(c);
  }
  const titleOf = new Map(primary.map((c) => [ymKey(c.ym), c.title]));

  // ---- order of the tabs ----------------------------------------------------------------------
  const order = outOfSequence(primary.map((c) => ({ index: c.index, ym: c.ym })));

  // ---- read every tab -------------------------------------------------------------------------
  const read: TabRead[] = [];
  const readTab = (c: Cand, isCopy: boolean): TabRead => {
    const override = overrides[c.title];
    const effYm = override && /^\d{4}-\d{2}$/.test(override) ? ymFromKey(override) : c.ym;
    const overridden = !!override && !isCopy;
    const det = detectLayout(c.ws);
    const warnings = [...det.notes];
    const summary = summaryMap.get(ymKey(c.ym)) ?? null;
    const cellDate = tabDateCell(c.ws);

    // the date of the tab
    let asOf = '';
    let asOfSource: HistoryMonth['asOfSource'] = 'month_end';
    let asOfNote: string | null = null;
    const key = ymKey(effYm);
    const stale: string[] = [];
    if (summary?.checkedOn && monthOfIso(summary.checkedOn) === key) {
      asOf = summary.checkedOn;
      asOfSource = 'summary';
    } else {
      if (summary?.checkedOn) stale.push(`the Summary tab says ${summary.checkedOn}`);
      if (cellDate && monthOfIso(cellDate.date) === key) {
        asOf = cellDate.date;
        asOfSource = 'cell';
      } else if (cellDate) stale.push(`${cellDate.ref} says ${cellDate.date}`);
    }
    if (!asOf) {
      const end = monthEnd(effYm);
      if (end > opts.today) {
        asOf = opts.today;
        asOfSource = 'today';
        asOfNote = 'The month is not over; dated today.';
      } else {
        asOf = end;
        asOfSource = 'month_end';
      }
      if (stale.length)
        asOfNote = `${stale.join('; ')}, which is not in ${key}: left over from another month, so the ${asOfSource === 'today' ? 'date of today' : 'month end'} was used.`;
    }

    const plan = planWorksheet(c.ws, {
      asOf,
      layout: det.layout,
      classify: classifyHistoryRow,
      allowMissingStart: true,
      ownerNames,
      minors,
      defaultOwner,
    });
    const rows = toRows(plan, c.title, defaultOwner, det.layout.columns);

    // the rows the grammar could not turn into anything
    const unread: UnmatchedRow[] = [];
    const reasonOf: Record<string, string> = {
      row_without_group: 'It comes before any bank heading.',
      fd_incomplete: 'The deposit is missing its rate, maturity amount or bank.',
      cash_owner_unknown: 'The tab does not say whose account or which bank it is.',
      unclassified_row: 'It does not look like an account, a deposit, a fund or a loan.',
      fund_summary_line:
        'One combined line for several funds or shares; it is counted in the total but cannot be tied to one fund.',
      sgd_amount_missing: 'The Singapore dollar balance could not be read from the note.',
    };
    for (const e of plan.exceptions) {
      const why = reasonOf[e.code];
      if (!why) continue;
      if (e.code === 'sgd_amount_missing') continue;
      const rowNo = Number(/\d+$/.exec(e.cell)?.[0] ?? 0);
      const label = String(cellValue(c.ws, `${det.layout.columns.b}${rowNo}`) ?? '').trim();
      const amount = num(cellValue(c.ws, `${det.layout.columns.f}${rowNo}`));
      unread.push({
        cell: `${det.layout.columns.f}${rowNo}`,
        label: label || e.message.slice(0, 40),
        owner: null,
        bank: null,
        amount,
        reason: why,
        why: 'unread',
      });
    }

    // contents that cannot belong to the month (a deposit that starts after it)
    let latest: { date: string; what: string } | null = null;
    const consider = (d: string | null | undefined, what: string) => {
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d) && (!latest || d > latest.date))
        latest = { date: d, what };
    };
    for (const f of plan.fixedDeposits) consider(f.bookedOn, 'a deposit starts');
    for (const f of plan.funds) consider(f.startedOn, 'a fund starts');
    for (const r of plan.receivables) consider(r.lentOn, 'a loan was given');
    const latestDated = latest as { date: string; what: string } | null;

    return {
      title: c.title,
      index: c.index,
      ym: effYm,
      titleYm: c.ym,
      copyOf: isCopy ? c.copyOf : null,
      ws: c.ws,
      det,
      plan,
      asOf,
      asOfSource,
      asOfNote,
      sumAll: sumColumn(c.ws, det),
      latestDated,
      rows,
      unread,
      summary,
      overridden,
      doubt: null,
      trusted: true,
      warnings,
    };
  };
  for (const c of primary) read.push(readTab(c, false));
  for (const c of copies) read.push(readTab(c, true));

  // ---- doubts: order of the tabs and contents newer than the month -----------------------------
  const startsAfter = opts.startsAfterDays ?? DEFAULT_CONFIG.estimates.historyStartsAfterDays;
  for (const t of read) {
    if (t.copyOf) {
      t.trusted = false;
      continue;
    }
    const seq = order.get(t.index);
    const end = monthEnd(t.ym);
    const texts: string[] = [];
    const kinds: NonNullable<HistoryMonth['doubt']>['kinds'] = [];
    if (t.latestDated && daysBetween(end, t.latestDated.date) > startsAfter) {
      kinds.push('newer_contents');
      texts.push(
        `Its contents are newer than its date: ${t.latestDated.what} on ${t.latestDated.date}, long after ${end}. It is probably a copy of a later month.`,
      );
    }
    if (seq && !t.overridden) {
      const [l, r] = seq.between;
      kinds.push('out_of_order');
      texts.push(
        `Its title looks wrong: it sits between ${l ?? 'the start'} and ${r ?? 'the end'} in the tab bar.`,
      );
    }
    if (kinds.length && t.overridden) {
      // the person has said which month this is: the doubt stays as a warning, not as a block
      t.warnings.push(`You chose to use this tab as ${ymKey(t.ym)}. ${texts.join(' ')}`);
    } else if (kinds.length) {
      // the month it would be: the one its neighbours leave room for if its contents fit it, else the first month of that name its contents fit
      const fits = (ym: YearMonth) => !t.latestDated || t.latestDated.date <= monthEnd(ym);
      let suggested: string | null = null;
      const bySeq = seq?.suggested ? ymFromKey(seq.suggested) : null;
      if (bySeq && fits(bySeq)) suggested = seq!.suggested;
      else if (t.latestDated)
        for (let y = t.ym.year; y <= t.ym.year + 10 && !suggested; y++)
          if (fits({ year: y, month: t.ym.month }))
            suggested = ymKey({ year: y, month: t.ym.month });
      // another tab already stands for that month: no suggestion
      if (suggested && suggested !== ymKey(t.ym) && titleOf.has(suggested)) suggested = null;
      if (suggested === ymKey(t.ym)) suggested = null;
      t.doubt = { kinds, text: texts.join(' '), suggested };
      t.trusted = false;
    }
  }
  const trusted = read.filter((t) => t.trusted).sort((a, b) => ymOrdinal(a.ym) - ymOrdinal(b.ym));
  const timeline = trusted.map((t) => ymKey(t.ym));
  const latestMonth = timeline[timeline.length - 1] ?? null;
  const asOfOfMonth = new Map(trusted.map((t) => [ymKey(t.ym), t.asOf]));

  // ---- rows like those of a much later tab -----------------------------------------------------
  const signature = (t: TabRead) =>
    new Set(
      t.rows
        .filter((r) => r.kind === 'fd' && r.fd)
        .map((r) => fdKey({ ownerName: r.ownerName, bank: r.bank, ...r.fd! })),
    );
  const sigs = new Map(read.map((t) => [t.title, signature(t)]));
  const jaccard = (a: Set<string>, b: Set<string>) => {
    if (a.size === 0 || b.size === 0) return 0;
    let i = 0;
    for (const x of a) if (b.has(x)) i++;
    return i / (a.size + b.size - i);
  };
  const likeTab = new Map<string, string | null>();
  for (const t of read) {
    if (t.copyOf) continue;
    let best: { tab: TabRead; s: number } | null = null;
    for (const o of read) {
      if (o === t || o.copyOf) continue;
      const s = jaccard(sigs.get(t.title)!, sigs.get(o.title)!);
      if (!best || s > best.s) best = { tab: o, s };
    }
    const gap = best ? ymOrdinal(best.tab.ym) - ymOrdinal(t.ym) : 0;
    likeTab.set(
      t.title,
      best && best.s >= 0.6 && gap >= 6
        ? `${best.tab.title} (${Math.round(best.s * 100)}% of its deposits are the same)`
        : null,
    );
  }

  // ---- match every line -----------------------------------------------------------------------
  interface Placed {
    row: HistRow;
    status: 'matched' | 'group' | 'unmatched';
    assetId: string | null;
    groupKey: string | null;
    why?: UnmatchedRow['why'];
    reason?: string;
  }
  const placed = new Map<string, Placed[]>();
  const groups = new Map<
    string,
    { kind: 'fd' | 'cash'; rows: { t: TabRead; row: HistRow }[]; ambiguous: boolean }
  >();
  for (const t of read) {
    const list: Placed[] = [];
    const deposits = matchDeposits(t.rows, existing.assets);
    // the same deposit number twice in one tab: neither line can be trusted to be which
    const refCount = new Map<string, number>();
    for (const r of t.rows)
      if (r.kind === 'fd' && r.fd?.ref) {
        const k = `${personKey(r.ownerName)}|${bankKey(r.bank)}|${r.fd.ref.replace(/\s+/g, '')}`;
        refCount.set(k, (refCount.get(k) ?? 0) + 1);
      }
    const assignedTo = new Map<string, number>();
    const stage: Placed[] = [];
    for (const r of t.rows) {
      let p: Placed;
      if (r.kind === 'fd') {
        const dup =
          r.fd?.ref &&
          (refCount.get(
            `${personKey(r.ownerName)}|${bankKey(r.bank)}|${r.fd.ref.replace(/\s+/g, '')}`,
          ) ?? 0) > 1;
        const m = deposits.get(r.key);
        if (dup)
          p = {
            row: r,
            status: 'unmatched',
            assetId: null,
            groupKey: null,
            why: 'ambiguous',
            reason: `The deposit number appears on more than one line of this tab, so it cannot be told which line is which.`,
          };
        else if (m?.match.status === 'matched')
          p = { row: r, status: 'matched', assetId: m.match.assetId, groupKey: null };
        else if (m?.match.status === 'ambiguous')
          p = {
            row: r,
            status: 'unmatched',
            assetId: null,
            groupKey: null,
            why: 'ambiguous',
            reason: m.match.reason,
          };
        else
          p = {
            row: r,
            status: 'group',
            assetId: null,
            groupKey: `fd|${fdKey({ ownerName: r.ownerName, bank: r.bank, ...r.fd! })}|${m?.ordinal ?? 1}`,
          };
      } else {
        const m = Number.isNaN(r.amount)
          ? ({ status: 'none' } as const)
          : matchOther(r, existing.assets);
        if (Number.isNaN(r.amount))
          p = {
            row: r,
            status: 'unmatched',
            assetId: null,
            groupKey: null,
            why: 'unread',
            reason: 'The Singapore dollar balance could not be read from the note.',
          };
        else if (m.status === 'matched') {
          p = { row: r, status: 'matched', assetId: m.assetId, groupKey: null };
          assignedTo.set(m.assetId, (assignedTo.get(m.assetId) ?? 0) + 1);
        } else if (m.status === 'ambiguous')
          p = {
            row: r,
            status: 'unmatched',
            assetId: null,
            groupKey: null,
            why: 'ambiguous',
            reason: m.reason,
          };
        else if (r.kind === 'cash' || r.kind === 'cash_sg' || r.kind === 'held')
          p = {
            row: r,
            status: 'group',
            assetId: null,
            groupKey: `cash|${r.kind}|${personKey(r.ownerAssumed ? '' : r.ownerName)}|${bankKey(r.bank)}|${r.accountKind ?? ''}|${r.last4 ?? ''}|${r.last4 ? '' : r.label.toLowerCase().replace(/[^a-z0-9]+/g, '')}|${personKey(r.holderName)}`,
          };
        else
          p = {
            row: r,
            status: 'unmatched',
            assetId: null,
            groupKey: null,
            why: 'not_on_file',
            reason:
              r.kind === 'fund' || r.kind === 'ulip'
                ? 'No fund on file has this name. A fund is never created from a monthly line; add it from a fund statement.'
                : r.kind === 'loan'
                  ? 'No loan on file matches this name.'
                  : 'Nothing on file matches this line.',
          };
      }
      stage.push(p);
    }
    // two lines of one tab on the same account on file
    for (const p of stage)
      if (p.status === 'matched' && p.row.kind !== 'fd' && (assignedTo.get(p.assetId!) ?? 0) > 1)
        Object.assign(p, {
          status: 'unmatched',
          assetId: null,
          why: 'ambiguous',
          reason: 'Two lines of this tab fit the same account on file, so neither was used.',
        } satisfies Partial<Placed>);
    // two lines that would make the same new account
    const seenGroup = new Map<string, number>();
    for (const p of stage)
      if (p.status === 'group' && p.groupKey?.startsWith('cash|'))
        seenGroup.set(p.groupKey, (seenGroup.get(p.groupKey) ?? 0) + 1);
    for (const p of stage) {
      if (p.status === 'group' && p.groupKey?.startsWith('cash|') && seenGroup.get(p.groupKey)! > 1)
        Object.assign(p, {
          status: 'unmatched',
          groupKey: null,
          why: 'ambiguous',
          reason:
            'Two lines of this tab look the same, so they cannot be followed from month to month.',
        } satisfies Partial<Placed>);
      list.push(p);
      if (p.status === 'group' && !t.copyOf) {
        const g = groups.get(p.groupKey!) ?? {
          kind: p.row.kind === 'fd' ? ('fd' as const) : ('cash' as const),
          rows: [],
          ambiguous: false,
        };
        g.rows.push({ t, row: p.row });
        groups.set(p.groupKey!, g);
      }
    }
    placed.set(t.title, list);
  }

  // ---- accounts and deposits that are not on file ----------------------------------------------
  const historical: HistoricalAsset[] = [];
  const eligible = new Map<string, HistoricalAsset>();
  const skipGroup = new Map<string, string>();
  for (const [key, g] of groups) {
    const inTimeline = g.rows.filter((x) => x.t.trusted);
    if (inTimeline.length === 0) {
      skipGroup.set(key, 'It appears only on tabs whose date is in doubt.');
      continue;
    }
    const months = [...new Set(inTimeline.map((x) => ymKey(x.t.ym)))].sort();
    const first = months[0]!;
    const last = months[months.length - 1]!;
    if (last === latestMonth) {
      skipGroup.set(
        key,
        'It is still listed in the latest tab but is not on file. Import balances and deposits for the latest tab first.',
      );
      continue;
    }
    const nextIdx = timeline.findIndex((m) => m > last);
    const endedMonth = timeline[nextIdx]!;
    const endAsOf = asOfOfMonth.get(endedMonth)!;
    const lastAsOf = asOfOfMonth.get(last)!;
    const sample = inTimeline[inTimeline.length - 1]!.row;
    const firstAsOf = asOfOfMonth.get(first)!;
    const between = timeline.filter((m) => m > first && m < last);
    const listed = new Set(months);
    const gaps = between.filter((m) => !listed.has(m)).length;
    const base = {
      key,
      ownerName: sample.ownerName,
      bank: sample.bank,
      accountKind: sample.accountKind,
      joint: sample.joint,
      last4: sample.last4,
      currency: sample.currency,
      holderName: sample.holderName,
      firstSeen: first,
      lastSeen: last,
      endedMonth,
      tabs: [...new Set(inTimeline.map((x) => x.t.title))],
      gaps,
    };
    if (g.kind === 'fd') {
      const fdRows = inTimeline.map((x) => x.row);
      const withStart = fdRows.find((r) => r.fd!.bookedOn);
      const latestRow = fdRows[fdRows.length - 1]!;
      const maturityOn = latestRow.fd!.maturityOn;
      let bookedOn = withStart?.fd!.bookedOn ?? firstAsOf;
      const startEstimated = !withStart;
      let skipReason: string | null = null;
      if (startEstimated && firstAsOf >= maturityOn)
        skipReason =
          'The tabs give no start date, and it had already matured when it first appears, so no honest start can be set.';
      if (!startEstimated && bookedOn >= maturityOn)
        skipReason = 'Its start date is not before its maturity date.';
      // the day it left: its maturity date when that falls between the last tab that has it and the first that does not
      let endedOn = endAsOf;
      if (maturityOn > lastAsOf && maturityOn <= endAsOf) endedOn = maturityOn;
      if (endedOn <= bookedOn) bookedOn = addDaysIso(endedOn, -1);
      const a: HistoricalAsset = {
        ...base,
        kind: 'fd',
        label: latestRow.label,
        endedOn,
        status: maturityOn <= endedOn ? 'matured' : 'closed',
        fd: {
          principal: latestRow.fd!.principal,
          rate: latestRow.fd!.rate,
          bookedOn,
          startEstimated,
          maturityOn,
          maturityAmount: latestRow.fd!.maturityAmount,
          ref: [...fdRows].reverse().find((r) => r.fd!.ref)?.fd!.ref ?? null,
        },
        skipReason,
      };
      historical.push(a);
      if (!skipReason) eligible.set(key, a);
      else skipGroup.set(key, skipReason);
    } else {
      const latestRow = inTimeline[inTimeline.length - 1]!.row;
      const a: HistoricalAsset = {
        ...base,
        kind: 'cash',
        label: latestRow.label || 'Cash',
        endedOn: endAsOf,
        status: 'closed',
        fd: null,
        skipReason: null,
      };
      historical.push(a);
      eligible.set(key, a);
    }
  }

  // renewals: one deposit ends in the month another one of the same bank and person first appears (a suggestion only)
  const firstSeenOfAsset = new Map<string, { month: string; row: HistRow }>();
  for (const t of trusted)
    for (const p of placed.get(t.title) ?? [])
      if (p.row.kind === 'fd') {
        const id = p.assetId ?? p.groupKey!;
        const m = ymKey(t.ym);
        const cur = firstSeenOfAsset.get(id);
        if (!cur || m < cur.month) firstSeenOfAsset.set(id, { month: m, row: p.row });
      }
  const renewals: RenewalSuggestion[] = [];
  for (const a of historical) {
    if (a.kind !== 'fd' || !a.fd) continue;
    for (const [id, f] of firstSeenOfAsset) {
      if (id === a.key || f.month !== a.endedMonth) continue;
      if (
        personKey(f.row.ownerName) !== personKey(a.ownerName) ||
        bankKey(f.row.bank) !== bankKey(a.bank)
      )
        continue;
      renewals.push({
        from: a.key,
        to: id,
        month: a.endedMonth,
        text: `${a.bank ?? 'A bank'} (${a.ownerName}): the deposit of ${a.fd.principal.toLocaleString('en-IN')} maturing ${a.fd.maturityOn} is missing from ${a.endedMonth}, the month a deposit of ${f.row.fd!.principal.toLocaleString('en-IN')} maturing ${f.row.fd!.maturityOn} first appears. It may have been renewed. Not linked; link it yourself if so.`,
      });
    }
  }

  // ---- assemble each month -----------------------------------------------------------------
  const obsByAsset = new Map<string, HistoryExistingObs[]>();
  for (const o of existing.observations)
    obsByAsset.set(o.assetId, [...(obsByAsset.get(o.assetId) ?? []), o]);
  const labelOf = new Map(existing.assets.map((a) => [a.id, a.label ?? a.nickname]));
  const existingById = new Map(existing.assets.map((a) => [a.id, a]));
  const conflicts: HistoryConflict[] = [];
  const months: HistoryMonth[] = [];
  const originals = new Map<string, HistoryMonth>();
  const ordered = [...read].sort(
    (a, b) =>
      Number(!!a.copyOf) - Number(!!b.copyOf) ||
      ymOrdinal(a.ym) - ymOrdinal(b.ym) ||
      a.index - b.index,
  );
  for (const t of ordered) {
    const list = placed.get(t.title)!;
    const original = t.copyOf ? (originals.get(ymKey(t.ym)) ?? null) : null;
    const asOf = original ? original.asOf : t.asOf;
    let matched = 0;
    let created = 0;
    const unmatchedRows: UnmatchedRow[] = [...t.unread];
    const writes: WriteObs[] = [];
    const groupKeys = new Set<string>();
    const fdRefFills: HistoryMonth['fdRefFills'] = [];
    const planned = new Map<string, number>();
    for (const p of list) {
      const r = p.row;
      const assetId = p.assetId;
      let groupKey: string | null = null;
      if (p.status === 'group') {
        const hist = eligible.get(p.groupKey!);
        if (hist) {
          groupKey = p.groupKey!;
          groupKeys.add(groupKey);
          created++;
        } else {
          unmatchedRows.push({
            cell: r.cell,
            label: r.label,
            owner: r.ownerName,
            bank: r.bank,
            amount: r.amount,
            reason: skipGroup.get(p.groupKey!) ?? 'Nothing on file matches this line.',
            why: 'not_created',
          });
          continue;
        }
      } else if (p.status === 'unmatched') {
        unmatchedRows.push({
          cell: r.cell,
          label: r.label,
          owner: r.ownerName,
          bank: r.bank,
          amount: Number.isNaN(r.amount) ? null : r.amount,
          reason: p.reason!,
          why: p.why!,
        });
        continue;
      } else matched++;

      if (r.kind === 'fd') {
        // a deposit on file: only a missing deposit number is filled in
        const ex = assetId ? existingById.get(assetId) : null;
        if (ex?.fd && !ex.fd.ref && r.fd?.ref && !t.copyOf)
          fdRefFills.push({ assetId: assetId!, ref: r.fd.ref, cell: r.cell });
        continue;
      }
      const isFund = r.kind === 'fund' || r.kind === 'ulip';
      const obs: WriteObs = {
        id: `${t.title}|${r.cell}`,
        tab: t.title,
        cell: r.cell,
        ref: `${isFund ? HIST_FUND_REF : HIST_REF}${t.overridden ? formatMonthTitle(t.ym) : t.title}:${r.cell}`,
        assetId,
        groupKey,
        label: assetId ? (labelOf.get(assetId) ?? r.label) : r.label,
        kind:
          r.kind === 'cash' || r.kind === 'cash_sg' || r.kind === 'held' ? 'balance' : 'valuation',
        amount: round2(r.amount),
        currency: r.currency,
        fxRate: r.fxRate,
        asOf,
        check: isFund,
        status: 'new',
      };
      const dupKey = `${assetId ?? groupKey}|${asOf}`;
      planned.set(dupKey, (planned.get(dupKey) ?? 0) + 1);
      if (assetId) {
        const mine = (obsByAsset.get(assetId) ?? []).filter(
          (o) => !isFund || (o.sourceRef ?? '').startsWith(HIST_FUND_REF),
        );
        const live = mine.filter((o) => !o.supersededBy);
        const sameDay = live.filter((o) => o.asOf === asOf);
        const sameMonth = live.filter(
          (o) => monthOfIso(o.asOf) === monthOfIso(asOf) && o.currency === obs.currency,
        );
        const wasWritten = mine.some(
          (o) => o.sourceRef === obs.ref && sameAmount(o.amount, obs.amount),
        );
        if (sameMonth.some((o) => sameAmount(o.amount, obs.amount)) || wasWritten)
          obs.status = 'identical';
        else if (!isFund && sameDay.length > 0) {
          obs.status = 'conflict';
          const cur = sameDay[sameDay.length - 1]!;
          conflicts.push({
            id: obs.id,
            tab: t.title,
            cell: r.cell,
            assetId: assetId,
            assetLabel: obs.label,
            asOf,
            currency: obs.currency,
            sheetAmount: obs.amount,
            existing: {
              id: cur.id,
              amount: cur.amount,
              source: cur.source,
              confidence: cur.confidence,
            },
          });
        }
      }
      if (original) {
        const twin = original.writes.find(
          (w) => (w.assetId ?? w.groupKey) === (assetId ?? groupKey) && w.asOf === asOf,
        );
        if (twin) obs.status = 'copy_dropped';
      }
      writes.push(obs);
    }
    // a conflict inside the plan itself would need a second look at the lines: left to the person
    const counts = {
      new: writes.filter((w) => w.status === 'new' && !w.check).length,
      identical: writes.filter((w) => w.status === 'identical').length,
      conflicts: writes.filter((w) => w.status === 'conflict').length,
      copyDropped: writes.filter((w) => w.status === 'copy_dropped').length,
      checks: writes.filter((w) => w.status === 'new' && w.check).length,
    };

    // does the tab add up?
    const plan = t.plan;
    const total = plan.controlTotals.sheetSumF;
    const checks: HistoryCheck[] = [];
    if (total !== null)
      checks.push({
        label: `The lines read add up to the tab's own total (${t.det.layout.totalRef})`,
        expected: total,
        actual: plan.controlTotals.importedF,
        ok: Math.abs(total - plan.controlTotals.importedF) < 1,
      });
    if (total !== null && Math.abs(total - t.sumAll) >= 1)
      checks.push({
        label: "The tab's own total adds up its own lines",
        expected: total,
        actual: t.sumAll,
        ok: false,
      });
    if (t.summary && t.summary.total !== null) {
      const tabTotal = total ?? plan.controlTotals.importedF;
      checks.push({
        label: `The tab's total equals the Summary tab's total for ${t.summary.label}`,
        expected: t.summary.total,
        actual: tabTotal,
        ok: Math.abs(t.summary.total - tabTotal) < 1,
      });
    }
    const verdict: HistoryMonth['verdict'] =
      checks.length === 0 ? 'unchecked' : checks.every((c) => c.ok) ? 'ok' : 'mismatch';
    const warnings = [...t.warnings];
    if (t.asOfNote) warnings.push(t.asOfNote);
    if (t.latestDated && t.latestDated.date > t.asOf && !t.doubt?.kinds.includes('newer_contents'))
      warnings.push(
        `${t.latestDated.what} on ${t.latestDated.date}, after the date of this tab (${t.asOf}); the tab was probably updated after the month ended.`,
      );
    if (original) {
      warnings.push(
        `A copy of "${original.tab}". Values the original already has are never replaced by this copy.`,
      );
      if (
        original.verdict !== 'unchecked' &&
        total !== null &&
        original.checks[0] &&
        Math.abs(original.checks[0].expected! - total) >= 1
      )
        warnings.push(`Its total differs from the original's.`);
    }
    for (const [k, n] of planned)
      if (n > 1)
        warnings.push(`Two lines write to the same account on the same date (${k.split('|')[0]}).`);
    const doubt = t.doubt;
    const sel = !t.copyOf && !doubt && verdict === 'ok';
    const m: HistoryMonth = {
      tab: t.title,
      month: ymKey(t.ym),
      copyOf: t.copyOf,
      asOf,
      asOfSource: original ? original.asOfSource : t.asOfSource,
      asOfNote: t.asOfNote,
      layout: {
        headerRow: t.det.headerRow,
        standard: t.det.standard,
        found: t.det.found,
        totalRef: t.det.layout.totalRef,
      },
      rowsRead: list.length + t.unread.length,
      matched,
      created,
      unmatched: unmatchedRows.length,
      unmatchedRows,
      checks,
      verdict,
      difference: total === null ? null : round2(plan.controlTotals.importedF - total),
      summaryTotal: t.summary?.total ?? null,
      warnings,
      doubt,
      likeTab: likeTab.get(t.title) ?? null,
      overridden: t.overridden,
      counts,
      selectable: true,
      defaultSelected: sel,
      writes,
      groupKeys: [...groupKeys],
      fdRefFills,
    };
    months.push(m);
    if (!t.copyOf) originals.set(ymKey(t.ym), m);
  }
  months.sort(
    (a, b) =>
      a.month.localeCompare(b.month) ||
      Number(!!a.copyOf) - Number(!!b.copyOf) ||
      a.tab.localeCompare(b.tab),
  );

  // ---- the numbers for the headline --------------------------------------------------------
  const real = months.filter((m) => !m.copyOf);
  const summary: HistorySummary = {
    months: real.length,
    from: real[0]?.month ?? null,
    to: real[real.length - 1]?.month ?? null,
    notAdding: real.filter((m) => m.verdict === 'mismatch').length,
    unchecked: real.filter((m) => m.verdict === 'unchecked').length,
    doubtful: real.filter((m) => m.doubt).length,
    closedDeposits: historical.filter((a) => a.kind === 'fd' && !a.skipReason).length,
    closedAccounts: historical.filter((a) => a.kind === 'cash').length,
    conflicts: conflicts.length,
    matched: real.reduce((s, m) => s + m.matched, 0),
    unmatched: real.reduce((s, m) => s + m.unmatched, 0),
    newValues: real.reduce((s, m) => s + m.counts.new, 0),
    identicalValues: real.reduce((s, m) => s + m.counts.identical, 0),
  };
  void titleOf;
  void isoDate;
  return { months, skipped, historical, conflicts, renewals, summary };
}
