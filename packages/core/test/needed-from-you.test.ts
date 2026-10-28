import { describe, expect, it } from 'vitest';
import { neededFromYou, steadyGap } from '../src/needed-from-you';

// Invented: Asha's accounts at two banks.
const acct = (
  id: string,
  extra: Partial<Parameters<typeof neededFromYou>[0]['accounts'][0]> = {},
) => ({
  id,
  owner: 'Asha',
  bank: 'Sample Bank',
  last4: '1111',
  kind: 'NRE',
  openedOn: '2020-01-01',
  ...extra,
});
const base = {
  accounts: [],
  statements: [],
  unbalanced: new Map(),
  recorded: [],
  unplaced: [],
  toAnswer: 0,
  ownershipFrom: '2026-10-28',
};

describe('what is needed from you', () => {
  it('asks for the statements of an account with none, first when transfers from Singapore wait on it', () => {
    const n = neededFromYou({
      ...base,
      accounts: [acct('a'), acct('b', { bank: 'Other Bank' })],
      unplaced: [{ date: '2023-05-01', amount: 500_000, candidates: ['b'] }],
    });
    expect(n.map((x) => x.key)).toEqual(['stmt-none:b', 'stmt-none:a']);
    expect(n[0]!.title).toContain('place 1 transfer from Singapore (₹5.00 L)');
  });

  it('asks for the days between statements whose balances do not join up, and nothing when they do', () => {
    const n = neededFromYou({
      ...base,
      accounts: [acct('a')],
      statements: [
        { assetId: 'a', from: '2020-01-01', to: '2024-12-01', opening: 0, closing: 10_000 },
        { assetId: 'a', from: '2025-01-01', to: '2025-12-31', opening: 14_358, closing: 20_000 },
        { assetId: 'a', from: '2026-01-01', to: '2026-06-30', opening: 20_000, closing: 1 },
      ],
    });
    expect(n).toHaveLength(1);
    expect(n[0]!.title).toContain('2 Dec 2024 to 31 Dec 2024');
    expect(n[0]!.title).toContain('₹4,358');
  });

  it('asks for the answers and the clubbing day when they are missing', () => {
    const n = neededFromYou({ ...base, toAnswer: 3, ownershipFrom: '' });
    expect(n.map((x) => x.key).sort()).toEqual(['answer-lines', 'clubbing-date']);
  });
});

describe('a line missing from a download with no balances', () => {
  const lines = [
    { date: '2020-01-01', amount: 50 },
    { date: '2020-01-10', amount: 100_000 },
    { date: '2020-02-05', amount: 600_000 },
    { date: '2020-04-20', amount: -10_000 },
    { date: '2020-08-01', amount: 2_000 },
  ];
  it('finds the steady gap and the months the line can be in', () => {
    // the real account lost 500,000 in March (not in the download)
    const recorded = [
      { date: '2020-01-31', amount: 100_050 },
      { date: '2020-03-31', amount: 200_050 },
      { date: '2020-05-31', amount: 190_050 },
      { date: '2020-08-31', amount: 192_050 },
      { date: '2020-09-30', amount: 192_050 },
    ];
    expect(steadyGap(lines, recorded)).toEqual({
      from: '2020-02-05',
      to: '2020-03-31',
      amount: -500_000,
    });
  });
  it('finds nothing when the balances agree', () => {
    expect(steadyGap(lines, [{ date: '2020-08-31', amount: 692_050 }])).toBeNull();
  });
  it('allows for balances read a few days off the month’s end', () => {
    const wobbly = [
      { date: '2020-03-31', amount: 200_050 },
      { date: '2020-05-31', amount: 170_050 },
      { date: '2020-08-31', amount: 192_050 },
      { date: '2020-09-30', amount: 230_000 },
      { date: '2020-10-31', amount: 192_050 },
    ];
    expect(steadyGap(lines, wobbly)).toMatchObject({
      from: '2020-02-05',
      to: '2020-03-31',
      amount: -500_000,
    });
  });
});
