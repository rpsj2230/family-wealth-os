import { describe, expect, it } from 'vitest';
import {
  fdInterestForFy,
  fyBounds,
  interestCsv,
  interestRefunds,
  interestSchedule,
  type FdForFiling,
} from '../src/tax-filing';

const fd = (o: Partial<FdForFiling> & { id: string }): FdForFiling => ({
  ownerId: 'r',
  bank: 'Bank',
  nickname: o.id,
  kind: 'NRO',
  principal: 1_000_000,
  rate: 0.08,
  bookedOn: '2025-04-01',
  maturityOn: '2028-04-01',
  compounding: 'quarterly',
  ...o,
});

describe('fyBounds', () => {
  it('returns 1 April to 31 March', () => {
    expect(fyBounds('2026-27')).toEqual({ start: '2026-04-01', end: '2027-03-31' });
    expect(() => fyBounds('2026-28')).toThrow();
    expect(() => fyBounds('26-27')).toThrow();
  });
});

describe('fdInterestForFy', () => {
  it('a full year of 8% quarterly on ₹10 L is ₹82,432', () => {
    const l = fdInterestForFy(fd({ id: 'a', bookedOn: '2025-04-01' }), '2025-26')!;
    expect(l.interest).toBeCloseTo(1_000_000 * (Math.pow(1.02, 4) - 1), -2); // about 82,432 (to the day-count of the year)
    expect(l.taxable).toBe('yes');
  });
  it('splits interest across financial years so the parts add up to the total', () => {
    const a = fd({ id: 'a', bookedOn: '2025-04-01', maturityOn: '2027-04-01' });
    const total = fdInterestForFy(a, '2025-26')!.interest + fdInterestForFy(a, '2026-27')!.interest;
    const whole = 1_000_000 * (Math.pow(1.02, 8) - 1);
    expect(total).toBeCloseTo(whole, -2);
  });
  it('is null for years before booking or after maturity', () => {
    const a = fd({ id: 'a', bookedOn: '2026-05-01', maturityOn: '2027-05-01' });
    expect(fdInterestForFy(a, '2025-26')).toBeNull();
    expect(fdInterestForFy(a, '2028-29')).toBeNull();
  });
  it('stops at maturity inside the year', () => {
    const a = fd({ id: 'a', bookedOn: '2025-04-01', maturityOn: '2026-09-30' });
    const l = fdInterestForFy(a, '2026-27')!;
    expect(l.to).toBe('2026-09-30');
    expect(l.interest).toBeGreaterThan(0);
  });
  it('classifies NRE as exempt and joint/unknown as needing a check', () => {
    expect(fdInterestForFy(fd({ id: 'n', kind: 'NRE' }), '2025-26')!.taxable).toBe('exempt_nre');
    expect(fdInterestForFy(fd({ id: 'j', kind: 'joint' }), '2025-26')!.taxable).toBe(
      'check_joint_or_unknown',
    );
    expect(fdInterestForFy(fd({ id: 'u', kind: 'unknown' }), '2025-26')!.taxable).toBe(
      'check_joint_or_unknown',
    );
  });
});

describe('interestSchedule', () => {
  const fds = [
    fd({ id: 'a', ownerId: 'r' }),
    fd({ id: 'b', ownerId: 'r', kind: 'NRE' }),
    fd({ id: 'c', ownerId: 'g', principal: 500_000 }),
  ];
  it('keeps taxpayers separate and totals taxable vs exempt interest', () => {
    const s = interestSchedule(fds, '2025-26', '2026-10-26', null);
    expect(Object.keys(s.byOwner).sort()).toEqual(['g', 'r']);
    expect(s.byOwner.r!.taxableInterest).toBeGreaterThan(80_000);
    expect(s.byOwner.r!.exemptNreInterest).toBeGreaterThan(80_000);
    expect(s.byOwner.g!.taxableInterest).toBeCloseTo(s.byOwner.r!.taxableInterest / 2, 0);
    expect(s.partialYear).toBe(false);
  });
  it('estimates tax at source only with a rate you supply', () => {
    expect(interestSchedule(fds, '2025-26', '2026-10-26', null).byOwner.r!.tdsEstimate).toBe(0);
    const s = interestSchedule(fds, '2025-26', '2026-10-26', 0.3);
    expect(s.byOwner.r!.tdsEstimate).toBeCloseTo(s.byOwner.r!.taxableInterest * 0.3, 6);
  });
  it('for a year in progress counts only up to today and says so', () => {
    const part = interestSchedule(fds, '2026-27', '2026-10-26', null);
    const full = interestSchedule(fds, '2026-27', '2027-04-30', null);
    expect(part.partialYear).toBe(true);
    expect(part.byOwner.r!.taxableInterest).toBeLessThan(full.byOwner.r!.taxableInterest);
  });
});

describe('interestCsv', () => {
  it('writes a header, one row per deposit, and escapes commas and quotes', () => {
    const s = interestSchedule(
      [fd({ id: 'a', bank: 'Bank, "X"', nickname: 'FD 1' })],
      '2025-26',
      '2026-10-26',
      null,
    );
    const csv = interestCsv(s, { r: 'Rupash' });
    const lines = csv.trim().split('\n');
    expect(lines[0]).toContain('Financial year,Taxpayer,Bank');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Bank, ""X"""');
    expect(lines[1]).toContain('Rupash');
  });
});

describe('refund of tax withheld on NRO interest', () => {
  const opts = { tdsRate: 0.3, cess: 0.04, incomeLimit: 400_000, otherIncome: 0 };
  it('refunds all of it when total Indian income is under the limit, and ignores NRE interest', () => {
    const r = interestRefunds(
      [
        fd({ id: 'a', ownerId: 'p', principal: 3_000_000 }),
        fd({ id: 'b', ownerId: 'p', kind: 'NRE', principal: 5_000_000 }),
      ],
      '2026-27',
      opts,
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.withinLimit).toBe(true);
    expect(r[0]!.tds).toBeCloseTo(r[0]!.interest * 0.3 * 1.04, -1);
    expect(r[0]!.refund).toBe(r[0]!.tds);
  });
  it('does not guess a refund once income is over the limit', () => {
    const r = interestRefunds([fd({ id: 'a', ownerId: 'p', principal: 3_000_000 })], '2026-27', {
      ...opts,
      otherIncome: 300_000,
    });
    expect(r[0]!.withinLimit).toBe(false);
    expect(r[0]!.refund).toBe(0);
  });
  it('gives nothing for a person with no NRO interest', () => {
    expect(interestRefunds([fd({ id: 'a', kind: 'NRE' })], '2026-27', opts)).toEqual([]);
  });
});
