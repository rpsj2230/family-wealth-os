import { describe, expect, it } from 'vitest';
import { depositInterestThisFy, depositsVsBest, termMonths } from '../src/deposit-extras';
import { fdInterestByFy } from '../src/reports';
import type { RateOffer } from '../src/rates';

const dep = {
  id: 'a',
  bank: 'Sample Bank',
  principal: 1_000_000,
  rate: 0.07,
  kind: 'NRE' as const,
  bookedOn: '2026-01-15',
  maturityOn: '2027-01-15',
  maturityAmount: 1_071_859,
  compounding: 'quarterly' as const,
};
const offer = (bank: string, rate: number, from = 12, to = 12): RateOffer =>
  ({
    bank,
    product: 'fd',
    accountKind: 'NRE',
    rate,
    tenureFrom: from,
    tenureTo: to,
    balanceFrom: null,
    balanceTo: null,
    checkedOn: '2026-10-20',
  }) as unknown as RateOffer;

describe('deposit extras', () => {
  it('counts a term in whole months', () => {
    expect(termMonths('2026-01-15', '2027-01-15')).toBe(12);
    expect(termMonths('2026-01-15', '2027-01-14')).toBe(11);
  });

  it('this FY: the whole year equals the Reports row for the same FY, and earned is part of it', () => {
    const r = depositInterestThisFy([dep], '2026-10-30');
    const report = fdInterestByFy(
      [{ ...dep, owner: 'Anil', kind: 'NRE' }] as unknown as Parameters<typeof fdInterestByFy>[0],
      '2026-10-30',
    );
    const row = report.rows.find((x) => x.fy === 'FY 2026-27')!;
    expect(r.fy).toBe('2026-27');
    expect(Math.round(r.total)).toBe(Math.round(Number(row.total)));
    expect(r.earned).toBeGreaterThan(0);
    expect(r.earned).toBeLessThan(r.total);
  });

  it('compares each deposit with the best offer for its own term, after tax', () => {
    const v = depositsVsBest(
      [dep],
      [offer('Other Bank', 0.075), offer('Far Bank', 0.09, 24, 36)],
      0.3,
    );
    expect(v.compared).toBe(1);
    expect(v.below).toBe(1);
    expect(Math.round(v.moreAYear)).toBe(5000);
    expect(v.largestGap?.bank).toBe('Other Bank');
  });

  it('leaves out a deposit with no offer for its term, and counts one at or above the best as fine', () => {
    expect(depositsVsBest([dep], [offer('Far Bank', 0.09, 24, 36)], 0.3).compared).toBe(0);
    const ok = depositsVsBest([dep], [offer('Other Bank', 0.065)], 0.3);
    expect(ok).toMatchObject({ compared: 1, below: 0, moreAYear: 0, largestGap: null });
  });
});
