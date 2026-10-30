/**
 * Reading a bank account statement line by line, from whatever the bank lets you download: an Excel file (.xlsx), a CSV, the
 * "Excel" that is really a web page (several Indian banks send an HTML table named .xls), or a PDF.
 *
 * Banks do not share one layout, so the reader does not depend on one. In a table it finds the heading row by what every statement
 * has: a date column, a narration (description, particulars, remarks), the money out and in (withdrawal and deposit, debit and
 * credit, or one amount with a Dr/Cr column) and the balance. In a PDF it reads each line that starts with a date and takes the
 * balance from the end of the line; the amount and its direction then come from how the balance moved, which does not depend on
 * where the columns are.
 *
 * Every line is checked: the balance before it, plus what came in, less what went out, must give the balance after it. A statement
 * whose newest line comes first is turned round. A break in that chain is reported in `warnings`, never smoothed over. Long digit runs
 * in a narration (account and card numbers) are cut to their last four digits before anything leaves this file.
 *
 * Pure apart from opening the file: no database, no AI.
 */
import { gridsFromXls } from './xls-binary';
import ExcelJS from 'exceljs';
import { casPdfText } from './cas-pdf';
import { maskIdentifiers } from './workbook';

export type Cell = string | number | Date | null;

export interface StatementLine {
  /** the transaction date (ISO) */
  date: string;
  narration: string;
  /** the cheque or reference number, when there is a column for it */
  ref: string | null;
  /** money out and money in, both 0 or more; exactly one of them is above 0 */
  debit: number;
  credit: number;
  /** the balance after the line, when the statement gives it */
  balance: number | null;
}

export interface BankStatement {
  lines: StatementLine[];
  /** the account's last four digits, when the statement prints its number */
  last4: string | null;
  /** the first and last transaction dates */
  from: string | null;
  to: string | null;
  /** the balance before the first line and after the last one */
  opening: number | null;
  closing: number | null;
  /** how the lines were read */
  layout: 'debit-credit' | 'amount-drcr' | 'balance-moves';
  /** lines whose balance does not follow from the one before, after the order was settled */
  breaks: number;
  warnings: string[];
  /** the day the account was opened, when the statement prints it ("A/C Opening Date") */
  openedOn?: string | null;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const validIso = (y: number, m: number, d: number): string | null => {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCMonth() === m - 1 ? `${y}-${pad(m)}-${pad(d)}` : null;
};
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y));

/** A statement date: Indian statements write the day first (31/03/2024, 31-Mar-24, 31 Mar 2024); 2024-03-31 and Excel dates also work. */
export function statementDate(v: Cell): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return validIso(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === 'number') {
    // an Excel serial day (1 = 1 Jan 1900); 25569 is 1 Jan 1970
    if (v < 30000 || v > 80000) return null;
    const t = new Date(Math.round((v - 25569) * 86400000));
    return validIso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  const s = v.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]|$)/.exec(s);
  if (m) return validIso(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{4}|\d{2})(?![\d])/.exec(s);
  if (m) return validIso(year(m[3]!), Number(m[2]), Number(m[1]));
  m = /^(\d{1,2})[\s\-/.]*([A-Za-z]{3,9})[\s\-/.,]*(\d{4}|\d{2})(?![\d])/.exec(s);
  if (m) {
    const mon = MONTHS[m[2]!.toLowerCase().slice(0, 3)];
    return mon ? validIso(year(m[3]!), mon, Number(m[1])) : null;
  }
  return null;
}

/**
 * An amount as a statement writes it: "1,23,456.78", "₹ 500", "500.00 Cr", "(250.00)", "-". Returns the number (negative for
 * "Dr" or brackets) or null when the cell holds no amount.
 */
