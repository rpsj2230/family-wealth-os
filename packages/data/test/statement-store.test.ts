import { describe, expect, it } from 'vitest';
import { readStatementGrid } from '@fwos/ingest';
import { balanceOn, lineKeys, monthBalances } from '../src/statement-store';

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
