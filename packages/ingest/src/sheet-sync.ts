/**
 * The Google Sheet sync planner: the reverse of the workbook importer. Given a month's sheet (as a grid) and the app's accounts, it works
 * out which sheet row is which asset, which constant cells to write and which new rows to add. It writes nothing and calls nothing; the
 * runner (sheet-sync-run.ts) applies the plan.
 *
 * Rules
 *  - which row is which asset comes from the importer's own grammar (sheet-rows.ts): the same classification, group, owner, bank,
 *    last four digits and joint ("JO") rules, applied to the sheet rather than rewritten here
 *  - only cells the sheet format uses are written, and a cell that holds a formula is never written
 *  - a row the app has no asset for is left alone and listed; so is an asset the app has closed
 *  - an account the sheet does not have yet gets a new row under its group, or is listed for placing by hand
 *  - running the plan twice gives the same sheet: a row that already shows the app's figures produces no change
 */
import { rowCode } from '@fwos/core';
import {
  colLetters,
  colNumber,
  dateToSerial,
  parseRef,
  type GridCell,
  type SheetGrid,
} from './sheet-grid';
import {
  classifyRegisterRow,
  fdNumberIn,
  isJoint,
  isoDate,
  last4Of,
  num,
  parseGroup,
  str,
  type Group,
  type Raw,
  type RowClass,
} from './sheet-rows';

// ----------------------------------------------------------------------------------------------
// What the app tells the planner
// ----------------------------------------------------------------------------------------------
export type SyncKind = 'cash' | 'cash_sg' | 'fd' | 'fund' | 'ulip' | 'loan' | 'third_party';

export interface SyncAsset {
  id: string;
  kind: SyncKind;
  /** the line as it is written in the sheet's column B (the asset's label); empty when the asset was added in the app */
  label: string;
  /** every name the asset goes by (label, nickname, fund name): a fund or a holder's line is matched on any of them */
  names: string[];
  /** the owner's name (for a fund, the PAN holder) */
  owner: string;
  institution: string | null;
  /** the person whose name an account or position is in, for money held by someone else */
  holder: string | null;
  last4: string | null;
  joint: boolean;
  accountKind: 'NRE' | 'NRO' | null;
  status: string;
  /** the asset's place in your sheet's order (the row it was imported from) */
  sortOrder: number | null;
  /** what the app shows today, in rupees: a balance, a fund's value, what a loan still owes */
  value: number | null;
  /** a balance in another currency: the amount, and the rupees per unit used today */
  foreign: { amount: number; rate: number } | null;
  fd: {
    principal: number;
    rate: number;
    bookedOn: string;
    maturityOn: string;
    maturityAmount: number;
    /** the full deposit number */
    ref: string | null;
  } | null;
  fund: { invested: number | null; startedOn: string | null; stopped: boolean } | null;
  loan: { counterparty: string; lentOn: string | null } | null;
}

export interface SyncOptions {
  /** the names of the household's people (needed to read a group heading such as "HDFC - Rupash") */
  owners: string[];
  /** assumed owner of a line whose group names none (as the importer does) */
  defaultOwner: string;
  /** the register's first and last row when the sheet does not show where it ends */
  firstRow: number;
  lastRow: number;
}

// ----------------------------------------------------------------------------------------------
// What the planner returns
// ----------------------------------------------------------------------------------------------
export interface CellChange {
  /** where, in the sheet as it will be (A1 style) */
  cell: string;
  /** the column's name in the sheet: Rate, Start date, Amount … */
  column: string;
  old: string;
  next: string;
}

export type RowStatus = 'update' | 'same' | 'closed' | 'unmatched' | 'added';

export interface RowPlan {
  /** the row in the sheet as it will be (a new row has its place after the rows added above it) */
  row: number;
  /** column B */
  label: string;
  /** the group heading the row belongs to ("HDFC Bank - Rupash") */
  group: string;
  kind: SyncKind | 'unknown';
  status: RowStatus;
  /** the app's name for the matching asset, when there is one */
  asset: string | null;
  changes: CellChange[];
  /** cells that hold a formula and were therefore left as they are */
  keptFormulas: string[];
  /** why a row is closed or unmatched, in words */
  note: string | null;
}

export interface CellWrite {
  /** A1 reference in the sheet as it will be after rows are added */
  ref: string;
  value: number | string;
  /** a date is written as the number of days since 30 December 1899, in the cell's own date format */
  isDate: boolean;
}

export interface PlannedInsert {
  /** the new rows go below this row of the sheet as it is now */
  anchor: number;
  count: number;
  /** per new row (top to bottom): the row to copy formulas from and the columns to copy, so "=F12" becomes "=F13" */
  formulas: { fromRow: number; columns: string[] }[];
}

export interface DateFormatFix {
  ref: string;
  pattern: string;
}

export interface NeedsPlacing {
  /** the app's name for the asset */
  asset: string;
  reason: string;
}

export interface SyncPlan {
  /** the last row of the register */
  registerEnd: number;
  rows: RowPlan[];
  writes: CellWrite[];
  inserts: PlannedInsert[];
  dateFormats: DateFormatFix[];
  /** in the app but not in the sheet, and not added */
  placeByHand: NeedsPlacing[];
  counts: {
    updated: number;
    unchanged: number;
    added: number;
    closed: number;
    unmatched: number;
    cells: number;
    formulasKept: number;
    recognised: number;
  };
}

