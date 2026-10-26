/**
 * The row grammar of the household "Summary - Bank Reports" sheet, shared by the importer (workbook.ts, which reads a month's
 * sheet into the app) and the sheet sync (sheet-sync.ts, which writes the app's figures back into a month's tab).
 *
 * Everything here is pure and works on plain values, never on a spreadsheet library, so the two directions cannot drift apart:
 * which row is which asset (R1-R8), who owns it, which bank it belongs to, its last four digits and whether it is joint are decided
 * once, here.
 */

/** A cell's value as the rules see it: dates are Date objects, everything else text or a number. */
export type Raw = string | number | Date | null;

/** Text of a cell with runs of white space collapsed; dates and empty cells are ''. */
export const str = (v: Raw): string =>
  (v === null || v instanceof Date ? '' : String(v)).replace(/\s+/g, ' ').trim();

export const num = (v: Raw): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const isoDate = (d: Date): string => d.toISOString().slice(0, 10);

export const DEFAULT_OWNERS = ['Rupash', 'Ragini', 'Advika', 'Viraj'];
export const DEFAULT_MINORS = ['Advika', 'Viraj'];

export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// ----------------------------------------------------------------------------------------------
// Column A: the group a row belongs to
// ----------------------------------------------------------------------------------------------
export interface Group {
  raw: string;
  institution: string | null;
  owner: string | null; // legal owner (or PAN holder for SIP groups)
  goalPerson: string | null;
  holder: string | null; // someone else's name when the account is not ours
  kind: 'bank' | 'sip' | 'person' | 'sg_bank' | 'others';
}

export function parseGroup(raw: string, owners: string[]): Group {
  const first = raw.split('\n')[0]!.replace(/\s+/g, ' ').trim();
  const sip = /^SIP\s*-\s*([A-Za-z]+)(?:\s*\(([A-Za-z]+)\))?/i.exec(first);
  if (sip) {
    const who = sip[1]!;
    const holder = sip[2] ?? who;
    return { raw, institution: null, owner: holder, goalPerson: who, holder: null, kind: 'sip' };
  }
  if (/^others$/i.test(first))
    return { raw, institution: null, owner: null, goalPerson: null, holder: null, kind: 'others' };
  if (/^(UOB|DBS)$/i.test(first))
    return {
      raw,
      institution: first.toUpperCase(),
      owner: null,
      goalPerson: null,
      holder: null,
      kind: 'sg_bank',
    };
  const atul = /^Atul\s+(.+)$/i.exec(first);
  if (atul)
    return {
      raw,
      institution: atul[1]!.trim(),
      owner: null,
      goalPerson: null,
      holder: 'Atul',
      kind: 'person',
    };
  const bank = /^(.+?)\s*-\s*([A-Za-z]+)$/.exec(first);
  if (bank && owners.some((o) => o.toLowerCase() === bank[2]!.toLowerCase())) {
    const owner = owners.find((o) => o.toLowerCase() === bank[2]!.toLowerCase())!;
    return {
      raw,
      institution: bank[1]!.trim(),
      owner,
      goalPerson: null,
      holder: null,
      kind: 'bank',
    };
  }
  // third-party counterparties (e.g. "Anup Pratap Singh", "Finvasia (Atul)")
  return {
    raw,
    institution: null,
    owner: null,
    goalPerson: null,
    holder: first.replace(/\s*\(.*\)$/, ''),
    kind: 'person',
  };
}

// ----------------------------------------------------------------------------------------------
// Column B: what the line says about itself
// ----------------------------------------------------------------------------------------------
export function accountKindOf(label: string): 'NRE' | 'NRO' | undefined {
  if (/NRE/i.test(label)) return 'NRE';
  if (/NRO/i.test(label)) return 'NRO';
  return undefined;
}
export const isJoint = (label: string): boolean => /\bJO\b|JO-/i.test(label);
export function last4Of(label: string): string | undefined {
  const m = /(\d{4})(?!.*\d{4})/.exec(label);
  return m ? m[1] : undefined;
}

