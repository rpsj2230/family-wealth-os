import { describe, expect, it } from 'vitest';
import { twoWayPeople } from '../src/two-way-people';
import type { Classified } from '../src/statement-classify';

const c = (id: string, cls: Classified['cls']): Classified => ({
  id,
  cls,
  counterpart: null,
  reason: '',
});
const l = (id: string, date: string, amount: number, narration: string, ownerId = 'r') => ({
  id,
  date,
  amount,
  narration,
  ownerId,
});

describe('twoWayPeople', () => {
  const lines = [
    l('a1', '2024-01-10', -300_000, 'NEFT DR-SBIN0001-ATUL KUMAR-NETBANK'),
    l('a2', '2024-06-10', 100_000, 'NEFT CR-ATUL KUMAR-REPAY'),
    l('a3', '2024-09-10', 150_000, 'IMPS ATUL KUMAR'),
    // paid in before ever being paid: not money back
    l('b1', '2023-01-01', 50_000, 'NEFT CR-MEERA RAO'),
    l('b2', '2024-01-01', -60_000, 'NEFT DR-MEERA RAO'),
    // already a loan record
    l('k1', '2024-01-01', -90_000, 'NEFT DR-KRUNAL SHAH'),
    l('k2', '2024-05-01', 90_000, 'NEFT CR-KRUNAL SHAH'),
    // a shop with one word
    l('s1', '2024-01-01', -20_000, 'UPI-AMAZON'),
    l('s2', '2024-02-01', 20_000, 'UPI-AMAZON REFUND'),
  ];
  const cls = [
    c('a1', 'spent'),
    c('a2', 'outside_in'),
    c('a3', 'ask_in'),
    c('b1', 'outside_in'),
    c('b2', 'spent'),
    c('k1', 'spent'),
    c('k2', 'outside_in'),
    c('s1', 'spent'),
    c('s2', 'outside_in'),
  ];
  const r = twoWayPeople(lines, cls, { ownNames: [], borrowers: ['Krunal Shah'], minimum: 25_000 });
  it('lists someone paid and later paying back, with the totals', () => {
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: 'Atul Kumar',
      out: 300_000,
      into: 250_000,
      outLines: 1,
      inLines: 2,
      firstOut: '2024-01-10',
      lastIn: '2024-09-10',
      ownerId: 'r',
    });
  });
});
