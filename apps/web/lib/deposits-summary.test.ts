import { describe, expect, it } from 'vitest';
import type { FdLine } from './deposits';
import {
  depositStatusWord,
  groupByMonth,
  interestAhead,
  maturityWindows,
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

describe('maturityWindows', () => {
  it('counts running deposits inside each window, shortest first, each window including the shorter ones', () => {
    const fds = [
      line({ id: 'a', daysLeft: 5, principal: 100, bankMaturity: 110 }),
      line({ id: 'b', daysLeft: 40, principal: 200, accruedToday: 215 }),
      line({ id: 'c', daysLeft: -3, principal: 999 }),
      line({ id: 'd', daysLeft: 20, principal: 999, status: 'matured' }),
    ];
    expect(maturityWindows(fds, [30, 7, 60, 7])).toEqual([
      { days: 7, count: 1, principal: 100, comesBack: 110 },
      { days: 30, count: 1, principal: 100, comesBack: 110 },
      { days: 60, count: 2, principal: 300, comesBack: 325 },
    ]);
  });
});

describe('interestAhead', () => {
  const today = '2026-10-29';
  it('a deposit running past the period earns its growth over the twelve months, from its terms', () => {
    const r = interestAhead(
      [
        line({
          id: 'a',
          bookedOn: '2025-10-29',
          maturityOn: '2028-10-29',
          principal: 1_000_000,
          rate: 0.07,
        }),
      ],
      today,
    );
    expect(r.until).toBe('2027-10-29');
    expect(r.total).toBeCloseTo(1_000_000 * (1.0175 ** 8 - 1.0175 ** 4), 2);
    expect(r.fromMaturing).toBe(0);
    expect(r.rows[0]!.matures).toBe(false);
  });

  it('a deposit maturing inside the period earns up to the bank’s maturity amount, and nothing after', () => {
    const r = interestAhead(
      [
        line({
          id: 'a',
          bookedOn: '2025-10-29',
          maturityOn: '2027-04-29',
          principal: 1_000_000,
          rate: 0.07,
          bankMaturity: 1_110_000,
        }),
      ],
      today,
    );
    expect(r.total).toBeCloseTo(1_110_000 - 1_000_000 * 1.0175 ** 4, 2);
    expect(r.fromMaturing).toBeCloseTo(r.total, 6);
    // spread over the months it is earned in, up to the maturity month
    expect(r.byMonth[0]!.month).toBe('2026-10');
    expect(r.byMonth[r.byMonth.length - 1]!.month).toBe('2027-04');
    expect(r.byMonth.reduce((s, m) => s + m.amount, 0)).toBeCloseTo(r.total, 6);
  });

  it('leaves out matured, closed and past-date deposits; simple interest follows its terms', () => {
    const r = interestAhead(
      [
        line({ id: 'x', status: 'matured' }),
        line({ id: 'y', daysLeft: -1 }),
        line({
          id: 's',
          bookedOn: '2026-10-29',
          maturityOn: '2030-01-01',
          principal: 100_000,
          rate: 0.073,
          compounding: 'simple',
        }),
      ],
      today,
    );
    expect(r.rows.map((x) => x.id)).toEqual(['s']);
    expect(r.total).toBeCloseTo(7_300, 2);
  });
});
