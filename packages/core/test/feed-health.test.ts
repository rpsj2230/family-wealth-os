import { describe, expect, it } from 'vitest';
import { feedNeeds, missedMovements, type FeedPoint } from '../src/feed-health';

// Every name and amount is invented.
const line = (
  date: string,
  amount: number,
  balance: number | null,
  fromAlert = true,
): FeedPoint => ({
  date,
  amount,
  balance,
  fromAlert,
});
const bal = (date: string, balance: number): FeedPoint => ({
  date,
  amount: 0,
  balance,
  fromAlert: true,
  balanceOnly: true,
});

describe('movements the balances say are missing', () => {
  it('none when every balance follows from the lines, also through lines with no balance', () => {
    expect(
      missedMovements([
        line('2026-10-01', 0, 10_000),
        line('2026-10-03', -2_500, null),
        line('2026-10-04', 1_000, 8_500),
        bal('2026-10-05', 8_500),
      ]),
    ).toEqual([]);
  });
  it('finds the money that moved with no alert, and the days it can be in', () => {
    expect(
      missedMovements([line('2026-10-01', 0, 10_000), line('2026-10-09', -1_000, 4_000)]),
    ).toEqual([{ from: '2026-10-01', to: '2026-10-09', amount: -5_000 }]);
    expect(missedMovements([bal('2026-10-01', 10_000), bal('2026-10-20', 12_000)])).toEqual([
      { from: '2026-10-01', to: '2026-10-20', amount: 2_000 },
    ]);
  });
  it('a day is judged as a whole: lines of one day in another order still fit', () => {
    expect(
      missedMovements([
        line('2026-10-01', 0, 10_000),
        line('2026-10-02', -500, 9_000),
        line('2026-10-02', -500, 9_500),
      ]),
    ).toEqual([]);
  });
  it('a break between two uploaded statement lines is left to the statement reader', () => {
    expect(
      missedMovements([
        line('2026-10-01', 0, 10_000, false),
        line('2026-10-09', -1_000, 4_000, false),
      ]),
    ).toEqual([]);
  });
});

describe('what the feed needs from you', () => {
  const acct = {
    id: 'a1',
    owner: 'Sample',
    bank: 'Sample Bank',
    last4: '1234',
    kind: 'NRE',
    openedOn: null,
  };
  const base = {
    today: '2026-10-30',
    silentDays: 100,
    gapDays: 120,
    accounts: [acct],
    lastHeard: new Map<string, string>(),
    points: new Map<string, FeedPoint[]>(),
    locked: [],
  };
  it('a silent account, once, with the one-time fix', () => {
    const n = feedNeeds({ ...base, lastHeard: new Map([['a1', '2026-06-01']]) });
    expect(n).toHaveLength(1);
    expect(n[0]!.key).toBe('feed-silent:a1');
    expect(n[0]!.title).toMatch(/e-statement/);
    expect(feedNeeds({ ...base, lastHeard: new Map([['a1', '2026-10-01']]) })).toEqual([]);
  });
  it('a missed movement in the last days only', () => {
    const points = new Map([
      ['a1', [line('2026-01-01', 0, 10_000), line('2026-01-09', -1_000, 4_000)]],
    ]);
    expect(feedNeeds({ ...base, points })).toEqual([]);
    const recent = new Map([
      ['a1', [line('2026-10-01', 0, 10_000), line('2026-10-09', -1_000, 4_000)]],
    ]);
    expect(feedNeeds({ ...base, points: recent })[0]!.key).toBe('feed-gap:a1:2026-10-09');
  });
  it('a locked statement asks for the password once per bank', () => {
    const n = feedNeeds({
      ...base,
      locked: [
        { sender: 'samplebank.in', date: '2026-10-02', why: 'password' },
        { sender: 'samplebank.in', date: '2026-09-02', why: 'password' },
        { sender: 'samplebank.in', date: '2026-10-02', why: 'account', last4: '9999' },
      ],
    });
    expect(n.map((x) => x.key)).toEqual([
      'feed-locked:samplebank.in',
      'feed-noacct:samplebank.in:9999',
    ]);
  });
});