/** A fund line: the name without "(STOPPED)", whether the SIP is stopped and whether it is the ULIP (counted with the funds in the sheet). */
export function fundParts(b: string): { name: string; stopped: boolean; isUlip: boolean } {
  const stopped = /\(STOPPED\)/i.test(b);
  const name = b
    .replace(/\(STOPPED\)/i, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name, stopped, isUlip: /wealth smart plus/i.test(name) };
}

// ----------------------------------------------------------------------------------------------
// Column N: structured fragments inside the free-text note
// ----------------------------------------------------------------------------------------------
/** The deposit numbers written in a note ("FD Number : 123-1, 456"), the first one split into its digits. */
export function fdNumberIn(note: string): {
  /** the first number as written, e.g. 999911112222-1 ('' when there is none) */
  first: string;
  digits: string;
  last4: string | undefined;
  /** the first number when it is a plausible deposit number (4 or more digits, letters, digits and hyphens only) */
  ref: string | undefined;
} {
  const m = /FD\s*Number\s*:\s*([\d,\-\s]+)/i.exec(note);
  const first = m ? m[1]!.split(',')[0]!.replace(/\s/g, '') : '';
  const digits = first.split('-')[0]!.replace(/\D/g, '');
  return {
    first,
    digits,
    last4: digits ? digits.slice(-4) : undefined,
    ref: digits.length >= 4 && /^[A-Za-z0-9-]{4,40}$/.test(first) ? first : undefined,
  };
}

/** The Singapore dollar balance and the exchange rate written in a note ("Base: $1= Rs 65 / Bal : $100.00"). */
export function foreignNoteIn(note: string): { sgd: number | null; base: number | null } {
  const sgd = /Bal\s*:\s*\$\s*([\d,]+(?:\.\d+)?)/i.exec(note);
  const base = /\$\s*1\s*=\s*Rs\.?\s*([\d.]+)/i.exec(note);
  return {
    sgd: sgd ? Number(sgd[1]!.replace(/,/g, '')) : null,
    base: base ? Number(base[1]) : null,
  };
}

// ----------------------------------------------------------------------------------------------
// Row classification (R1 to R8)
// ----------------------------------------------------------------------------------------------
/** The cells of one register row that decide what the row is. */
export interface RowFacts {
  /** column B, white space collapsed */
  b: string;
  /** column E as it is (a Date, text or empty) */
  e: Raw;
  /** column F when it is a number */
  f: number | null;
}

export type RowClass =
  | { kind: 'blank' }
  | { kind: 'no_group' }
  | { kind: 'placeholder' }
  | { kind: 'fd' }
  | { kind: 'cash'; accountKind: 'NRE' | 'NRO'; heldByOther: boolean }
  | { kind: 'cash_sg' }
  | { kind: 'fund'; name: string; stopped: boolean; isUlip: boolean }
  | { kind: 'loan' }
  | { kind: 'third_party' }
  | { kind: 'memo' }
  | { kind: 'unclassified' };

/**
 * Decides which kind of line a register row is, in the order of the rules in the data dictionary:
 * R7 placeholder (no amount), R1 deposit (E is a date), R2 Indian balance, R3 Singapore balance, R4 fund or ULIP,
 * R5 money lent, R6 shares or options held by someone else, then the "Papa" memo row, else R8 unclassified.
 */
export function classifyRegisterRow(row: RowFacts, group: Group | null): RowClass {
  const { b, e, f } = row;
  if (!b && f === null) return { kind: 'blank' };
  if (!group) return { kind: 'no_group' };
  if (f === null) return { kind: 'placeholder' };
  if (e instanceof Date) return { kind: 'fd' };
  const eStr = str(e);
  if (/^Cash-NR[EO]$/i.test(eStr))
    return {
      kind: 'cash',
      accountKind: eStr.slice(-3).toUpperCase() as 'NRE' | 'NRO',
      heldByOther: group.kind === 'person' && !!group.holder,
    };
  if (/^Cash SG$/i.test(eStr)) return { kind: 'cash_sg' };
  if (/^SIP/i.test(eStr)) return { kind: 'fund', ...fundParts(b) };
  if (/^Cash Loan$/i.test(eStr)) return { kind: 'loan' };
  if (/^(Shares|Options & Future)$/i.test(eStr)) return { kind: 'third_party' };
  if (/^Papa$/i.test(b)) return { kind: 'memo' };
  return { kind: 'unclassified' };
}
