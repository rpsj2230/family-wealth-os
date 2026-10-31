/**
 * Rows copied from a bank's net banking page and pasted in (Explain movements > Bank statements > Paste rows): read with the same
 * reader as a downloaded statement. A copy of the table with its heading row reads as it is. A copy of the rows alone (the usual
 * case) has its columns worked out: the date is the column that holds dates, the narration the one with the longest words, the
 * balance the right-most amount column filled on every row, and the amount column(s) the rest. Which of two amount columns is the
 * money out is settled by the balances: the order whose lines join up from one balance to the next is taken. Pure.
 */
import {
  gridFromCsv,
  headingColumns,
  readStatementGrid,
  statementAmount,
  statementDate,
  type BankStatement,
  type Cell,
} from './bank-statement';

const filled = (c: Cell | undefined) => c !== null && c !== undefined && String(c).trim() !== '';

export function readPastedRows(text: string): BankStatement {
  const grid = gridFromCsv(text.trim()).filter((r) => r.some(filled));
  // the heading row was copied too: the reader finds the columns itself
  if (grid.slice(0, 10).some((r) => headingColumns(r))) return readStatementGrid(grid);
  const width = Math.max(0, ...grid.map((r) => r.length));
  const rows = grid.filter((r) => r.some((c) => statementDate(c ?? null)));
  const share = (i: number, test: (c: Cell) => boolean) =>
    rows.length ? rows.filter((r) => test(r[i] ?? null)).length / rows.length : 0;
  const cols = [...Array(width).keys()];
  const date = cols
    .map((i) => ({ i, s: share(i, (c) => !!statementDate(c)) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)[0];
  // an amount column: every filled cell is an amount written as money (decimals or grouping), not a cheque or reference number
  const money = (c: Cell) => {
    if (!filled(c)) return true;
    const s = String(c).trim();
    return statementAmount(c) !== null && (/[.,]\d/.test(s) || /\b(cr|dr)\.?$/i.test(s));
  };
  const amountCols = cols.filter(
    (i) => i !== date?.i && share(i, money) === 1 && share(i, filled) > 0,
  );
  const balance = [...amountCols].reverse().find((i) => share(i, filled) >= 0.9);
  const moves = amountCols.filter((i) => i !== balance);
  const words = cols
    .filter((i) => i !== date?.i && !amountCols.includes(i))
    .map((i) => ({
      i,
      len: rows.reduce((n, r) => n + String(r[i] ?? '').length, 0),
    }))
    .sort((a, b) => b.len - a.len)[0];
  const drcr = cols.find(
    (i) =>
      !amountCols.includes(i) &&
      i !== words?.i &&
      share(i, (c) => /^(dr|cr)\.?$/i.test(String(c ?? '').trim())) >= 0.9,
  );
  if (!date || date.s < 0.8 || !words || moves.length === 0 || moves.length > 2)
    return readStatementGrid([]);
  const named = (names: Record<number, string>) => [
    cols.map((i) => names[i] ?? `column ${i + 1}`),
    ...rows,
  ];
  const base: Record<number, string> = {
    [date.i]: 'Date',
    [words.i]: 'Narration',
    ...(balance !== undefined ? { [balance]: 'Balance' } : {}),
  };
  if (moves.length === 1)
    return readStatementGrid(
      named({ ...base, [moves[0]!]: 'Amount', ...(drcr !== undefined ? { [drcr]: 'Dr/Cr' } : {}) }),
    );
  // two amount columns: money out first (as most banks print it) unless the other order joins the balances up better
  const [a, b] = moves as [number, number];
  const outFirst = readStatementGrid(named({ ...base, [a]: 'Withdrawal', [b]: 'Deposit' }));
  const inFirst = readStatementGrid(named({ ...base, [a]: 'Deposit', [b]: 'Withdrawal' }));
  return inFirst.breaks < outFirst.breaks ? inFirst : outFirst;
}
