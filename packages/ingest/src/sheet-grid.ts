/**
 * A month's sheet held in memory: every cell with its value, its formula (when it has one), the text as the sheet shows it and
 * whether it is formatted as a date. This is what the sync reads from the Google Sheets API (`spreadsheets.get` with grid data) and
 * what the planner works on. Pure: no network.
 */
import type { Raw } from './sheet-rows';

export interface GridCell {
  /** the value the sheet shows (a formula's result); dates are Date objects */
  value: Raw;
  /** the formula text ("=G12-H12") when the cell holds a formula; such a cell is never written */
  formula: string | null;
  /** the cell as formatted on the sheet ("₹1,00,000", "1 Nov 2026") */
  text: string;
  /** the cell is formatted as a date */
  isDate: boolean;
  /** the number format pattern, when the cell has one ("d mmm yyyy") */
  pattern: string | null;
}

export const EMPTY_CELL: GridCell = {
  value: null,
  formula: null,
  text: '',
  isDate: false,
  pattern: null,
};

// ----------------------------------------------------------------------------------------------
// A1 references
// ----------------------------------------------------------------------------------------------
/** Column letters to a 1-based number: A = 1, Z = 26, AB = 28. */
export function colNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** A 1-based column number to letters. */
export function colLetters(n: number): string {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26))
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

export function parseRef(ref: string): { col: number; row: number } {
  const m = /^([A-Za-z]{1,3})(\d{1,6})$/.exec(ref);
  if (!m) throw new RangeError(`not a cell reference: ${ref}`);
  return { col: colNumber(m[1]!), row: Number(m[2]) };
}

// ----------------------------------------------------------------------------------------------
// Dates: a sheet stores a date as the number of days since 30 December 1899
// ----------------------------------------------------------------------------------------------
const SHEET_EPOCH = Date.UTC(1899, 11, 30);

export function serialToDate(serial: number): Date {
  return new Date(SHEET_EPOCH + Math.floor(serial) * 86_400_000);
}

export function dateToSerial(iso: string): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(t)) throw new RangeError(`not a date: ${iso}`);
  return Math.round((t - SHEET_EPOCH) / 86_400_000);
}

// ----------------------------------------------------------------------------------------------
// The grid
// ----------------------------------------------------------------------------------------------
export class SheetGrid {
  /** rows are 0-based here; every public method takes 1-based sheet rows and columns */
  constructor(private readonly cells: GridCell[][]) {}

  get rowCount(): number {
    return this.cells.length;
  }

  at(row: number, col: number): GridCell {
    return this.cells[row - 1]?.[col - 1] ?? EMPTY_CELL;
  }

  cell(ref: string): GridCell {
    const { col, row } = parseRef(ref);
    return this.at(row, col);
  }

  value(ref: string): Raw {
    return this.cell(ref).value;
  }
}

// ----------------------------------------------------------------------------------------------
// From the Google Sheets API
// ----------------------------------------------------------------------------------------------
interface ApiNumberFormat {
  type?: string;
  pattern?: string;
}

/** The part of a `CellData` the sync asks for (see GRID_FIELDS in gsheet-client.ts). */
export interface ApiCell {
  userEnteredValue?: {
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    formulaValue?: string;
  };
  effectiveValue?: {
    numberValue?: number;
    stringValue?: string;
    boolValue?: boolean;
    errorValue?: unknown;
  };
  formattedValue?: string;
  effectiveFormat?: { numberFormat?: ApiNumberFormat };
}

export interface ApiGridData {
  startRow?: number;
  startColumn?: number;
  rowData?: { values?: ApiCell[] }[];
}

/** One cell of the API's answer as the grid keeps it. */
export function cellFromApi(c: ApiCell | undefined): GridCell {
  if (!c) return EMPTY_CELL;
  const fmt = c.effectiveFormat?.numberFormat;
  const isDate = fmt?.type === 'DATE' || fmt?.type === 'DATE_TIME';
  const eff = c.effectiveValue;
  let value: Raw = null;
  if (eff) {
    if (typeof eff.numberValue === 'number')
      value = isDate ? serialToDate(eff.numberValue) : eff.numberValue;
    else if (typeof eff.stringValue === 'string') value = eff.stringValue;
    else if (typeof eff.boolValue === 'boolean') value = eff.boolValue ? 'TRUE' : 'FALSE';
  } else if (c.userEnteredValue) {
    const u = c.userEnteredValue;
    if (typeof u.numberValue === 'number')
      value = isDate ? serialToDate(u.numberValue) : u.numberValue;
    else if (typeof u.stringValue === 'string') value = u.stringValue;
  }
  const formula = c.userEnteredValue?.formulaValue ?? null;
  if (value === null && !formula && !c.formattedValue && !isDate)
    return { ...EMPTY_CELL, pattern: fmt?.pattern ?? null };
  return {
    value,
    formula,
    text: c.formattedValue ?? (value === null || value instanceof Date ? '' : String(value)),
    isDate,
    pattern: fmt?.pattern ?? null,
  };
}

/** The first grid block of a sheet in the API's answer, as a grid whose first row is sheet row 1. */
export function gridFromApi(data: ApiGridData[] | undefined): SheetGrid {
  const block = data?.[0];
  const rows: GridCell[][] = [];
  const top = block?.startRow ?? 0;
  const left = block?.startColumn ?? 0;
  for (const [i, rd] of (block?.rowData ?? []).entries()) {
    const row = (rows[top + i] ??= []);
    for (const [j, c] of (rd.values ?? []).entries()) row[left + j] = cellFromApi(c);
  }
  // every row exists, even when it holds nothing
  for (let i = 0; i < rows.length; i++) rows[i] ??= [];
  return new SheetGrid(rows);
}
