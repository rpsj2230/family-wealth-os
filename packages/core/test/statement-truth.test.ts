import { describe, expect, it } from 'vitest';
import {
  bankTruth,
  dayEndBalances,
  disagreements,
  statementCoverage,
  trustBank,
  withBankBalances,
} from '../src/statement-truth';

const L = (date: string, amount: number, balance: number | null, assetId = 'a') => ({
  assetId,
  date,
  amount,
  balance,
});

describe('dayEndBalances', () => {
  it('a day’s end is the balance no other line of the day starts from, whatever their order', () => {
    // 1,000 → +500 → 1,500 → −200 → 1,300, given out of order
    const e = dayEndBalances([L('2025-01-05', -200, 1_300), L('2025-01-05', 500, 1_500)]);
    expect(e.get('a')).toEqual([{ date: '2025-01-05', amount: 1_300 }]);
  });
  it('equal lines that do not decide it: the day before plus the day’s lines', () => {
    const e = dayEndBalances([
      L('2025-01-04', 100, 1_000),
      L('2025-01-05', 50, 1_050),
      L('2025-01-05', -50, 1_000),
      L('2025-01-05', 50, 1_050),
    ]);
    expect(e.get('a')!.at(-1)).toEqual({ date: '2025-01-05', amount: 1_050 });
  });
});

describe('bankTruth and the records it gives', () => {
  const lines = [
    L('2025-01-10', 1_000, 11_000),
    L('2025-01-28', -500, 10_500),
    L('2025-02-15', 2_000, 12_500),
    L('2025-03-03', -100, 12_400),
  ];
  const statements = [
    { assetId: 'a', from: '2025-01-01', to: '2025-01-31', opening: 10_000, closing: 10_500 },
    { assetId: 'a', from: '2025-02-01', to: '2025-03-31', opening: 10_500, closing: 12_400 },
  ];
  const t = bankTruth(lines, statements);
  it('one balance a month (its last day with lines) and each statement’s close; the spans merged', () => {
    expect(t.spans.a).toEqual([{ from: '2025-01-01', to: '2025-03-31' }]);
    expect(t.points.a).toEqual([
      { date: '2025-01-28', amount: 10_500 },
      { date: '2025-01-31', amount: 10_500 },
      { date: '2025-02-15', amount: 12_500 },
      { date: '2025-03-03', amount: 12_400 },
      { date: '2025-03-31', amount: 12_400 },
    ]);
  });
  it('typed balances inside the covered period give way to the bank’s; outside they stay', () => {
    const typed = [
      { date: '2024-12-31', amount: 10_000 },
      { date: '2025-01-31', amount: 10_900 },
      { date: '2025-04-30', amount: 12_450 },
    ];
    const r = withBankBalances(typed, t.points.a, t.spans.a, (p) => ({ ...p }));
    expect(r.map((x) => x.date)).toEqual([
      '2024-12-31',
      '2025-01-28',
      '2025-01-31',
      '2025-02-15',
      '2025-03-03',
      '2025-03-31',
      '2025-04-30',
    ]);
    expect(r.find((x) => x.date === '2025-01-31')!.amount).toBe(10_500);
  });
  it('a typed balance that is not the bank’s is listed', () => {
    const d = disagreements(
      [
        { assetId: 'a', date: '2025-01-31', amount: 10_900 },
        { assetId: 'a', date: '2025-02-28', amount: 12_500 },
      ],
      t,
      1,
    );
    expect(d).toEqual([{ assetId: 'a', date: '2025-01-31', typed: 10_900, bank: 10_500 }]);
  });
});

describe('statementCoverage', () => {
  it('months in full, in part or not at all, the missing ranges and the breaks in the chain', () => {
    const rows = statementCoverage(
      [{ assetId: 'a', from: '2025-01-01', to: '2025-06-30' }],
      [
        { assetId: 'a', from: '2025-01-01', to: '2025-02-28', opening: 0, closing: 100 },
        // opens where the last closed, but at another balance: pages or lines are missing
        { assetId: 'a', from: '2025-03-01', to: '2025-03-20', opening: 150, closing: 200 },
        // after a gap
        { assetId: 'a', from: '2025-05-01', to: '2025-06-30', opening: 300, closing: 400 },
      ],
    );
    const r = rows[0]!;
    expect(r.months.map((m) => m.state)).toEqual(['full', 'full', 'part', 'none', 'full', 'full']);
    expect(r.full).toBe(4);
    expect(r.missing).toEqual([{ from: '2025-03', to: '2025-04' }]);
    expect(r.breaks).toEqual([
      { kind: 'balance', on: '2025-03-01', closed: 100, opened: 150 },
      { kind: 'gap', from: '2025-03-21', to: '2025-04-30' },
    ]);
  });
});

