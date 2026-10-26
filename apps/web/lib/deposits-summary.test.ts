import { describe, expect, it } from 'vitest';
import type { FdLine } from './deposits';
import {
  depositStatusWord,
  groupByMonth,
  needsConfirmation,
  summariseDeposits,
} from './deposits-summary';

const line = (o: Partial<FdLine> & { id: string }): FdLine => ({
  bank: 'Sample Bank',
  bankId: 'b1',
  ownerId: 'p1',
  owner: 'Anil',
  nickname: 'FD',
  kind: 'NRE',
  principal: 1_000_000,
  rate: 0.07,
  bookedOn: '2025-10-26',
  maturityOn: '2027-01-01',
  bankMaturity: null,
  accruedToday: 1_050_000,
  daysLeft: 100,
  status: 'active',
  varianceVsBankPct: null,
  ...o,
});

describe('groupByMonth', () => {
  it('groups running deposits by maturity month and leaves out matured and closed ones', () => {
    const g = groupByMonth([
      line({ id: 'a', maturityOn: '2027-01-15', accruedToday: 100 }),
      line({ id: 'b', maturityOn: '2026-12-02', bankMaturity: 500 }),
      line({ id: 'c', maturityOn: '2026-12-20', accruedToday: 50 }),
      line({ id: 'd', maturityOn: '2026-10-01', daysLeft: -25 }),
      line({ id: 'e', maturityOn: '2027-02-01', status: 'closed' }),
    ]);
    expect(g.map((m) => m.month)).toEqual(['2026-12', '2027-01']);
    expect(g[0]!.items.map((i) => i.id)).toEqual(['b', 'c']);
    expect(g[0]!.total).toBe(550);
  });
});

describe('summariseDeposits', () => {
  const fds = [
    line({ id: 'a', daysLeft: 10, principal: 1_000_000, rate: 0.07, accruedToday: 1_060_000 }),
    line({ id: 'b', daysLeft: 200, principal: 3_000_000, rate: 0.08, accruedToday: 3_100_000 }),
    line({ id: 'c', daysLeft: -5, status: 'matured_unconfirmed', accruedToday: 500_000 }),
    line({ id: 'd', daysLeft: -2, status: 'active', accruedToday: 700_000 }),
    line({ id: 'e', daysLeft: 400, status: 'closed', accruedToday: 0 }),
    line({ id: 'f', daysLeft: 60, bankMaturity: 2_000_000, accruedToday: 1_900_000 }),
  ];
  const s = summariseDeposits(fds, 90);

  it('counts as running only active deposits that have not matured', () => {
    expect(s.running.map((f) => f.id).sort()).toEqual(['a', 'b', 'f']);
    expect(s.runningValue).toBe(1_060_000 + 3_100_000 + 1_900_000);
    expect(s.runningCount).toBe(3);
  });

  it('weights the average rate by the amount in each deposit', () => {
    // 1m at 7%, 3m at 8%, 1m at 7%
    expect(s.averageRate).toBeCloseTo((1 * 0.07 + 3 * 0.08 + 1 * 0.07) / 5, 10);
    expect(summariseDeposits([], 90).averageRate).toBeNull();
  });

  it('lists what matures within the window, soonest first, using the bank figure when known', () => {
    expect(s.soon.map((f) => f.id)).toEqual(['a', 'f']);
    expect(s.soonTotal).toBe(1_060_000 + 2_000_000);
    expect(summariseDeposits(fds, 30).soon.map((f) => f.id)).toEqual(['a']);
    expect(s.next?.id).toBe('a');
  });

  it('asks about deposits past maturity that nobody has confirmed', () => {
    expect(s.confirm.map((f) => f.id).sort()).toEqual(['c', 'd']);
    expect(needsConfirmation(fds[4]!)).toBe(false);
  });

  it('names the state in plain words', () => {
    expect(depositStatusWord(fds[0]!)).toBe('Running');
    expect(depositStatusWord(fds[2]!)).toBe('Matured, to confirm');
    expect(depositStatusWord(fds[3]!)).toBe('Matured, to confirm');
    expect(depositStatusWord(fds[4]!)).toBe('Closed');
  });
});
