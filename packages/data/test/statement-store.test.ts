import { describe, expect, it } from 'vitest';
import { readStatementGrid } from '@fwos/ingest';
import { balanceLessTwins, balanceOn, lineKeys, monthBalances } from '../src/statement-store';

// Invented figures.
const s = readStatementGrid([
  ['Date', 'Narration', 'Withdrawal', 'Deposit', 'Balance'],
  ['30/03/2024', 'NEFT CR', '', '10,000.00', '1,10,000.00'],
  ['02/04/2024', 'UPI', '500.00', '', '1,09,500.00'],
  ['02/04/2024', 'UPI', '500.00', '', '1,09,000.00'],
  ['15/05/2024', 'INT.PD', '', '1,000.00', '1,10,000.00'],
]);

describe('saving a statement', () => {
  it('gives two identical lines on one day different keys, and the same keys when read again', () => {
    const k = lineKeys(s.lines);
    expect(new Set(k).size).toBe(4);
    expect(lineKeys(s.lines)).toEqual(k);
    expect(k[0]).toBe('2024-03-30|1000000|11000000|0');
  });

  it('proves the balance before the first line and at each month end it covers', () => {
    expect(monthBalances(s)).toEqual([
      { date: '2024-03-29', amount: 100000 },
      { date: '2024-03-31', amount: 110000 },
      { date: '2024-04-30', amount: 109000 },
      { date: '2024-05-15', amount: 110000 },
    ]);
  });

  it('knows the balance at the end of any day it covers', () => {
    expect(balanceOn(s, '2024-03-29')).toBe(100000);
    expect(balanceOn(s, '2024-04-02')).toBe(109000);
    expect(balanceOn(s, '2024-05-01')).toBe(109000);
    expect(balanceOn(s, '2024-05-16')).toBeNull();
    expect(balanceOn(s, '2024-03-01')).toBeNull();
  });
});

describe('the order of one day’s lines', () => {
  it('follows the running balance, so a credit and the debit after it read the right way round', async () => {
    const { chainOrder } = await import('../src/trail-store');
    const rows = [
      { id: 'b', date: '2026-10-28', amount: -557_006, balance: 0.53 },
      { id: 'a', date: '2026-10-28', amount: 556_750, balance: 557_006.53 },
      { id: 'z', date: '2026-10-01', amount: 254, balance: 256.53 },
    ];
    expect(chainOrder(rows).map((r) => r.id)).toEqual(['z', 'a', 'b']);
    // with no earlier day, the day's first line is the one no other line leads to
    expect(chainOrder(rows.slice(0, 2)).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('lines saved once without balances and again with them', () => {
  const l = (id: string, txn_on: string, amount: number, narration: string) => ({
    id,
    txn_on,
    amount,
    narration,
  });
  it('pairs each line with its copy: same day and amount, the same words first, each used once', () => {
    const bare = [
      l('b1', '2020-07-10', -100000, 'Fd …1907 Booked'),
      l('b2', '2020-07-10', -100000, 'Fd …1963 Booked'),
      l('b3', '2020-07-10', 50000, 'Sample Person'),
      l('b4', '2020-07-26', -6000, 'Sample Person'),
    ];
    const full = [
      l('f1', '2020-07-10', -100000, 'Fd …1963 Booked'),
      l('f2', '2020-07-10', -100000, 'FD BOOKING …1907'),
      l('f3', '2020-07-10', 50000, 'Sample Person'),
    ];
    const pairs = balanceLessTwins(bare, full).map(([b, f]) => [b.id, f.id]);
    // the …1963 lines pair by their words; …1907 is worded differently in the other file and pairs by day and amount
    expect(pairs).toEqual([
      ['b2', 'f1'],
      ['b1', 'f2'],
      ['b3', 'f3'],
    ]);
  });
  it('leaves a line with no copy alone', () => {
    expect(
      balanceLessTwins([l('b', '2020-07-10', -10, 'x')], [l('f', '2020-07-11', -10, 'x')]),
    ).toEqual([]);
  });
});