describe('a typed balance is kept unless the bank gives one that month', () => {
  it('outside any statement, or in a covered month with no bank balance, the typed balance stays', () => {
    const typed = [
      { date: '2025-05-31', amount: 50_000 }, // no statement for May
      { date: '2025-06-30', amount: 61_000 }, // a statement covers June, but its lines carry no balance
      { date: '2025-07-31', amount: 70_500 }, // July: the bank's balance is 70,000
    ];
    const spans = [{ from: '2025-06-01', to: '2025-07-31' }];
    const points = [{ date: '2025-07-29', amount: 70_000 }];
    const r = withBankBalances(typed, points, spans, (p) => ({ ...p }));
    expect(r).toEqual([
      { date: '2025-05-31', amount: 50_000 },
      { date: '2025-06-30', amount: 61_000 },
      { date: '2025-07-29', amount: 70_000 },
    ]);
  });
});

describe('trustBank: a statement is its account’s own unless another account clearly fits it better', () => {
  const truth = bankTruth(
    [
      { assetId: 'a', date: '2025-01-31', amount: 0, balance: 100_000 },
      { assetId: 'a', date: '2025-02-28', amount: 0, balance: 101_000 },
      { assetId: 'a', date: '2025-03-31', amount: 0, balance: 102_000 },
      { assetId: 'a', date: '2025-04-30', amount: 0, balance: 103_000 },
    ],
    [{ assetId: 'a', from: '2025-01-01', to: '2025-04-30', opening: null, closing: null }],
  );
  it('typed balances that are stale do not make the bank wrong', () => {
    const t = trustBank(
      truth,
      [
        { assetId: 'a', date: '2025-01-31', amount: 100_000 },
        { assetId: 'a', date: '2025-02-28', amount: 100_000 }, // stale
        { assetId: 'a', date: '2025-03-31', amount: 100_000 }, // stale
        { assetId: 'a', date: '2025-04-30', amount: 100_000 }, // stale
      ],
      () => ['b'],
    );
    expect(t.untrusted).toEqual([]);
    expect(t.points.a).toHaveLength(4);
  });
  it('set aside only when another account at the same bank fits it clearly', () => {
    const t = trustBank(
      truth,
      [
        { assetId: 'a', date: '2025-01-31', amount: 5_000 },
        { assetId: 'a', date: '2025-02-28', amount: 5_000 },
        { assetId: 'b', date: '2025-01-31', amount: 100_000 },
        { assetId: 'b', date: '2025-02-28', amount: 101_000 },
        { assetId: 'b', date: '2025-03-31', amount: 102_000 },
      ],
      () => ['b'],
    );
    expect(t.untrusted).toEqual(['a']);
    expect(t.points.a).toBeUndefined();
  });
});

describe('the balances in the bank’s alert e-mails', () => {
  const truth = bankTruth(
    [],
    [],
    [
      // two alerts on 10 June (the later balance is the day's), one on 20 June
      { assetId: 'a', date: '2025-06-10', amount: -5_000, balance: 95_000 },
      { assetId: 'a', date: '2025-06-10', amount: -2_000, balance: 93_000 },
      { assetId: 'a', date: '2025-06-20', amount: 10_000, balance: 103_000 },
    ],
  );
  it('each day’s last alert balance is the bank’s balance on that day', () => {
    expect(truth.alerts!.a).toEqual([
      { date: '2025-06-10', amount: 93_000 },
      { date: '2025-06-20', amount: 103_000 },
    ]);
    // alerts are not a statement: they cover no period
    expect(truth.spans.a).toBeUndefined();
  });
  it('they are records of their days; a typed balance of the same day gives way, the others stay', () => {
    const typed = [
      { date: '2025-05-31', amount: 100_000 },
      { date: '2025-06-20', amount: 104_000 },
      { date: '2025-06-30', amount: 103_500 },
    ];
    const r = withBankBalances(typed, undefined, undefined, (p) => ({ ...p }), truth.alerts!.a);
    expect(r).toEqual([
      { date: '2025-05-31', amount: 100_000 },
      { date: '2025-06-10', amount: 93_000 },
      { date: '2025-06-20', amount: 103_000 },
      { date: '2025-06-30', amount: 103_500 },
    ]);
  });
  it('an alert on a day a statement covers adds nothing (the statement already has it)', () => {
    const t = bankTruth(
      [{ assetId: 'a', date: '2025-06-10', amount: -2_000, balance: 93_000 }],
      [{ assetId: 'a', from: '2025-06-01', to: '2025-06-30', opening: 95_000, closing: 93_000 }],
      [{ assetId: 'a', date: '2025-06-10', amount: -2_000, balance: 93_000 }],
    );
    expect(t.alerts!.a).toBeUndefined();
  });
});