export function statementAmount(v: Cell): number | null {
  if (v === null || v === undefined || v instanceof Date) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = v.trim();
  if (!s || /^[-–—]+$/.test(s)) return null;
  let sign = 1;
  if (/\bdr\.?$/i.test(s)) sign = -1;
  s = s.replace(/\b(cr|dr)\.?$/i, '').trim();
  if (/^\(.*\)$/.test(s)) {
    sign = -sign;
    s = s.slice(1, -1);
  }
  s = s.replace(/₹|rs\.?|inr/gi, '').replace(/[,\s]/g, '');
  if (s.startsWith('-')) {
    sign = -sign;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return sign * Number(s);
}

const text = (v: Cell) =>
  v === null || v === undefined
    ? ''
    : v instanceof Date
      ? v.toISOString().slice(0, 10)
      : String(v).replace(/\s+/g, ' ').trim();
const head = (v: Cell) =>
  text(v)
    .toLowerCase()
    .replace(/[^a-z/ ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** A narration as it is kept: one line, account and card numbers cut to their last four digits, at most 200 characters. */
export const cleanNarration = (s: string) =>
  maskIdentifiers(s.replace(/\s+/g, ' ').trim()).slice(0, 200);

interface Columns {
  date: number;
  narration: number;
  ref: number | null;
  debit: number | null;
  credit: number | null;
  amount: number | null;
  drcr: number | null;
  balance: number | null;
}

/** Which column holds what, from a heading row; null when the row is not a statement's heading. */
export function headingColumns(row: Cell[]): Columns | null {
  const h = row.map(head);
  const find = (re: RegExp, not?: RegExp) =>
    h.findIndex((x) => re.test(x) && !(not && not.test(x)));
  // the transaction date, not the value date, when both are there
  let date = find(/^(txn |tran |transaction |trans |post |posting |book |booking )?date$|^date$/);
  if (date < 0) date = find(/date/, /value/);
  if (date < 0) date = find(/date/);
  const narration = find(
    /narration|description|particulars|remarks|details|transaction remarks|transaction details/,
  );
  const refAt = find(/chq|cheque|ref|instrument/);
  const ref = refAt === narration ? -1 : refAt;
  const debit = find(/withdrawa?l|debit|^dr$|^dr amount|paid out|money out/);
  const credit = find(/deposit|credit|^cr$|^cr amount|paid in|money in/);
  const balance = find(/balance/);
  const drcr = find(/^(dr ?\/ ?cr|cr ?\/ ?dr|dr cr|cr dr|type|txn type|transaction type)$/);
  const amount = find(/^(transaction )?amount( inr| in rs| rs)?$|^amt$/);
  if (date < 0 || narration < 0) return null;
  const pick = (i: number) => (i >= 0 ? i : null);
  if (debit >= 0 && credit >= 0 && debit !== credit)
    return {
      date,
      narration,
      ref: pick(ref),
      debit,
      credit,
      amount: null,
      drcr: null,
      balance: pick(balance),
    };
  if (amount >= 0)
    return {
      date,
      narration,
      ref: pick(ref),
      debit: null,
      credit: null,
      amount,
      drcr: pick(drcr),
      balance: pick(balance),
    };
  return null;
}

const ACCOUNT_NO =
  /(?:a\/?c|account)\s*(?:no|number|num)?\.?\s*[:-]?\s*[X*x\d][X*x\d\s-]{3,}?(\d{4})\b/i;

/** The account's last four digits from the lines above the table ("Account No : XXXXXXXX1234"). */
export function accountLast4(rows: string[]): string | null {
  for (const r of rows) {
    const m = ACCOUNT_NO.exec(r);
    if (m) return m[1]!;
  }
  return null;
}

/** Puts the lines in date order (oldest first) and checks the balance chain; returns the number of breaks. */
function settle(lines: StatementLine[]): { lines: StatementLine[]; breaks: number } {
  const breaksOf = (ls: StatementLine[]) => {
    let n = 0;
    for (let i = 1; i < ls.length; i++) {
      const a = ls[i - 1]!.balance;
      const b = ls[i]!.balance;
      if (a === null || b === null) continue;
      if (Math.abs(a + ls[i]!.credit - ls[i]!.debit - b) > 0.5) n++;
    }
    return n;
  };
  if (lines.length < 2) return { lines, breaks: 0 };
  const first = lines[0]!.date;
  const last = lines[lines.length - 1]!.date;
  const reversed = [...lines].reverse();
  // newest first (dates fall), or the same dates and the reversed order explains the balances better
  if (first > last || (first === last && breaksOf(reversed) < breaksOf(lines)))
    return { lines: reversed, breaks: breaksOf(reversed) };
  return { lines, breaks: breaksOf(lines) };
}

function finish(
  lines: StatementLine[],
  layout: BankStatement['layout'],
  last4: string | null,
  warnings: string[],
): BankStatement {
  let s = settle(lines);
  // a line that shows no amount but moves the balance (a bank printing ₹0.62 of tax as 0.00): its amount is the balance's move
  const blank = (l: StatementLine) => l.debit === 0 && l.credit === 0;
  if (s.lines.some(blank)) {
    let filled = 0;
    const kept: StatementLine[] = [];
    for (const l of s.lines) {
      const prev = kept[kept.length - 1]?.balance;
      if (blank(l)) {
        const move =
          prev !== undefined && prev !== null && l.balance !== null
            ? Math.round((l.balance - prev) * 100) / 100
            : 0;
        if (Math.abs(move) < 0.005) continue;
        kept.push({ ...l, debit: move < 0 ? -move : 0, credit: move > 0 ? move : 0 });
        filled++;
      } else kept.push(l);
    }
    if (filled > 0)
      warnings.push(
        `${filled} line${filled === 1 ? '' : 's'} showed no amount but moved the balance; the amount was taken from the balance.`,
      );
    s = settle(kept);
  }
  const ls = s.lines;
  const first = ls[0];
  const last = ls[ls.length - 1];
  if (ls.length === 0) warnings.push('No transaction lines were found.');
  if (s.breaks > 0)
    warnings.push(
      `${s.breaks} line${s.breaks === 1 ? '' : 's'} where the balance does not follow from the line before: a line may be missing or read wrongly.`,
    );
  if (ls.length > 0 && ls.every((l) => l.balance === null))
    warnings.push(
      'The statement gives no running balance, so the lines cannot be checked against each other.',
    );
  return {
    lines: ls,
    last4,
    from: first?.date ?? null,
    to: last?.date ?? null,
    opening:
      first && first.balance !== null
        ? Math.round((first.balance - first.credit + first.debit) * 100) / 100
        : null,
    closing: last?.balance ?? null,
    layout,
    breaks: s.breaks,
    warnings,
  };
}

/** Reads a statement laid out as a table (Excel, CSV or a web page): the heading row is found, then every line under it. */
export function readStatementGrid(grid: Cell[][]): BankStatement {
  const warnings: string[] = [];
  let at = -1;
  let cols: Columns | null = null;
  for (let i = 0; i < Math.min(grid.length, 80); i++) {
    cols = headingColumns(grid[i] ?? []);
    if (cols) {
      at = i;
      break;
    }
  }
  if (!cols)
    return {
      lines: [],
      last4: null,
      from: null,
      to: null,
      opening: null,
      closing: null,
      layout: 'debit-credit',
      breaks: 0,
      warnings: [
        'No heading row with a date, a narration and the amounts was found: this may not be an account statement.',
      ],
    };
  const c = cols;
  const last4 = accountLast4(grid.slice(0, at).map((r) => r.map(text).join(' ')));
  // the account's opening date, when the heading block prints it beside its label
  let openedOn: string | null = null;
  for (const r of grid.slice(0, at)) {
    const i = r.findIndex((c) => /open(ing)?\s*date/i.test(text(c)));
    if (i < 0) continue;
    const after = r.slice(i + 1).find((c) => text(c) !== '');
    openedOn =
      after !== undefined ? statementDate(typeof after === 'string' ? after.trim() : after) : null;
    if (openedOn) break;
  }
  const lines: StatementLine[] = [];
  let skipped = 0;
  for (const row of grid.slice(at + 1)) {
    const date = statementDate(row[c.date] ?? null);
    const narration = text(row[c.narration] ?? null);
    let debit = 0;
    let credit = 0;
    if (c.amount !== null) {
      const a = statementAmount(row[c.amount] ?? null);
      const dir = c.drcr !== null ? head(row[c.drcr] ?? null) : '';
      if (a !== null) {
        const out = /^d/.test(dir) || (!/^c/.test(dir) && a < 0);
        if (out) debit = Math.abs(a);
        else credit = Math.abs(a);
      }
    } else {
      // a negative withdrawal is money back in (a charge reversed), a negative deposit money out
      const dv = statementAmount(row[c.debit!] ?? null) ?? 0;
      const cv = statementAmount(row[c.credit!] ?? null) ?? 0;
      debit = (dv > 0 ? dv : 0) + (cv < 0 ? -cv : 0);
      credit = (cv > 0 ? cv : 0) + (dv < 0 ? -dv : 0);
    }
    const balance = c.balance !== null ? statementAmount(row[c.balance] ?? null) : null;
    if (!date) {
      // a narration carried on to the next row belongs to the line above; anything else (totals, a footer) is not a line
      if (
        narration &&
        debit === 0 &&
        credit === 0 &&
        lines.length > 0 &&
        !/total|closing|opening|balance|page/i.test(narration)
      ) {
        const prev = lines[lines.length - 1]!;
        prev.narration = `${prev.narration} ${narration}`.trim();
      }
      continue;
    }
    if (/^(opening|closing) balance|^b\/f|^brought forward|^balance forward/i.test(narration))
      continue;
    if (debit === 0 && credit === 0 && balance === null) {
      skipped++;
      continue;
    }
    if (debit > 0 && credit > 0) {
      warnings.push(
        `A line on ${date} has both money out and money in; it was read as the difference.`,
      );
      const net = credit - debit;
      debit = net < 0 ? -net : 0;
      credit = net > 0 ? net : 0;
    }
    lines.push({
      date,
      narration,
      ref: c.ref !== null ? text(row[c.ref] ?? null) || null : null,
      debit: Math.round(debit * 100) / 100,
      credit: Math.round(credit * 100) / 100,
      balance,
    });
  }
  if (skipped > 0)
    warnings.push(`${skipped} dated line${skipped === 1 ? '' : 's'} with no amount left out.`);
  for (const l of lines) l.narration = cleanNarration(l.narration);
  return {
    ...finish(lines, c.amount !== null ? 'amount-drcr' : 'debit-credit', last4, warnings),
    openedOn,
  };
}

const LEAD_DATE = /^(\d{1,2}[/\-. ](?:\d{1,2}|[A-Za-z]{3,4})[/\-. ,]*(?:\d{4}|\d{2}))(?![\d])\s*/;
const MONEY = /[-(]?(?:\d{1,3}(?:,\d{2,3})+|\d+)\.\d{2}\)?(?:\s*(?:Cr|Dr|CR|DR)\.?)?/g;
const HAS_MONEY = new RegExp(MONEY.source);

/**
 * Reads a statement from the lines of text of a PDF. A line that starts with a date and ends with money is a transaction; the last
 * amount on it is the balance. What moved, and which way, is how far the balance moved from the line before; the amount printed on
 * the line must agree with that or the line is reported. The first line's direction comes from an opening balance when the statement
 * prints one, otherwise from a Dr/Cr mark or its wording.
 */
export function readStatementText(textLines: string[]): BankStatement {
  const warnings: string[] = [];
  const last4 = accountLast4(textLines.slice(0, 40));
  let prev: number | null = null;
  for (const l of textLines.slice(0, 80)) {
    if (/opening balance|balance b\/f|brought forward/i.test(l)) {
      const nums = l.match(MONEY);
      if (nums && nums.length > 0) prev = statementAmount(nums[nums.length - 1]!);
      break;
    }
  }
  interface Raw {
    date: string;
    narration: string;
    amounts: number[];
  }
  const raws: Raw[] = [];
  for (const line of textLines) {
    const m = LEAD_DATE.exec(line);
    const date = m ? statementDate(m[1]!) : null;
    if (!date) {
      const last = raws[raws.length - 1];
      if (
        last &&
        line &&
        !HAS_MONEY.test(line) &&
        !/page \d|statement|total|closing|opening|generated|^date\b/i.test(line)
      )
        last.narration = `${last.narration} ${line}`.trim();
      continue;
    }
    let rest = line.slice(m![0].length);
    // a value date straight after the transaction date
    const second = LEAD_DATE.exec(rest);
    if (second && statementDate(second[1]!)) rest = rest.slice(second[0].length);
    const found = [...rest.matchAll(MONEY)];
    const carried = /^(opening|closing) balance|^b\/f|^brought forward/i;
    if (found.length === 0) {
      // a balance brought forward written in whole rupees with its side ("Brought Forward 0 Dr", IndusInd)
      const whole = /(\d[\d,]*)\s*(Cr|Dr)\.?\s*$/i.exec(rest);
      if (whole && carried.test(rest.trim())) prev = statementAmount(`${whole[1]} ${whole[2]}`);
      continue;
    }
    const amounts = found.map((f) => statementAmount(f[0])!).filter((x) => x !== null);
    const narration = rest.slice(0, found[0]!.index).trim();
    if (carried.test(narration)) {
      // the latest balance brought forward wins: a statement may print one at its start and another later (ESAF prints "B/F ...
      // 0.00" for the opening day, then "B/F ON 01-04-25 - MIGRATION" with the balance moved over from its old system). A closing
      // balance sets nothing: some statements print it above the table.
      if (amounts.length > 0 && (prev === null || !/^closing/i.test(narration)))
        prev = amounts[amounts.length - 1]!;
      continue;
    }
    raws.push({ date, narration, amounts });
  }
  // newest first: the dates fall
  if (raws.length > 1 && raws[0]!.date > raws[raws.length - 1]!.date) raws.reverse();
  const lines: StatementLine[] = [];
  let unsure = 0;
  for (const r of raws) {
    const balance = r.amounts[r.amounts.length - 1]!;
    // the amount printed: with separate debit and credit columns the empty one may print 0.00, so the one that is not zero
    const others = r.amounts.slice(0, -1).map(Math.abs);
    const printed = others.length ? (others.filter((x) => x > 0).pop() ?? 0) : null;
    let debit = 0;
    let credit = 0;
    if (prev !== null) {
      const move = Math.round((balance - prev) * 100) / 100;
      if (move < 0) debit = -move;
      else credit = move;
      if (printed !== null && Math.abs(printed - Math.abs(move)) > 0.5) unsure++;
    } else if (printed !== null) {
      const out = /\bdr\b|withdrawal|debit|\bto\b|paid/i.test(r.narration);
      if (out) debit = printed;
      else credit = printed;
      warnings.push(
        `The first line (${r.date}) was read as money ${out ? 'out' : 'in'} from its wording: check it.`,
      );
    }
    prev = balance;
    if (debit === 0 && credit === 0) continue;
    lines.push({
      date: r.date,
      narration: cleanNarration(r.narration),
      ref: null,
      debit,
      credit,
      balance,
    });
  }
  if (unsure > 0)
    warnings.push(
      `${unsure} line${unsure === 1 ? '' : 's'} where the amount printed does not match how far the balance moved: a line may be missing.`,
    );
  return finish(lines, 'balance-moves', last4, warnings);
}

/** One line of CSV into cells, honouring "quoted, cells" and doubled quotes. */
function csvCells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** A CSV (or tab- or semicolon-separated) export as rows of cells. */
export function gridFromCsv(src: string): Cell[][] {
  const lines = src.replace(/^\uFEFF/, '').split(/\r?\n/);
  const sample = lines.slice(0, 40).join('\n');
  const sep = [',', '\t', ';', '|'].sort(
    (a, b) => sample.split(b).length - sample.split(a).length,
  )[0]!;
  return lines.map((l) => csvCells(l, sep));
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};
const unescapeHtml = (s: string) =>
  s
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#\d+|[a-z]+);/gi, (_m, e: string) =>
      e.startsWith('#')
        ? String.fromCharCode(Number(e.slice(1)))
        : (ENTITIES[e.toLowerCase()] ?? ' '),
    );

/** A web page saved as a table (the ".xls" some banks send is one) as rows of cells. */
export function gridFromHtml(src: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const tr of src.match(/<tr[\s\S]*?<\/tr>/gi) ?? []) {
    const cells = [...tr.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
      unescapeHtml(m[1]!).replace(/\s+/g, ' ').trim(),
    );
    rows.push(cells);
  }
  return rows;
}

const cellOf = (v: unknown): Cell => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date || typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object') {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.richText) return o.richText.map((r) => r.text).join('');
    if (o.result !== undefined) return cellOf(o.result);
    if (typeof o.text === 'string') return o.text;
  }
  return null;
};