// ----------------------------------------------------------------------------------------------
// The sheet's columns
// ----------------------------------------------------------------------------------------------
const COLUMN_NAME: Record<string, string> = {
  B: 'Line',
  C: 'Rate',
  D: 'Start date',
  E: 'Maturity date',
  F: 'Amount',
  G: 'Maturity value',
  H: 'Invested',
  N: 'Notes',
};

/** The closed states of an asset: the row stays in the sheet and is listed. */
const CLOSED = new Set(['closed', 'renewed', 'matured', 'gifted']);
const IN_REGISTER = new Set(['active', 'matured_unconfirmed', 'stopped']);

const norm = (s: string | null | undefined): string =>
  (s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
const round2 = (x: number): number => Math.round(x * 100) / 100;

// ----------------------------------------------------------------------------------------------
// Showing values the way a person reads them
// ----------------------------------------------------------------------------------------------
const MONTH_ABBR = [
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

export function showDate(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MONTH_ABBR[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
}
export function showMoney(n: number): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
const showRate = (r: number): string => `${(Math.round(r * 1e6) / 1e4).toString()}%`;

// ----------------------------------------------------------------------------------------------
// The note of a Singapore balance
// ----------------------------------------------------------------------------------------------
/** A number written like the old one: the same number of decimals, with thousands separators if it had them. */
function likeOld(oldText: string, n: number, minDecimals: number): string {
  const decimals = oldText.includes('.')
    ? oldText.split('.')[1]!.length
    : Number.isInteger(n)
      ? 0
      : minDecimals;
  const fixed = n.toFixed(decimals);
  return oldText.includes(',')
    ? Number(fixed).toLocaleString('en-US', {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      })
    : fixed;
}

/**
 * The note of a Singapore balance with its S$ amount and exchange rate brought up to date, in the text format the sheet uses
 * ("Base: $1= Rs 74.26" and "Bal : $100.00"). Anything else in the note stays; a note without these lines gets them added.
 */
export function withForeignNote(note: string, sgd: number, rate: number): string {
  const rate4 = Math.round(rate * 1e4) / 1e4;
  const balRe = /(Bal\s*:\s*\$\s*)([\d,]+(?:\.\d+)?)/i;
  const baseRe = /(\$\s*1\s*=\s*Rs\.?\s*)([\d.]+)/i;
  const hasBal = balRe.test(note);
  const hasBase = baseRe.test(note);
  let out = note;
  if (hasBal)
    out = out.replace(balRe, (_m, pre: string, old: string) => pre + likeOld(old, sgd, 2));
  if (hasBase) out = out.replace(baseRe, (_m, pre: string) => pre + String(rate4));
  const add: string[] = [];
  if (!hasBase) add.push(`Base: $1= Rs ${rate4}`);
  if (!hasBal) add.push(`Bal : $${sgd.toFixed(2)}`);
  return add.length === 0 ? out : [out.trim(), ...add].filter(Boolean).join('\n');
}

/** The note of a deposit with its deposit number written in; other text in the note stays. Null when nothing needs to change. */
export function withFdNumber(note: string, ref: string): string | null {
  const m = /(FD\s*Number\s*:\s*)([\d,\-\s]+)/i.exec(note);
  if (!m) return [note.trim(), `FD Number : ${ref}`].filter(Boolean).join('\n');
  const tokens = m[2]!.split(',');
  const first = tokens[0]!.replace(/\s/g, '');
  if (first === ref) return null;
  tokens[0] = ` ${ref}`;
  const body = tokens.join(',').replace(/^\s+/, '');
  const trailing = /\s+$/.exec(m[2]!)?.[0] ?? '';
  return (
    note.slice(0, m.index) + m[1] + body.trimEnd() + trailing + note.slice(m.index + m[0].length)
  );
}

// ----------------------------------------------------------------------------------------------
// Reading the sheet
// ----------------------------------------------------------------------------------------------
interface SheetRow {
  row: number;
  cls: RowClass;
  group: Group;
  groupStart: number;
  b: string;
  c: Raw;
  d: Raw;
  e: Raw;
  f: number | null;
  note: string;
}

interface GroupSpan {
  group: Group;
  start: number;
  /** the last row that holds a line */
  last: number;
  rows: SheetRow[];
}

/** Where the register ends: just above the total row (a SUM of column F) or the "Plans" heading, else the configured last row. */
export function registerEnd(
  grid: SheetGrid,
  opts: Pick<SyncOptions, 'firstRow' | 'lastRow'>,
): number {
  for (let r = opts.firstRow; r <= grid.rowCount; r++) {
    const f = grid.at(r, 6).formula ?? '';
    const a = str(grid.at(r, 1).value);
    if (/^=\s*SUM\(\s*\$?F\$?\d+\s*:\s*\$?F\$?\d+\s*\)\s*$/i.test(f) || /^plans?$/i.test(a))
      return Math.max(opts.firstRow, r - 1);
  }
  return opts.lastRow;
}

function scan(
  grid: SheetGrid,
  opts: SyncOptions,
  end: number,
): { rows: SheetRow[]; spans: GroupSpan[] } {
  const rows: SheetRow[] = [];
  const spans: GroupSpan[] = [];
  let group: Group | null = null;
  let span: GroupSpan | null = null;
  for (let r = opts.firstRow; r <= end; r++) {
    const a = grid.at(r, 1).value;
    if (str(a)) {
      group = parseGroup(String(a), opts.owners);
      span = { group, start: r, last: r, rows: [] };
      spans.push(span);
    }
    const b = str(grid.at(r, 2).value);
    const e = grid.at(r, 5).value;
    const f = num(grid.at(r, 6).value);
    const found = classifyRegisterRow({ b, e, f }, group);
    // the "Papa" line is a memo of family support, not an asset (the importer skips it too)
    const cls: RowClass = found.kind === 'loan' && /^Papa$/i.test(b) ? { kind: 'memo' } : found;
    if (!group || !span || cls.kind === 'blank' || cls.kind === 'no_group') continue;
    span.last = r;
    const row: SheetRow = {
      row: r,
      cls,
      group,
      groupStart: span.start,
      b,
      c: grid.at(r, 3).value,
      d: grid.at(r, 4).value,
      e,
      f,
      note: String(grid.at(r, 14).value ?? ''),
    };
    rows.push(row);
    span.rows.push(row);
  }
  return { rows, spans };
}

const KIND_OF_CLASS: Partial<Record<RowClass['kind'], SyncKind>> = {
  fd: 'fd',
  cash: 'cash',
  cash_sg: 'cash_sg',
  loan: 'loan',
  third_party: 'third_party',
};

function syncKindOfRow(r: SheetRow): SyncKind | 'unknown' {
  if (r.cls.kind === 'fund') return r.cls.isUlip ? 'ulip' : 'fund';
  if (r.cls.kind === 'cash' && r.cls.heldByOther) return 'third_party';
  return KIND_OF_CLASS[r.cls.kind] ?? 'unknown';
}

// ----------------------------------------------------------------------------------------------
// Matching rows to assets
// ----------------------------------------------------------------------------------------------
interface Pass<S, A> {
  /** the key of a sheet row and of an asset; rows and assets with the same key can be paired; null = not usable in this pass */
  s: (x: S) => string | null;
  a: (x: A) => string | null;
  /** several rows with one key are paired in order when both sides have the same number; otherwise only a single pair counts */
  many?: boolean;
}

/**
 * Pairs rows with assets pass by pass, strongest key first. A key that is shared by exactly one row and one asset is a match; a key
 * shared by the same number of rows and assets on both sides is paired in sheet order (they are indistinguishable by that key).
 * Anything else stays unpaired rather than being guessed.
 */
function pairUp<S, A>(
  rows: S[],
  assets: A[],
  passes: Pass<S, A>[],
  orderS: (x: S) => number,
  orderA: (x: A) => number,
): Map<S, A> {
  const out = new Map<S, A>();
  let leftS = [...rows];
  let leftA = [...assets];
  for (const p of passes) {
    const byS = new Map<string, S[]>();
    const byA = new Map<string, A[]>();
    for (const s of leftS) {
      const k = p.s(s);
      if (k) byS.set(k, [...(byS.get(k) ?? []), s]);
    }
    for (const a of leftA) {
      const k = p.a(a);
      if (k) byA.set(k, [...(byA.get(k) ?? []), a]);
    }
    for (const [k, ss] of byS) {
      const aa = byA.get(k);
      if (!aa || ss.length !== aa.length || (ss.length > 1 && !p.many)) continue;
      ss.sort((x, y) => orderS(x) - orderS(y));
      aa.sort((x, y) => orderA(x) - orderA(y));
      ss.forEach((s, i) => out.set(s, aa[i]!));
    }
    leftS = leftS.filter((s) => !out.has(s));
    const taken = new Set(out.values());
    leftA = leftA.filter((a) => !taken.has(a));
  }
  return out;
}

const iso = (v: Raw): string => (v instanceof Date ? isoDate(v) : '');

interface Matcher {
  kind: SyncKind;
  passes: Pass<SheetRow, SyncAsset>[];
}

function matchers(opts: SyncOptions): Matcher[] {
  const ownerOf = (r: SheetRow) => norm(r.group.owner ?? opts.defaultOwner);
  const inst = (r: SheetRow) => norm(r.group.institution);
  const cashKind = (r: SheetRow) => (r.cls.kind === 'cash' ? r.cls.accountKind : '');
  const key = (...parts: (string | null | undefined)[]) =>
    parts.some((p) => p === null || p === undefined) ? null : parts.join('|');
  const sheetLast4 = (r: SheetRow) => last4Of(r.b) ?? '';
  const refOf = (r: SheetRow) => fdNumberIn(r.note).ref?.toLowerCase() ?? null;

  return [
    {
      kind: 'fd',
      passes: [
        {
          s: (r) => {
            const x = refOf(r);
            return x ? key('ref', inst(r), x) : null;
          },
          a: (a) => (a.fd?.ref ? key('ref', norm(a.institution), a.fd.ref.toLowerCase()) : null),
        },
        {
          s: (r) => key(inst(r), ownerOf(r), iso(r.d), String(r.f)),
          a: (a) =>
            a.fd
              ? key(norm(a.institution), norm(a.owner), a.fd.bookedOn, String(a.fd.principal))
              : null,
          many: true,
        },
        {
          s: (r) => key(inst(r), ownerOf(r), iso(r.d), iso(r.e)),
          a: (a) =>
            a.fd ? key(norm(a.institution), norm(a.owner), a.fd.bookedOn, a.fd.maturityOn) : null,
          many: true,
        },
        {
          s: (r) => key(inst(r), ownerOf(r), String(r.f), iso(r.e)),
          a: (a) =>
            a.fd
              ? key(norm(a.institution), norm(a.owner), String(a.fd.principal), a.fd.maturityOn)
              : null,
          many: true,
        },
        {
          s: (r) => key(inst(r), ownerOf(r), iso(r.d)),
          a: (a) => (a.fd ? key(norm(a.institution), norm(a.owner), a.fd.bookedOn) : null),
        },
        {
          s: (r) => key(inst(r), ownerOf(r), norm(r.b), String(isJoint(r.b)), sheetLast4(r)),
          a: (a) =>
            key(norm(a.institution), norm(a.owner), norm(a.label), String(a.joint), a.last4 ?? ''),
        },
      ],
    },
    {
      kind: 'cash',
      passes: [
        {
          s: (r) => key(inst(r), ownerOf(r), cashKind(r), sheetLast4(r), String(isJoint(r.b))),
          a: (a) =>
            key(
              norm(a.institution),
              norm(a.owner),
              a.accountKind ?? '',
              a.last4 ?? '',
              String(a.joint),
            ),
          many: true,
        },
        {
          s: (r) => key(inst(r), ownerOf(r), cashKind(r), sheetLast4(r)),
          a: (a) => key(norm(a.institution), norm(a.owner), a.accountKind ?? '', a.last4 ?? ''),
        },
        {
          s: (r) =>
            sheetLast4(r) ? null : key(inst(r), ownerOf(r), cashKind(r), String(isJoint(r.b))),
          a: (a) => key(norm(a.institution), norm(a.owner), a.accountKind ?? '', String(a.joint)),
        },
        {
          s: (r) => (sheetLast4(r) ? null : key(inst(r), ownerOf(r), cashKind(r))),
          a: (a) => key(norm(a.institution), norm(a.owner), a.accountKind ?? ''),
        },
      ],
    },
    {
      kind: 'cash_sg',
      passes: [
        {
          s: (r) =>
            key(norm(r.group.institution ?? r.b), r.group.owner ? norm(r.group.owner) : null),
          a: (a) => key(norm(a.institution), norm(a.owner)),
        },
        { s: (r) => key(norm(r.group.institution ?? r.b)), a: (a) => key(norm(a.institution)) },
      ],
    },
    {
      kind: 'loan',
      passes: [
        {
          s: (r) => key(norm(r.b), iso(r.c)),
          a: (a) => (a.loan ? key(norm(a.loan.counterparty), a.loan.lentOn ?? '') : null),
          many: true,
        },
        {
          s: (r) => key(norm(r.b)),
          a: (a) => (a.loan ? key(norm(a.loan.counterparty)) : null),
          many: true,
        },
      ],
    },
  ];
}

/** Pairs every kind of row with its asset. Funds (and the ULIP) and holders' lines compare a name against any name an asset goes by. */
function matchAll(
  rows: SheetRow[],
  assets: SyncAsset[],
  opts: SyncOptions,
): Map<SheetRow, SyncAsset> {
  const out = new Map<SheetRow, SyncAsset>();
  const orderS = (r: SheetRow) => r.row;
  const orderA = (a: SyncAsset) => a.sortOrder ?? 1e9;
  for (const m of matchers(opts)) {
    const rs = rows.filter((r) => syncKindOfRow(r) === m.kind);
    const as = assets.filter((a) => a.kind === m.kind);
    for (const [r, a] of pairUp(rs, as, m.passes, orderS, orderA)) out.set(r, a);
  }
  // funds and the ULIP: the name may be any of the asset's names, so each sheet row is tried against each name
  for (const kind of ['fund', 'ulip'] as const) {
    const rs = rows.filter((r) => syncKindOfRow(r) === kind);
    const as = assets.filter((a) => a.kind === kind);
    const left = new Set(as);
    const owner = (r: SheetRow) => norm(r.group.owner ?? opts.defaultOwner);
    const nameOf = (r: SheetRow) => (r.cls.kind === 'fund' ? norm(r.cls.name) : '');
    // a duplicate the importer numbered ("Fund #45") and a "(STOPPED)" mark are not part of the name
    const names = (a: SyncAsset) => [
      ...new Set(a.names.map((n) => norm(n.replace(/\s*#\d+$/, '').replace(/\(STOPPED\)/i, '')))),
    ];
    const strong = (r: SheetRow, a: SyncAsset) =>
      owner(r) === norm(a.owner) && names(a).includes(nameOf(r));
    // 1. same person, same name, same start date  2. same person and name, in sheet order  3. same name under another person, if unique
    const unpaired = [...rs];
    const tiers: ((r: SheetRow, a: SyncAsset) => boolean)[] = [
      (r, a) => strong(r, a) && iso(r.d) !== '' && iso(r.d) === (a.fund?.startedOn ?? ''),
      strong,
      (r, a) => names(a).includes(nameOf(r)),
    ];
    tiers.forEach((fits, tier) => {
      for (const r of [...unpaired].sort((x, y) => x.row - y.row)) {
        const cands = [...left].filter((a) => fits(r, a)).sort((x, y) => orderA(x) - orderA(y));
        if (cands.length === 0) continue;
        // the last tier only counts when the name belongs to exactly one asset
        if (tier === 2 && cands.length !== 1) continue;
        out.set(r, cands[0]!);
        left.delete(cands[0]!);
        unpaired.splice(unpaired.indexOf(r), 1);
      }
    });
  }
  // lines kept by someone else (shares, options, an account in another person's name)
  const tpRows = rows.filter((r) => syncKindOfRow(r) === 'third_party');
  const tpLeft = new Set(assets.filter((a) => a.kind === 'third_party'));
  for (const r of tpRows) {
    const holder = norm(r.group.holder ?? r.b);
    const isAccount = r.cls.kind === 'cash';
    const cands = [...tpLeft].filter((a) => {
      if (norm(a.holder) !== holder && !a.names.some((n) => norm(n).includes(holder))) return false;
      if (isAccount)
        return (
          (!r.group.institution || norm(a.institution) === norm(r.group.institution)) &&
          a.names.some((n) => /account held by/i.test(n))
        );
      return a.names.some((n) => norm(n).startsWith(norm(r.b)));
    });
    if (cands.length === 1) {
      out.set(r, cands[0]!);
      tpLeft.delete(cands[0]!);
    }
  }
  return out;
}

// ----------------------------------------------------------------------------------------------
// The plan
// ----------------------------------------------------------------------------------------------
type Next =
  | { kind: 'money'; v: number }
  | { kind: 'rate'; v: number }
  | { kind: 'date'; iso: string }
  | { kind: 'text'; v: string };

interface Draft {
  row: number;
  col: string;
  next: Next;
}

function sameValue(cell: GridCell, next: Next): boolean {
  const v = cell.value;
  switch (next.kind) {
    case 'money':
      return typeof v === 'number' && Math.abs(v - next.v) < 0.005;
    case 'rate':
      return typeof v === 'number' && Math.abs(v - next.v) < 1e-9;
    case 'date':
      return v instanceof Date && isoDate(v) === next.iso;
    case 'text':
      return typeof v === 'string' && v === next.v;
  }
}

const showNext = (n: Next): string =>
  n.kind === 'money'
    ? showMoney(n.v)
    : n.kind === 'rate'
      ? showRate(n.v)
      : n.kind === 'date'
        ? showDate(n.iso)
        : n.v;

/** Rows and groups of the sheet that a new line can go under. */
function groupFor(spans: GroupSpan[], a: SyncAsset): GroupSpan | null {
  const sameBank = (s: GroupSpan) =>
    s.group.kind === 'bank' &&
    norm(s.group.institution) === norm(a.institution) &&
    norm(s.group.owner) === norm(a.owner);
  if (a.kind === 'cash' || a.kind === 'fd') {
    const c = spans.filter(sameBank);
    return c.length === 1 ? c[0]! : null;
  }
  if (a.kind === 'cash_sg') {
    const c = spans.filter(
      (s) => s.group.kind === 'sg_bank' && norm(s.group.institution) === norm(a.institution),
    );
    return c.length === 1 ? c[0]! : null;
  }
  if (a.kind === 'fund') {
    const c = spans.filter((s) => s.group.kind === 'sip' && norm(s.group.owner) === norm(a.owner));
    return c.length === 1 ? c[0]! : null;
  }
  if (a.kind === 'loan') {
    const c = spans.filter((s) => s.group.kind === 'others');
    return c.length === 1 ? c[0]! : null;
  }
  return null;
}

/** The date pattern a column uses in the sheet, taken from its first date cell, so a date written into a bare cell looks like the others. */
function datePatterns(grid: SheetGrid, rows: SheetRow[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows)
    for (const col of ['C', 'D', 'E']) {
      const cell = grid.at(r.row, colNumber(col));
      if (cell.isDate && cell.pattern && !out[col]) out[col] = cell.pattern;
    }
  return out;
}

export interface SheetLayout {
  registerEnd: number;
  /** lines the importer's row rules recognise, by kind */
  byKind: Partial<Record<SyncKind, number>>;
  recognised: number;
  /** lines with an amount that match none of the rules (the importer would stop to ask about them) */
  unclassified: number;
}

/** What a month's sheet holds, judged by the importer's own row rules: used to check a template before it is copied or filled. */
export function layoutOf(grid: SheetGrid, opts: SyncOptions): SheetLayout {
  const end = registerEnd(grid, opts);
  const { rows } = scan(grid, opts, end);
  const byKind: SheetLayout['byKind'] = {};
  let unclassified = 0;
  for (const r of rows) {
    const k = syncKindOfRow(r);
    if (k === 'unknown') {
      if (r.cls.kind === 'unclassified') unclassified++;
      continue;
    }
    byKind[k] = (byKind[k] ?? 0) + 1;
  }
  return {
    registerEnd: end,
    byKind,
    recognised: Object.values(byKind).reduce((n, v) => n + (v ?? 0), 0),
    unclassified,
  };
}

export function planSheetSync(grid: SheetGrid, assets: SyncAsset[], opts: SyncOptions): SyncPlan {
  const end = registerEnd(grid, opts);
  const { rows, spans } = scan(grid, opts, end);
  const inRegister = assets.filter((a) => IN_REGISTER.has(a.status) || CLOSED.has(a.status));
  const paired = matchAll(rows, inRegister, opts);
  const patterns = datePatterns(grid, rows);

  const rowPlans: RowPlan[] = [];
  const drafts: Draft[] = [];
  const recognised = rows.filter(
    (r) => syncKindOfRow(r) !== 'unknown' && r.cls.kind !== 'memo' && r.cls.kind !== 'placeholder',
  ).length;
  const usedAssets = new Set<SyncAsset>();

  // ---- rows that are already in the sheet
  for (const r of rows) {
    if (r.cls.kind === 'placeholder' || r.cls.kind === 'memo') continue;
    const kind = syncKindOfRow(r);
    const plan: RowPlan = {
      row: r.row,
      label: r.b,
      group: r.group.raw.split('\n')[0]!.trim(),
      kind,
      status: 'unmatched',
      asset: null,
      changes: [],
      keptFormulas: [],
      note: null,
    };
    rowPlans.push(plan);
    const a = paired.get(r);
    if (!a) {
      plan.note =
        kind === 'unknown'
          ? 'This line did not match any of the sheet’s row types, so it was left as it is.'
          : 'Nothing in the app matches this line, so it was left as it is.';
      continue;
    }
    usedAssets.add(a);
    plan.asset = a.label || a.names[0] || a.id;
    if (CLOSED.has(a.status) || (a.kind === 'loan' && a.value !== null && a.value <= 0)) {
      plan.status = 'closed';
      plan.note =
        'Closed in the app, still in the sheet: left as it is. Remove the row yourself when you no longer want it.';
      continue;
    }
    plan.status = 'same';
    const want = (col: string, next: Next) => drafts.push({ row: r.row, col, next });
    if (a.kind === 'cash' || a.kind === 'third_party') {
      if (a.value !== null) want('F', { kind: 'money', v: round2(a.value) });
    } else if (a.kind === 'cash_sg') {
      if (a.value !== null) want('F', { kind: 'money', v: round2(a.value) });
      if (a.foreign) {
        const note = withForeignNote(r.note, a.foreign.amount, a.foreign.rate);
        if (note !== r.note) want('N', { kind: 'text', v: note });
      }
    } else if (a.kind === 'fd' && a.fd) {
      want('C', { kind: 'rate', v: a.fd.rate });
      want('D', { kind: 'date', iso: a.fd.bookedOn });
      want('E', { kind: 'date', iso: a.fd.maturityOn });
      want('F', { kind: 'money', v: round2(a.fd.principal) });
      want('G', { kind: 'money', v: round2(a.fd.maturityAmount) });
      if (a.fd.ref) {
        const note = withFdNumber(r.note, a.fd.ref);
        if (note !== null) want('N', { kind: 'text', v: note });
      }
    } else if (a.kind === 'fund' || a.kind === 'ulip') {
      if (a.value !== null) want('F', { kind: 'money', v: round2(a.value) });
      if (a.kind === 'fund' && a.fund) {
        if (a.fund.invested !== null && a.fund.invested > 0)
          want('H', { kind: 'money', v: round2(a.fund.invested) });
        if (a.fund.startedOn) want('D', { kind: 'date', iso: a.fund.startedOn });
        if (a.fund.stopped && !/\(STOPPED\)/i.test(r.b))
          want('B', { kind: 'text', v: `(STOPPED) ${r.b}` });
      }
    } else if (a.kind === 'loan') {
      if (a.value !== null) want('F', { kind: 'money', v: round2(a.value) });
    }
  }

  // ---- compare each wanted cell with what the sheet has; formulas are never touched
  const planOf = new Map(rowPlans.map((p) => [p.row, p]));
  const pending: { row: number; col: string; next: Next; cell: GridCell }[] = [];
  for (const d of drafts) {
    const plan = planOf.get(d.row)!;
    const cell = grid.at(d.row, colNumber(d.col));
    if (cell.formula) {
      plan.keptFormulas.push(`${d.col}${d.row}`);
      continue;
    }
    if (sameValue(cell, d.next)) continue;
    pending.push({ row: d.row, col: d.col, next: d.next, cell });
  }

  // ---- accounts the sheet does not have: a new row under their group, or a note to place them by hand
  const inserts: PlannedInsert[] = [];
  const placeByHand: NeedsPlacing[] = [];
  const addedRows: {
    anchor: number;
    plan: RowPlan;
    cells: { col: string; next: Next }[];
    formulaFrom: number | null;
    span: GroupSpan;
  }[] = [];
  const unplaced = inRegister.filter(
    (a) =>
      !usedAssets.has(a) && IN_REGISTER.has(a.status) && (a.kind !== 'fund' || a.fund !== null),
  );
  for (const a of unplaced) {
    const name = a.label || a.names[0] || a.id;
    const span = groupFor(spans, a);
    if (!span) {
      placeByHand.push({
        asset: name,
        reason:
          'No group in the sheet matches its bank and owner. Add it by hand under the right heading.',
      });
      continue;
    }
    // a loose row of the same kind in that group could be this account under another spelling: do not add a copy
    const looseRows = span.rows.filter((r) => !paired.has(r) && syncKindOfRow(r) === a.kind);
    if (looseRows.length > 0) {
      placeByHand.push({
        asset: name,
        reason: `The sheet has a line it could not match in the same group (row ${looseRows.map((r) => r.row).join(', ')}). Check whether it is this one; if it is, correct its details by hand.`,
      });
      continue;
    }
    const made = newRowCells(a, span);
    if ('reason' in made) {
      placeByHand.push({ asset: name, reason: made.reason });
      continue;
    }
    const cells = made.cells;
    // The new row goes below the last line of its own kind in the group, so it takes that line's formats (dates, percent, money).
    // At the very end of the register that would fall outside the total's range: then it goes one line higher, inside it.
    const sameKind = span.rows.filter((r) => syncKindOfRow(r) === a.kind);
    const lastSame = sameKind.length > 0 ? sameKind[sameKind.length - 1]!.row : span.last;
    const beyondTotal = lastSame >= end;
    if (beyondTotal && span.rows.length < 2) {
      placeByHand.push({
        asset: name,
        reason:
          'Its group is the last line of the register, where a new row would fall outside the total. Insert the row by hand.',
      });
      continue;
    }
    const anchor = beyondTotal ? lastSame - 1 : lastSame;
    const sibling = [...sameKind].reverse().find((r) => r.row <= anchor);
    const plan: RowPlan = {
      row: 0,
      label:
        cells.find((c) => c.col === 'B')?.next.kind === 'text'
          ? (cells.find((c) => c.col === 'B')!.next as { v: string }).v
          : name,
      group: span.group.raw.split('\n')[0]!.trim(),
      kind: a.kind,
      status: 'added',
      asset: name,
      changes: [],
      keptFormulas: [],
      note: 'Not in the sheet yet: a new row is added under its group.',
    };
    addedRows.push({ anchor, plan, cells, formulaFrom: sibling ? sibling.row : null, span });
  }

  // ---- row numbers once the new rows are in
  addedRows.sort((x, y) => x.anchor - y.anchor);
  const shiftOf = (row: number) => addedRows.filter((x) => x.anchor < row).length;
  const finalRow = (row: number) => row + shiftOf(row);
  const perAnchor = new Map<number, typeof addedRows>();
  for (const x of addedRows) perAnchor.set(x.anchor, [...(perAnchor.get(x.anchor) ?? []), x]);

  const writes: CellWrite[] = [];
  const dateFormats: DateFormatFix[] = [];
  const addWrite = (ref: string, next: Next, cell: GridCell | null) => {
    writes.push({
      ref,
      value: next.kind === 'date' ? dateToSerial(next.iso) : next.v,
      isDate: next.kind === 'date',
    });
    if (next.kind === 'date' && !cell?.isDate) {
      const col = ref.replace(/\d+/g, '');
      const pattern = patterns[col] ?? patterns.D ?? patterns.E ?? 'd mmm yyyy';
      dateFormats.push({ ref, pattern });
    }
  };

  for (const p of pending) {
    const plan = planOf.get(p.row)!;
    const ref = `${p.col}${finalRow(p.row)}`;
    plan.changes.push({
      cell: ref,
      column: COLUMN_NAME[p.col] ?? p.col,
      old: p.cell.text,
      next: showNext(p.next),
    });
    addWrite(ref, p.next, p.cell);
  }
  for (const plan of rowPlans) {
    plan.row = finalRow(plan.row);
    plan.keptFormulas = plan.keptFormulas.map((ref) => {
      const { col, row } = parseRef(ref);
      return `${colLetters(col)}${finalRow(row)}`;
    });
    if (plan.status === 'unmatched' || plan.status === 'closed') continue;
    plan.status = plan.changes.length > 0 ? 'update' : 'same';
  }
  for (const [anchor, list] of perAnchor) {
    const fromRow = list[0]!.formulaFrom;
    inserts.push({
      anchor,
      count: list.length,
      formulas: list.map((x) => {
        const written = new Set(x.cells.map((c) => c.col));
        const cols = x.formulaFrom
          ? ['G', 'H', 'I'].filter(
              (c) =>
                (grid.at(x.formulaFrom!, colNumber(c)).formula ?? '') !== '' && !written.has(c),
            )
          : [];
        return { fromRow: x.formulaFrom ?? fromRow ?? anchor, columns: cols };
      }),
    });
    list.forEach((x, i) => {
      const row = finalRow(anchor) + i + 1;
      x.plan.row = row;
      for (const c of x.cells) {
        const ref = `${c.col}${row}`;
        x.plan.changes.push({
          cell: ref,
          column: COLUMN_NAME[c.col] ?? c.col,
          old: '',
          next: showNext(c.next),
        });
        addWrite(ref, c.next, null);
      }
      rowPlans.push(x.plan);
    });
  }
  inserts.sort((x, y) => x.anchor - y.anchor);
  rowPlans.sort((x, y) => x.row - y.row);

  const count = (s: RowStatus) => rowPlans.filter((p) => p.status === s).length;
  return {
    registerEnd: finalRow(end) + 0,
    rows: rowPlans,
    writes,
    inserts,
    dateFormats,
    placeByHand,
    counts: {
      updated: count('update'),
      unchanged: count('same'),
      added: count('added'),
      closed: count('closed'),
      unmatched: count('unmatched'),
      cells: writes.length,
      formulasKept: rowPlans.reduce((n, p) => n + p.keptFormulas.length, 0),
      recognised,
    },
  };
}

/** The cells of a new row for an account, in the sheet's format; null when the format needs something the app cannot supply. */
function newRowCells(
  a: SyncAsset,
  span: GroupSpan,
): { cells: { col: string; next: Next }[] } | { reason: string } {
  const text = (col: string, v: string) => ({ col, next: { kind: 'text', v } as Next });
  const money = (col: string, v: number) => ({
    col,
    next: { kind: 'money', v: round2(v) } as Next,
  });
  const date = (col: string, v: string) => ({ col, next: { kind: 'date', iso: v } as Next });
  const lineOf = (type: string) =>
    a.label ||
    rowCode({
      type,
      label: null,
      kind: a.accountKind,
      joint: a.joint,
      last4: a.last4,
      currency: a.kind === 'cash_sg' ? 'SGD' : 'INR',
    });
  if (a.kind === 'cash') {
    if (!a.accountKind || a.value === null)
      return {
        reason:
          'The sheet needs to know whether it is NRE or NRO; set that in the app, or add the line by hand.',
      };
    return {
      cells: [
        text('B', lineOf('bank_account')),
        text('E', `Cash-${a.accountKind}`),
        money('F', a.value),
      ],
    };
  }
  if (a.kind === 'cash_sg') {
    if (a.value === null) return { reason: 'The app has no value for this balance yet.' };
    const out = [text('B', 'Cash'), text('E', 'Cash SG'), money('F', a.value)];
    if (a.foreign) out.push(text('N', withForeignNote('', a.foreign.amount, a.foreign.rate)));
    return { cells: out };
  }
  if (a.kind === 'fd' && a.fd) {
    const out = [
      text('B', lineOf('fixed_deposit')),
      { col: 'C', next: { kind: 'rate', v: a.fd.rate } as Next },
      date('D', a.fd.bookedOn),
      date('E', a.fd.maturityOn),
      money('F', a.fd.principal),
      money('G', a.fd.maturityAmount),
    ];
    if (a.fd.ref) out.push(text('N', `FD Number : ${a.fd.ref}`));
    return { cells: out };
  }
  if (a.kind === 'fund' && a.fund && a.value !== null) {
    // the goal ("SIP Advika Education") is the group's: it can only be copied when the group's funds all share one
    const goals = new Set(span.rows.filter((r) => r.cls.kind === 'fund').map((r) => str(r.e)));
    if (goals.size !== 1)
      return {
        reason:
          'The sheet needs a goal on a fund line and the funds in its group do not share one; add the line by hand.',
      };
    const name = a.names[0] ?? a.label;
    const out = [
      text('B', a.fund.stopped ? `(STOPPED) ${name}` : name),
      text('E', [...goals][0]!),
      money('F', a.value),
    ];
    if (a.fund.startedOn) out.push(date('D', a.fund.startedOn));
    if (a.fund.invested !== null && a.fund.invested > 0) out.push(money('H', a.fund.invested));
    return { cells: out };
  }
  if (a.kind === 'loan' && a.loan && a.value !== null && a.value > 0) {
    const out = [
      text('B', a.loan.counterparty),
      text('D', 'Cash Loan'),
      text('E', 'Cash Loan'),
      money('F', a.value),
    ];
    if (a.loan.lentOn) out.push(date('C', a.loan.lentOn));
    return { cells: out };
  }
  if (a.kind === 'loan') return { reason: 'Nothing is owed on it, so there is nothing to add.' };
  return {
    reason:
      'The sheet keeps this kind of line under a heading the app does not know; add it by hand.',
  };
}

/** A summary line for a person: "12 rows will change, 2 new rows, 1 closed in the app". */
export function describePlan(p: SyncPlan): string {
  const bits = [
    `${p.counts.updated} row${p.counts.updated === 1 ? '' : 's'} to change`,
    `${p.counts.unchanged} already right`,
  ];
  if (p.counts.added) bits.push(`${p.counts.added} new row${p.counts.added === 1 ? '' : 's'}`);
  if (p.counts.closed) bits.push(`${p.counts.closed} closed in the app, still in the sheet`);
  if (p.counts.unmatched) bits.push(`${p.counts.unmatched} not matched`);
  if (p.placeByHand.length) bits.push(`${p.placeByHand.length} to place by hand`);
  return bits.join(', ');
}
