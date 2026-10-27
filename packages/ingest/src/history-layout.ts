/**
 * Reading the household workbook's many monthly tabs. The tabs were not laid out the same way over the years: a column was added,
 * the Notes moved, "Type" became "Category", the date of the check sat in a helper block that was later left unchanged. This module
 * finds, for each tab, where the register is (from its header row, not from fixed letters), where its own total is, which date it
 * stands for, and how the lines of older tabs are to be read. Everything here is pure: it works on an opened ExcelJS sheet and plain
 * values, and it writes nothing.
 */
import type ExcelJS from 'exceljs';
import {
  classifyRegisterRow,
  fundParts,
  isoDate,
  str,
  type Group,
  type RowFacts,
} from './sheet-rows';
import {
  STANDARD_COLUMNS,
  STANDARD_LAYOUT,
  cellValue,
  type HistoryOnlyClass,
  type SheetColumns,
  type SheetLayout,
} from './workbook';
import { parseMonthTitle, type YearMonth } from './sheet-months';

const colLetter = (n: number): string => {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
};

export const ymKey = (ym: YearMonth): string => `${ym.year}-${String(ym.month).padStart(2, '0')}`;
export const ymOrdinal = (ym: YearMonth): number => ym.year * 12 + ym.month;
export const ymFromKey = (k: string): YearMonth => ({
  year: Number(k.slice(0, 4)),
  month: Number(k.slice(5, 7)),
});

/** Last day of a month, as YYYY-MM-DD. */
export function monthEnd(ym: YearMonth): string {
  return isoDate(new Date(Date.UTC(ym.year, ym.month, 0)));
}

// ----------------------------------------------------------------------------------------------
// The header row
// ----------------------------------------------------------------------------------------------
export interface DetectedLayout {
  layout: SheetLayout;
  /** 1-based header row, or null when the tab has none (the standard layout is assumed) */
  headerRow: number | null;
  /** the headers that were recognised, e.g. "Rate", "Start Date": what the reading rests on */
  found: string[];
  /** the register sits where the current month's tab has it */
  standard: boolean;
  /** the header texts joined: tabs of one era share it */
  signature: string;
  /** the row of the sheet's own total, if the tab has one */
  totalRow: number | null;
  notes: string[];
}

const norm = (v: unknown): string =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function detectLayout(ws: ExcelJS.Worksheet): DetectedLayout {
  const notes: string[] = [];
  const maxCol = Math.min(ws.columnCount || 30, 40);
  let best: { row: number; score: number; heads: Map<number, string> } | null = null;
  for (let r = 1; r <= 6; r++) {
    const heads = new Map<number, string>();
    for (let c = 1; c <= maxCol; c++) {
      const t = norm(cellValue(ws, `${colLetter(c)}${r}`));
      if (t) heads.set(c, t);
    }
    const texts = [...heads.values()];
    const score = ['rate', 'start date', 'maturity date', 'amount'].filter((h) =>
      texts.some((t) => t === h),
    ).length;
    if (score >= 3 && (!best || score > best.score)) best = { row: r, score, heads };
  }
  const cols: SheetColumns = { ...STANDARD_COLUMNS };
  let headerRow: number | null = null;
  const found: string[] = [];
  let signature = '';
  if (best) {
    headerRow = best.row;
    const first = (...names: string[]): number | null => {
      for (const [c, t] of best!.heads) if (names.includes(t)) return c;
      return null;
    };
    const rate = first('rate');
    const start = first('start date');
    const mat = first('maturity date');
    const amount = first('amount');
    const matAmount = first('maturity', 'maturity amount');
    const invested = first('invested');
    const notesCol = first('notes', 'note');
    const changes = first('changes req', 'changes required', 'changes');
    const set = (key: keyof SheetColumns, c: number | null, label: string) => {
      if (c === null) return;
      (cols as unknown as Record<string, string | null>)[key] = colLetter(c);
      found.push(label);
    };
    set('c', rate, 'Rate');
    set('d', start, 'Start Date');
    set('e', mat, 'Maturity Date');
    set('f', amount, 'Amount');
    if (rate === null || start === null || mat === null || amount === null)
      notes.push('Some headings were missing; the usual columns were assumed for them.');
    cols.g = matAmount === null ? null : colLetter(matAmount);
    if (matAmount !== null) found.push('Maturity amount');
    cols.h = invested === null ? null : colLetter(invested);
    if (invested !== null) found.push('Invested');
    cols.n = notesCol === null ? null : colLetter(notesCol);
    if (notesCol !== null) found.push('Notes');
    cols.m = changes === null ? null : colLetter(changes);
    if (changes !== null) found.push('Changes Req');
    // the category sits just left of the rate; the bank-and-person heading left of that
    const rateCol = rate ?? 3;
    cols.b = colLetter(Math.max(1, rateCol - 1));
    const bankHead = first('bank');
    cols.a = bankHead !== null ? colLetter(bankHead) : colLetter(Math.max(1, rateCol - 2));
    // a stray marker column: the one with no heading between the amounts and the goal
    cols.j = invested !== null && !best.heads.has(invested + 2) ? colLetter(invested + 2) : null;
    signature = [...best.heads.entries()]
      .filter(([c]) => c <= (notesCol ?? 14))
      .map(([, t]) => t)
      .join('|');
  } else {
    notes.push('No heading row was found; the standard layout was assumed.');
  }

  const firstRow = headerRow === null ? STANDARD_LAYOUT.firstRow : headerRow + 1;
  // the sheet's own total: a row headed "Total ..." with a number in the Amount column
  let totalRow: number | null = null;
  const limit = Math.min(ws.rowCount, 400);
  for (let r = firstRow; r <= limit; r++) {
    const label = str(cellValue(ws, `${cols.a}${r}`)) || str(cellValue(ws, `${cols.b}${r}`));
    if (/^total\b/i.test(label) && typeof cellValue(ws, `${cols.f}${r}`) === 'number') {
      totalRow = r;
      break;
    }
  }
  if (totalRow === null)
    notes.push('No "Total" row was found, so this tab cannot be checked against its own total.');
  const lastRow = totalRow === null ? STANDARD_LAYOUT.lastRow : totalRow - 1;
  const layout: SheetLayout = {
    columns: cols,
    firstRow,
    lastRow,
    totalRef: totalRow === null ? null : `${cols.f}${totalRow}`,
    registerOnly: true,
  };
  const standard =
    headerRow === 2 &&
    (Object.keys(STANDARD_COLUMNS) as (keyof SheetColumns)[]).every(
      (k) => cols[k] === STANDARD_COLUMNS[k],
    ) &&
    totalRow === 114;
  return { layout, headerRow, found, standard, signature, totalRow, notes };
}

