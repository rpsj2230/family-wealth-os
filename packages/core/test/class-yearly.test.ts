import { describe, expect, it } from 'vitest';
import {
  cashYearly,
  depositsXirr,
  earningRateNow,
  maturingWithin,
  savingsRateEarned,
} from '../src/class-yearly';

describe('depositsXirr', () => {
  it('one deposit a year old that grew 7% returns 7% a year', () => {
    const r = depositsXirr(
      [{ principal: 100_000, bookedOn: '2025-10-29', value: 107_000 }],
      '2026-10-29',
    )!;
    expect(r.rate).toBeCloseTo(0.07, 4);
    expect(r).toMatchObject({ kind: 'xirr', estimated: true });
  });
  it('weights each deposit by its money and its time', () => {
    const r = depositsXirr(
      [
        { principal: 100_000, bookedOn: '2025-10-29', value: 107_000 },
        { principal: 100_000, bookedOn: '2026-04-29', value: 103_441 },
      ],
      '2026-10-29',
    )!;
    expect(r.rate).toBeGreaterThan(0.068);
    expect(r.rate).toBeLessThan(0.072);
  });
  it('nothing running, or booked today: no rate rather than zero', () => {
    expect(depositsXirr([], '2026-10-29')).toBeNull();
    expect(
      depositsXirr([{ principal: 1, bookedOn: '2026-10-29', value: 1 }], '2026-10-29'),
    ).toBeNull();
  });
});

describe('cashYearly', () => {
  it('a day of interest over a year on the balance', () => {
    expect(cashYearly(365_000, 30)!.rate).toBeCloseTo(0.03, 6);
    expect(cashYearly(0, 10)).toBeNull();
  });
});

describe('savings rate earned, earning rate now and maturing deposits', () => {
  it('turns the interest earned since 1 April into a yearly rate on today’s balance', () => {
    // 1 Apr to 1 Oct is 183 days: ₹5,000 on ₹2,00,000 is 2.5% for the half year, about 4.99% a year
    const r = savingsRateEarned(5_000, 200_000, '2026-04-01', '2026-10-01')!;
    expect(r.kind).toBe('rate');
    expect(r.rate).toBeCloseTo((5_000 / 200_000) * (365 / 183), 10);
    expect(savingsRateEarned(5_000, 200_000, '2026-04-01', '2026-04-01')).toBeNull();
    expect(savingsRateEarned(5_000, 0, '2026-04-01', '2026-10-01')).toBeNull();
  });

  it('weights each part’s rate by its value, with money lent at 0%', () => {
    const r = earningRateNow([
      { key: 'fd', value: 600, rate: 0.08 },
      { key: 'funds', value: 200, rate: 0.12 },
      { key: 'cash', value: 150, rate: 0.04 },
      { key: 'others', value: 50, rate: 0 },
    ])!;
    // (48 + 24 + 6 + 0) / 1000
    expect(r.rate).toBeCloseTo(0.078, 10);
    expect(r.perYear).toBeCloseTo(78, 10);
    expect(r.total).toBe(1000);
  });

  it('gives no earning rate when a part holding money has none, and ignores empty parts', () => {
    expect(
      earningRateNow([
        { key: 'fd', value: 600, rate: 0.08 },
        { key: 'funds', value: 200, rate: null },
      ]),
    ).toBeNull();
    expect(
      earningRateNow([
        { key: 'fd', value: 600, rate: 0.08 },
        { key: 'funds', value: 0, rate: null },
      ])!.rate,
    ).toBeCloseTo(0.08, 10);
    expect(earningRateNow([])).toBeNull();
  });

  it('counts deposits maturing after today up to the window’s last day', () => {
    const deps = [
      { principal: 100, maturityOn: '2026-10-30', maturityAmount: 110 }, // today: already out
      { principal: 200, maturityOn: '2026-11-29', maturityAmount: 220 }, // day 30
      { principal: 300, maturityOn: '2026-11-30', maturityAmount: null }, // day 31
      { principal: 400, maturityOn: null, maturityAmount: null },
    ];
    expect(maturingWithin(deps, '2026-10-30', 30)).toEqual({
      count: 1,
      principal: 200,
      maturity: 220,
    });
    expect(maturingWithin(deps, '2026-10-30', 90)).toEqual({
      count: 2,
      principal: 500,
      maturity: 520,
    });
  });
});
