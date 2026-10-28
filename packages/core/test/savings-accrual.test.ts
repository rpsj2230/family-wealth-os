import { describe, expect, it } from 'vitest';
import {
  isCreditDay,
  reconcileBalance,
  savingsInterestBetween,
  savingsOn,
  stepOn,
  yearlyRateOn,
  type RateStep,
  type SavingsTerms,
} from '../src/savings-accrual';

const flat = (rate: number, from = '2000-01-01'): RateStep => ({
  from,
  slabs: [{ upTo: null, rate }],
  method: 'whole',
  source: 'account',
});
const terms = (
  schedule: RateStep[],
  tds = 0,
  credit: SavingsTerms['credit'] = 'quarterly',
): SavingsTerms => ({
  schedule,
  tds,
  credit,
});

describe('yearlyRateOn: slab rates', () => {
  const slabs = [
    { upTo: 500_000, rate: 0.03 },
    { upTo: 2_500_000, rate: 0.035 },
    { upTo: null, rate: 0.04 },
  ];
  it('whole balance: the slab the balance falls in', () => {
    expect(yearlyRateOn(400_000, { slabs, method: 'whole' })).toBe(0.03);
    expect(yearlyRateOn(1_000_000, { slabs, method: 'whole' })).toBe(0.035);
    expect(yearlyRateOn(3_000_000, { slabs, method: 'whole' })).toBe(0.04);
  });
  it('incremental: each part at its own slab', () => {
    // 5L at 3% + 5L at 3.5% on 10L = 3.25%
    expect(yearlyRateOn(1_000_000, { slabs, method: 'incremental' })).toBeCloseTo(0.0325, 10);
    // 5L at 3% + 20L at 3.5% + 5L at 4% on 30L
    expect(yearlyRateOn(3_000_000, { slabs, method: 'incremental' })).toBeCloseTo(
      (15_000 + 70_000 + 20_000) / 3_000_000,
      10,
    );
  });
  it('a balance above the last capped slab earns the last rate', () => {
    expect(
      yearlyRateOn(800_000, { slabs: [{ upTo: 500_000, rate: 0.03 }], method: 'incremental' }),
    ).toBeCloseTo(0.03, 10);
  });
});

describe('savingsOn (acceptance test 1: savings interest)', () => {
  it('estimates the current balance from the last balance, its date and the rate', () => {
    // 1,00,000 on 1 Jul at 3.65% a year, no tax: 100 days of 10 rupees a day, credited quarterly on 30 Sep
    const s = savingsOn(
      { date: '2026-07-01', amount: 100_000 },
      [],
      terms([flat(0.0365)]),
      '2026-07-11',
    );
    expect(s.days).toBe(10);
    expect(s.interest).toBeCloseTo(100, 6);
    expect(s.value).toBeCloseTo(100_100, 6);
    expect(s.accrued).toBeCloseTo(100, 6);
    expect(s.credited).toBe(0);
  });

  it('the value on the baseline day is the baseline itself', () => {
    expect(
      savingsOn({ date: '2026-07-01', amount: 100_000 }, [], terms([flat(0.05)]), '2026-07-01')
        .value,
    ).toBe(100_000);
  });

  it('credits interest at the quarter end and earns on it after', () => {
    const s = savingsOn(
      { date: '2026-09-29', amount: 100_000 },
      [],
      terms([flat(0.0365)]),
      '2026-10-02',
    );
    // nights of 29 and 30 Sep (credited at 30 Sep end), then 1 Oct on 100,020
    expect(s.credited).toBeCloseTo(20, 6);
    expect(s.accrued).toBeCloseTo((100_020 * 0.0365) / 365, 6);
  });

  it('includes confirmed money in and out, earning from the day after', () => {
    const s = savingsOn(
      { date: '2026-07-01', amount: 100_000 },
      [{ date: '2026-07-05', amount: 50_000 }],
      terms([flat(0.0365)]),
      '2026-07-11',
    );
    expect(s.moved).toBe(50_000);
    // 4 nights on 1L (1..4 Jul), 6 nights on 1.5L (5..10 Jul)
    expect(s.interest).toBeCloseTo(40 + 90, 6);
    expect(s.value).toBeCloseTo(150_130, 6);
  });

  it('applies a rate change only from its effective date', () => {
    const sched = [flat(0.0365, '2000-01-01'), flat(0.073, '2026-07-06')];
    const s = savingsOn({ date: '2026-07-01', amount: 100_000 }, [], terms(sched), '2026-07-11');
    expect(s.interest).toBeCloseTo(5 * 10 + 5 * 20, 6);
  });

  it('takes tax at source off the interest', () => {
    const s = savingsOn(
      { date: '2026-07-01', amount: 100_000 },
      [],
      terms([flat(0.0365)], 0.3),
      '2026-07-11',
    );
    expect(s.interest).toBeCloseTo(70, 6);
  });

  it('a new actual balance is the new baseline: interest restarts from it', () => {
    const t = terms([flat(0.0365)]);
    const before = savingsOn({ date: '2026-07-01', amount: 100_000 }, [], t, '2026-07-11');
    const after = savingsOn({ date: '2026-07-11', amount: 120_000 }, [], t, '2026-07-11');
    expect(before.value).toBeCloseTo(100_100, 6);
    expect(after.value).toBe(120_000);
    expect(
      savingsOn({ date: '2026-07-11', amount: 120_000 }, [], t, '2026-07-21').interest,
    ).toBeCloseTo(120, 6);
  });

  it('interest between two days adds up to the whole', () => {
    const t = terms([flat(0.0365)]);
    const b = { date: '2026-07-01', amount: 100_000 };
    expect(
      savingsInterestBetween(b, [], t, '2026-07-01', '2026-07-06') +
        savingsInterestBetween(b, [], t, '2026-07-06', '2026-07-11'),
    ).toBeCloseTo(savingsOn(b, [], t, '2026-07-11').interest, 8);
  });
});

