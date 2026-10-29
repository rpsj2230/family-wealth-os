import { describe, expect, it } from 'vitest';
import { cashYearly, depositsXirr } from '../src/class-yearly';

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