// ----------------------------------------------------------------------------------------------
// The date a tab stands for
// ----------------------------------------------------------------------------------------------
/** A "Current" or "This Time" label with a date beside it, in the helper block to the right of the register. */
export function tabDateCell(ws: ExcelJS.Worksheet): { date: string; ref: string } | null {
  const maxCol = Math.min(ws.columnCount || 30, 60);
  for (let r = 1; r <= 14; r++)
    for (let c = 8; c <= maxCol; c++) {
      const t = norm(cellValue(ws, `${colLetter(c)}${r}`));
      if (t !== 'current' && t !== 'this time') continue;
      const next = cellValue(ws, `${colLetter(c + 1)}${r}`);
      if (next instanceof Date && !Number.isNaN(next.getTime()))
        return { date: isoDate(next), ref: `${colLetter(c + 1)}${r}` };
    }
  return null;
}

// ----------------------------------------------------------------------------------------------
// The Summary tab
// ----------------------------------------------------------------------------------------------
export interface SummaryLine {
  label: string;
  row: number;
  total: number | null;
  checkedOn: string | null;
}

/** The workbook's own "Summary" tab: one line per month with the sheet's total and the date it was checked. */
export function readSummary(ws: ExcelJS.Worksheet): Map<string, SummaryLine> {
  const out = new Map<string, SummaryLine>();
  let totalCol: number | null = null;
  let dateCol: number | null = null;
  let headRow = 0;
  for (let r = 1; r <= 4 && totalCol === null; r++)
    for (let c = 1; c <= 30; c++) {
      const t = norm(cellValue(ws, `${colLetter(c)}${r}`));
      if (t === 'total amount' && totalCol === null) {
        totalCol = c;
        headRow = r;
      }
      if (t === 'date of checking' && dateCol === null) dateCol = c;
    }
  if (totalCol === null) return out;
  for (let r = headRow + 1; r <= Math.min(ws.rowCount, 200); r++) {
    const label = str(cellValue(ws, `A${r}`));
    const p = parseMonthTitle(label);
    if (!p) continue;
    const total = cellValue(ws, `${colLetter(totalCol)}${r}`);
    const d = dateCol === null ? null : cellValue(ws, `${colLetter(dateCol)}${r}`);
    out.set(ymKey(p), {
      label,
      row: r,
      total: typeof total === 'number' ? total : null,
      checkedOn: d instanceof Date ? isoDate(d) : null,
    });
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// Older lines
// ----------------------------------------------------------------------------------------------
/**
 * The shared grammar's answer wherever it has one; for the lines older tabs wrote differently it adds:
 *  - "Cash" in the maturity column (the tag "Cash-NRE" came later): a balance, a Singapore balance for UOB and DBS, a loan under Others,
 *    an account in someone else's name;
 *  - "Papa" with an amount, which older tabs counted in their total;
 *  - one combined "SIP/Share" line.
 */
export function classifyHistoryRow(
  row: RowFacts,
  group: Group | null,
): ReturnType<typeof classifyRegisterRow> | HistoryOnlyClass {
  const base = classifyRegisterRow(row, group);
  if (base.kind !== 'unclassified' && base.kind !== 'memo') return base;
  if (!group || /^Papa$/i.test(row.b)) return base;
  const e = str(row.e);
  // a line with no value and no kind is an empty placeholder, not something the reader failed to understand
  if (base.kind === 'unclassified' && row.f === 0 && e === '') return { kind: 'placeholder' };
  // a lump sum put into a fund is read like a SIP line
  if (base.kind === 'unclassified' && /^lump\s*sum$/i.test(e))
    return { kind: 'fund', ...fundParts(row.b) };
  if (base.kind === 'unclassified' && /^stocks?( market)?$/i.test(e) && group.kind !== 'bank')
    return { kind: 'third_party' };
  const kind = /NRE/i.test(row.b) ? 'NRE' : /NRO/i.test(row.b) ? 'NRO' : undefined;
  if (/^Cash$/i.test(e) || (e === '' && /^cash/i.test(row.b))) {
    if (group.kind === 'sg_bank') return { kind: 'cash_sg' };
    if (group.kind === 'others') return { kind: 'loan' };
    if (group.kind === 'person' && group.holder)
      return { kind: 'cash', ...(kind ? { accountKind: kind } : {}), heldByOther: true };
    if (group.kind === 'bank')
      return { kind: 'cash', ...(kind ? { accountKind: kind } : {}), heldByOther: false };
  }
  if (base.kind === 'memo') return base;
  if (group.kind === 'others' && e === '') return { kind: 'loan' };
  if (/\b(sip|share|fund)s?\b/i.test(row.b) && (group.kind === 'bank' || group.kind === 'sip'))
    return { kind: 'fund_summary' };
  return base;
}

// ----------------------------------------------------------------------------------------------
// The order of the tabs
// ----------------------------------------------------------------------------------------------
export interface SequenceTab {
  /** position among the workbook's tabs, 0 = leftmost */
  index: number;
  ym: YearMonth;
}

/**
 * Tabs that do not fit the order the rest are in. The tab bar runs one way (newest at the left, or at the right); the longest run of
 * tabs that does so is the backbone, and a tab outside it is out of sequence. The month that would fit between its neighbours on the
 * backbone is suggested when exactly one year does. This is a hint for a person to confirm, never a correction.
 */
export function outOfSequence(
  tabs: SequenceTab[],
): Map<number, { suggested: string | null; between: [string | null, string | null] }> {
  const sorted = [...tabs].sort((a, b) => a.index - b.index);
  const n = sorted.length;
  const out = new Map<
    number,
    { suggested: string | null; between: [string | null, string | null] }
  >();
  if (n < 4) return out;
  const ord = sorted.map((t) => ymOrdinal(t.ym));
  // longest strictly monotone subsequence, both directions; keep the longer
  const lis = (cmp: (a: number, b: number) => boolean): number[] => {
    const len = new Array<number>(n).fill(1);
    const prev = new Array<number>(n).fill(-1);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < i; j++)
        if (cmp(ord[j]!, ord[i]!) && len[j]! + 1 > len[i]!) {
          len[i] = len[j]! + 1;
          prev[i] = j;
        }
    let bi = 0;
    for (let i = 1; i < n; i++) if (len[i]! > len[bi]!) bi = i;
    const keep: number[] = [];
    for (let i = bi; i >= 0; i = prev[i]!) keep.unshift(i);
    return keep;
  };
  const down = lis((a, b) => a > b);
  const up = lis((a, b) => a < b);
  const desc = down.length >= up.length;
  const keep = new Set(desc ? down : up);
  sorted.forEach((t, i) => {
    if (keep.has(i)) return;
    // nearest backbone tab on each side
    let left: number | null = null;
    let right: number | null = null;
    for (let k = i - 1; k >= 0; k--)
      if (keep.has(k)) {
        left = k;
        break;
      }
    for (let k = i + 1; k < n; k++)
      if (keep.has(k)) {
        right = k;
        break;
      }
    const lo = Math.min(
      ...[left, right].filter((x): x is number => x !== null).map((k) => ord[k]!),
    );
    const hi = Math.max(
      ...[left, right].filter((x): x is number => x !== null).map((k) => ord[k]!),
    );
    const key = (o: number | null) =>
      o === null ? null : ymKey({ year: Math.floor((o - 1) / 12), month: ((o - 1) % 12) + 1 });
    let suggested: string | null = null;
    if (left !== null && right !== null) {
      const fits: number[] = [];
      for (let y = Math.floor(lo / 12) - 1; y <= Math.floor(hi / 12) + 1; y++) {
        const o = y * 12 + t.ym.month;
        if (o >= lo && o <= hi) fits.push(o);
      }
      if (fits.length === 1) suggested = key(fits[0]!);
    }
    out.set(t.index, {
      suggested,
      between: [left === null ? null : key(ord[left]!), right === null ? null : key(ord[right]!)],
    });
  });
  return out;
}