/** Every tab of an Excel file as rows of cells; the reader then uses the first tab that has a statement heading. */
export async function gridsFromXlsx(bytes: Uint8Array): Promise<Cell[][][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => {
    const rows: Cell[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const cells: Cell[] = [];
      row.eachCell({ includeEmpty: true }, (cell, c) => {
        cells[c - 1] = cellOf(cell.value);
      });
      rows[n - 1] = Array.from(cells, (x) => x ?? null);
    });
    return Array.from(rows, (r) => r ?? []);
  });
}

export type StatementFileKind = 'xlsx' | 'xls-binary' | 'spreadsheetml' | 'html' | 'csv' | 'pdf';

/**
 * An Excel 2003 XML file ("XML Spreadsheet", which several banks send named .xls) as rows of cells. A cell's ss:Index puts it in a
 * later column, leaving the ones it skips empty.
 */
export function gridFromSpreadsheetML(src: string): Cell[][] {
  const rows: Cell[][] = [];
  for (const row of src.match(/<(?:ss:)?Row\b[^>]*?(?:\/>|>[\s\S]*?<\/(?:ss:)?Row>)/g) ?? []) {
    const cells: Cell[] = [];
    let col = 0;
    for (const m of row.matchAll(/<(?:ss:)?Cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:ss:)?Cell>)/g)) {
      const idx = /(?:ss:)?Index="(\d+)"/.exec(m[1] ?? '');
      col = idx ? Number(idx[1]) - 1 : col;
      const data = /<(?:ss:)?Data\b[^>]*>([\s\S]*?)<\/(?:ss:)?Data>/.exec(m[2] ?? '');
      while (cells.length < col) cells.push(null);
      cells[col] = data ? unescapeHtml(data[1]!).replace(/\s+/g, ' ').trim() : null;
      col++;
    }
    rows.push(cells);
  }
  return rows;
}

