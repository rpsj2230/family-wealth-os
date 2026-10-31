import { describe, expect, it } from 'vitest';
import { readPastedRows } from '../src/pasted-rows';

// Rows as a browser copies a net-banking table (tab-separated); every name and amount is invented.
const tsv = (rows: string[][]) => rows.map((r) => r.join('\t')).join('\n');
const moves = (s: ReturnType<typeof readPastedRows>) =>
  s.lines.map((l) => [l.date, l.credit - l.debit, l.balance]);

describe('rows pasted from net banking', () => {
  const rows = [
    [
      '03/09/2026',
      'UPI/SAMPLE FRIEND/samplefriend@okaxis',
      '000011112222',
      '2,500.00',
      '',
      '97,500.00',
    ],
    ['10/09/2026', 'NEFT CR SAMPLE EMPLOYER', 'N123456789', '', '50,000.00', '1,47,500.00'],
    ['15/09/2026', 'ACH D SAMPLE MUTUAL FUND', '000033334444', '10,000.00', '', '1,37,500.00'],
  ];
  const want = [
    ['2026-09-03', -2_500, 97_500],
    ['2026-09-10', 50_000, 147_500],
    ['2026-09-15', -10_000, 137_500],
  ];
  it('without the heading row: the columns are worked out, the reference number is not taken for an amount', () => {
    const s = readPastedRows(tsv(rows));
    expect(moves(s)).toEqual(want);
    expect(s.breaks).toBe(0);
  });
  it('newest first, as most banks show it, reads the same', () => {
    expect(moves(readPastedRows(tsv([...rows].reverse())))).toEqual(want);
  });
  it('money in printed before money out: the balances settle which column is which', () => {
    const swapped = rows.map((r) => [r[0]!, r[1]!, r[2]!, r[4]!, r[3]!, r[5]!]);
    expect(moves(readPastedRows(tsv(swapped)))).toEqual(want);
  });
  it('with the heading row copied too', () => {
    const s = readPastedRows(
      tsv([
        ['Date', 'Narration', 'Chq/Ref No', 'Withdrawal Amt', 'Deposit Amt', 'Closing Balance'],
        ...rows,
      ]),
    );
    expect(moves(s)).toEqual(want);
  });
  it('one amount column marked Dr or Cr', () => {
    const s = readPastedRows(
      tsv([
        ['03-09-2026', 'UPI SAMPLE FRIEND', '2,500.00', 'Dr', '97,500.00'],
        ['10-09-2026', 'NEFT SAMPLE EMPLOYER', '50,000.00', 'Cr', '1,47,500.00'],
      ]),
    );
    expect(moves(s)).toEqual(want.slice(0, 2));
  });
  it('anything else reads as no lines, so nothing is saved', () => {
    expect(readPastedRows('hello\nthis is not a statement').lines).toEqual([]);
  });
});
