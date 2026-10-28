import { describe, expect, it } from 'vitest';
import type { RateOffer } from '../src/rates';
import { savingsOn } from '../src/savings-accrual';
import { listedSlabs, savingsSchedule } from '../src/savings-rates';

const offer = (o: Partial<RateOffer>): RateOffer => ({
  id: Math.random().toString(36),
  bank: 'IDFC First Bank',
  product: 'savings',
  accountKind: 'any',
  tenureFrom: 0,
  tenureTo: 0,
  rate: 0.03,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: '2026-10-01',
  ...o,
});

const offers = [
  offer({ balanceFrom: 0, balanceTo: 500_000, rate: 0.03 }),
  offer({ balanceFrom: 500_000, balanceTo: 2_500_000, rate: 0.035 }),
  offer({ balanceFrom: 2_500_000, balanceTo: null, rate: 0.04 }),
  offer({ balanceFrom: 0, balanceTo: 500_000, rate: 0.032, accountKind: 'NRE' }),
  offer({ bank: 'HDFC Bank', rate: 0.025 }),
];

describe('listedSlabs', () => {
  it('takes the bank’s slabs for the kind, an exact kind winning over any kind', () => {
    expect(listedSlabs(offers, 'IDFC First', 'NRE')).toEqual([
      { from: 0, upTo: 500_000, rate: 0.032 },
      { from: 500_000, upTo: 2_500_000, rate: 0.035 },
      { from: 2_500_000, upTo: null, rate: 0.04 },
    ]);
    expect(listedSlabs(offers, 'IDFC First', 'NRO')[0]!.rate).toBe(0.03);
    expect(listedSlabs(offers, 'Axis', null)).toEqual([]);
  });
});

describe('savingsSchedule', () => {
  const base = {
    offers,
    bank: 'IDFC First Bank',
    kind: 'NRO' as const,
    method: 'incremental' as const,
    assumed: 0.027,
  };

  it('uses the account’s own rate, with each change from its effective date', () => {
    const s = savingsSchedule({
      ...base,
      own: 0.04,
      ownHistory: [{ effectiveOn: '2026-07-06', oldRate: 0.0365, newRate: 0.04 }],
    });
    expect(s.map((x) => [x.from, x.slabs[0]!.rate, x.source])).toEqual([
      ['0000-01-01', 0.0365, 'account'],
      ['2026-07-06', 0.04, 'account'],
    ]);
  });

  it('uses the bank’s slabs with the method of the bank, and the old rate before a recorded change', () => {
    const s = savingsSchedule({
      ...base,
      own: null,
      events: [
        {
          at: '2026-09-15T10:00:00Z',
          bank: 'IDFC First Bank',
          accountKind: 'any',
          balanceFrom: 0,
          balanceTo: 500_000,
          kind: 'changed',
          oldRate: 0.035,
          newRate: 0.03,
        },
        // a correction is not a change of the bank's rate
        {
          at: '2026-09-20T10:00:00Z',
          bank: 'IDFC First Bank',
          accountKind: 'any',
          balanceFrom: 500_000,
          balanceTo: 2_500_000,
          kind: 'corrected',
          oldRate: 0.05,
          newRate: 0.035,
        },
      ],
    });
    expect(s).toHaveLength(2);
    expect(s[0]!).toMatchObject({
      from: '0000-01-01',
      method: 'incremental',
      source: 'rates_list',
    });
    expect(s[0]!.slabs.map((x) => x.rate)).toEqual([0.035, 0.035, 0.04]);
    expect(s[1]!.from).toBe('2026-09-15');
    expect(s[1]!.slabs.map((x) => x.rate)).toEqual([0.03, 0.035, 0.04]);
  });

  it('falls back to the assumed rate when nothing is on file', () => {
    expect(savingsSchedule({ ...base, bank: 'Axis', own: null })).toEqual([
      {
        from: '0000-01-01',
        slabs: [{ upTo: null, rate: 0.027 }],
        method: 'whole',
        source: 'assumed',
      },
    ]);
  });

  it('feeds the estimate: a balance of 10 lakh earns each slab’s rate on its part', () => {
    const s = savingsSchedule({ ...base, own: null });
    const v = savingsOn(
      { date: '2026-07-01', amount: 1_000_000 },
      [],
      { schedule: s, tds: 0, credit: 'yearly' },
      '2026-07-11',
    );
    // 5 L at 3% and 5 L at 3.5% for 10 days
    expect(v.interest).toBeCloseTo(((500_000 * 0.03 + 500_000 * 0.035) * 10) / 365, 6);
  });
});