/** What a file really is, from its first bytes (a bank's ".xls" is often a web page or a CSV). */
export function statementFileKind(bytes: Uint8Array): StatementFileKind {
  const b = bytes;
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'xlsx';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'xls-binary';
  const start = new TextDecoder('latin1').decode(b.slice(0, 4096)).toLowerCase();
  if (start.includes('urn:schemas-microsoft-com:office:spreadsheet')) return 'spreadsheetml';
  if (/<(html|table|tr|\?xml)/.test(start)) return 'html';
  return 'csv';
}

/**
 * Opens any statement file and reads it. A PDF may need its password (the bank's, usually a mix of name and date of birth or the
 * customer ID); it is used once and never kept. An old binary Excel file (.xls from Excel 97–2003) cannot be read here: save it again
 * as .xlsx or CSV.
 */
export async function readBankStatement(
  bytes: Uint8Array,
  password?: string,
): Promise<BankStatement> {
  const kind = statementFileKind(bytes);
  if (kind === 'xls-binary') {
    // an old Excel file (Excel 97–2003): the sheet with the most statement lines
    let best: BankStatement | null = null;
    for (const g of gridsFromXls(bytes)) {
      const st = readStatementGrid(g);
      if (st.lines.length > (best?.lines.length ?? -1)) best = st;
    }
    return best ?? readStatementGrid([]);
  }
  if (kind === 'pdf') {
    const t = await casPdfText(bytes, password);
    return readStatementText(t.split('\n'));
  }
  if (kind === 'xlsx') {
    const grids = await gridsFromXlsx(bytes);
    let best: BankStatement | null = null;
    for (const g of grids) {
      const s = readStatementGrid(g);
      if (s.lines.length > (best?.lines.length ?? -1)) best = s;
    }
    return best ?? readStatementGrid([]);
  }
  const src = new TextDecoder('utf-8').decode(bytes);
  return readStatementGrid(
    kind === 'spreadsheetml'
      ? gridFromSpreadsheetML(src)
      : kind === 'html'
        ? gridFromHtml(src)
        : gridFromCsv(src),
  );
}

/**
 * A download with no running balance that covers the account from the day it was opened (some banks' apps export only date, words
 * and a signed amount): the balance after each line is the sum of every line before it, from nothing. Refused when that sum goes
 * below zero, which shows the download does not start at the opening. The account's first line is the day it was opened, or soon
 * after.
 */
export function fromAccountOpening(
  s: BankStatement,
): BankStatement & { firstLineOn: string | null } {
  if (s.lines.some((l) => l.balance !== null))
    throw new Error('The statement has its own balances; use them.');
  let run = 0;
  const lines = s.lines.map((l) => {
    run = Math.round((run + l.credit - l.debit) * 100) / 100;
    if (run < -0.005)
      throw new Error(
        `The balance would fall below zero on ${l.date}: the download does not start when the account was opened.`,
      );
    return { ...l, balance: run };
  });
  return {
    ...s,
    lines,
    opening: lines.length ? 0 : null,
    closing: lines.length ? run : null,
    breaks: 0,
    warnings: s.warnings.filter((w) => !/no running balance/.test(w)),
    firstLineOn: lines[0]?.date ?? null,
  };
}