describe('stepOn and isCreditDay', () => {
  it('uses the earliest known rate before it starts', () => {
    expect(stepOn([flat(0.03, '2026-05-01')], '2026-01-01')?.slabs[0]?.rate).toBe(0.03);
  });
  it('knows the quarter ends', () => {
    expect(isCreditDay('2026-06-30', 'quarterly')).toBe(true);
    expect(isCreditDay('2026-07-31', 'quarterly')).toBe(false);
    expect(isCreditDay('2026-07-31', 'monthly')).toBe(true);
    expect(isCreditDay('2026-03-31', 'yearly')).toBe(true);
  });
});

describe('reconcileBalance: unexplained changes are never profit', () => {
  const t = terms([flat(0.0365)]);
  it('a balance that matches the estimate is explained', () => {
    const r = reconcileBalance({
      baseline: { date: '2026-07-01', amount: 100_000 },
      actual: { date: '2026-07-11', amount: 100_100 },
      txns: [],
      terms: t,
      tolerance: 50,
    });
    expect(r.explained).toBe(true);
    expect(r.difference).toBeCloseTo(0, 6);
  });
  it('a jump is an unexplained adjustment, with the matching maturity proceeds offered first', () => {
    const r = reconcileBalance({
      baseline: { date: '2026-07-01', amount: 100_000 },
      actual: { date: '2026-07-11', amount: 1_170_100 },
      txns: [],
      terms: t,
      tolerance: 50,
      candidates: [
        { kind: 'fd_proceeds', amount: 1_070_000, assetId: 'fd1', label: 'FD 1 matured' },
      ],
    });
    expect(r.explained).toBe(false);
    expect(r.difference).toBeCloseTo(1_070_000, 6);
    expect(r.suggestions[0]).toMatchObject({ kind: 'fd_proceeds', assetId: 'fd1' });
    expect(r.suggestions[1]?.kind).toBe('outside_money_in');
  });
  it('a fall is offered as money taken out', () => {
    const r = reconcileBalance({
      baseline: { date: '2026-07-01', amount: 100_000 },
      actual: { date: '2026-07-11', amount: 60_000 },
      txns: [],
      terms: t,
      tolerance: 50,
    });
    expect(r.suggestions).toEqual([expect.objectContaining({ kind: 'money_out' })]);
  });
  it('confirmed movements are part of the expectation', () => {
    const r = reconcileBalance({
      baseline: { date: '2026-07-01', amount: 100_000 },
      actual: { date: '2026-07-11', amount: 150_130 },
      txns: [{ date: '2026-07-05', amount: 50_000 }],
      terms: t,
      tolerance: 50,
    });
    expect(r.explained).toBe(true);
  });
});
