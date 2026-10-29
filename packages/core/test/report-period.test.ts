import { describe, expect, it } from 'vitest';
import { daysIn, parsePeriodKey, previousPeriod, resolvePeriod } from '../src/report-period';

const today = '2026-10-29'; // a Thursday, in Q3 of FY 2026-27

describe('resolvePeriod', () => {
  it.each([
    ['today', '2026-10-29', '2026-10-29'],
    ['yesterday', '2026-10-28', '2026-10-28'],
    ['this-week', '2026-10-26', '2026-10-29'],
    ['last-week', '2026-10-19', '2026-10-25'],
    ['this-month', '2026-10-01', '2026-10-29'],
    ['last-month', '2026-09-01', '2026-09-30'],
    ['this-quarter', '2026-10-01', '2026-10-29'],
    ['last-quarter', '2026-07-01', '2026-09-30'],
    ['this-fy', '2026-04-01', '2026-10-29'],
    ['last-fy', '2025-04-01', '2026-03-31'],
    ['this-year', '2026-01-01', '2026-10-29'],
    ['last-year', '2025-01-01', '2025-12-31'],
    ['last-7', '2026-10-23', '2026-10-29'],
    ['last-30', '2026-09-30', '2026-10-29'],
    ['last-90', '2026-08-01', '2026-10-29'],
    ['last-12m', '2025-10-30', '2026-10-29'],
    ['ytd', '2026-01-01', '2026-10-29'],
    ['fytd', '2026-04-01', '2026-10-29'],
  ] as const)('%s runs from %s to %s, never past today', (key, from, to) => {
    const r = resolvePeriod(key, today);
    expect([r.from, r.to]).toEqual([from, to]);
  });

  it('names the financial year and its quarters the Indian way', () => {
    expect(resolvePeriod('last-fy', today).label).toBe('FY 2025-26');
    expect(resolvePeriod('this-quarter', today).label).toBe('Q3 FY 2026-27 (Oct–Dec 2026)');
    // January to March is the fourth quarter of the year that began the April before
    expect(resolvePeriod('this-quarter', '2027-02-10').label).toBe('Q4 FY 2026-27 (Jan–Mar 2027)');
    expect(resolvePeriod('last-quarter', '2027-02-10').from).toBe('2026-10-01');
    expect(resolvePeriod('last-quarter', '2026-05-10')).toMatchObject({
      from: '2026-01-01',
      to: '2026-03-31',
    });
  });

  it('calendar quarters, when Settings asks for them, cover the same months under calendar names', () => {
    expect(resolvePeriod('this-quarter', today, { financialQuarters: false })).toMatchObject({
      from: '2026-10-01',
      label: 'Q4 2026 (Oct–Dec 2026)',
    });
    expect(
      previousPeriod(resolvePeriod('this-quarter', today), { financialQuarters: false })!.label,
    ).toBe('Q3 2026 (Jul–Sep 2026)');
  });

  it('a custom period swaps reversed dates and falls back when a date is missing or wrong', () => {
    expect(resolvePeriod('custom', today, { from: '2026-06-30', to: '2026-01-01' })).toMatchObject({
      from: '2026-01-01',
      to: '2026-06-30',
      key: 'custom',
    });
    expect(resolvePeriod('custom', today, { from: 'nonsense', to: '2026-01-01' })).toMatchObject({
      from: '2026-04-01',
      to: today,
      key: 'custom',
    });
  });

  it('the "next" periods and chosen dates look ahead; nothing else passes today', () => {
    expect(resolvePeriod('next-90', today)).toMatchObject({ from: today, to: '2027-01-27' });
    expect(resolvePeriod('next-12m', today)).toMatchObject({ from: today, to: '2027-10-28' });
    expect(resolvePeriod('custom', today, { from: '2026-11-01', to: '2027-03-31' }).to).toBe(
      '2027-03-31',
    );
    expect(resolvePeriod('this-year', today).to).toBe(today);
  });

  it('since the first record starts on that day', () => {
    expect(resolvePeriod('inception', today, { first: '2018-03-12' }).from).toBe('2018-03-12');
    expect(resolvePeriod('inception', today).from).toBe(today);
  });

  it('reads unknown keys as the fallback', () => {
    expect(parsePeriodKey('bogus')).toBe('this-fy');
    expect(parsePeriodKey('last-90')).toBe('last-90');
  });
});

describe('previousPeriod', () => {
  it('compares a named period with the one before it', () => {
    expect(previousPeriod(resolvePeriod('last-month', today))).toMatchObject({
      from: '2026-08-01',
      to: '2026-08-31',
    });
    expect(previousPeriod(resolvePeriod('this-fy', today))).toMatchObject({
      from: '2025-04-01',
      to: '2026-03-31',
    });
    expect(previousPeriod(resolvePeriod('last-quarter', today))).toMatchObject({
      from: '2026-04-01',
      to: '2026-06-30',
    });
    expect(previousPeriod(resolvePeriod('this-quarter', '2027-02-10'))).toMatchObject({
      from: '2026-10-01',
      to: '2026-12-31',
    });
  });

  it('a "to date" period is compared with the same days a year earlier', () => {
    expect(previousPeriod(resolvePeriod('fytd', today))).toMatchObject({
      from: '2025-04-01',
      to: '2025-10-29',
    });
    expect(previousPeriod(resolvePeriod('ytd', '2028-02-29'))).toMatchObject({
      from: '2027-01-01',
      to: '2027-02-28',
    });
  });

  it('any other period is compared with the same number of days just before', () => {
    const r = resolvePeriod('last-30', today);
    const p = previousPeriod(r)!;
    expect(daysIn(p)).toBe(daysIn(r));
    expect(p.to).toBe('2026-09-29');
    expect(previousPeriod(resolvePeriod('inception', today, { first: '2020-01-01' }))).toBeNull();
  });
});
