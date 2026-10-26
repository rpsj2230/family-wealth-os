import { describe, expect, it } from 'vitest';
import { daysBetweenIso, daysPhrase, niceDate, niceMonth } from './dates';

describe('dates', () => {
  it('writes a date as 26 Oct 2026', () => {
    expect(niceDate('2026-10-26')).toBe('26 Oct 2026');
    expect(niceDate('2027-01-05T10:00:00Z')).toBe('5 Jan 2027');
    expect(niceDate(null)).toBe('–');
    expect(niceDate('nonsense')).toBe('–');
  });
  it('writes a month as Jun 2021', () => {
    expect(niceMonth('2021-06-15')).toBe('Jun 2021');
    expect(niceMonth(null)).toBe('–');
  });
  it('says how far away a date is', () => {
    expect(daysPhrase(0)).toBe('today');
    expect(daysPhrase(1)).toBe('in 1 day');
    expect(daysPhrase(12)).toBe('in 12 days');
    expect(daysPhrase(-3)).toBe('3 days ago');
  });
  it('counts whole days', () => {
    expect(daysBetweenIso('2026-10-26', '2026-11-05')).toBe(10);
    expect(daysBetweenIso('2026-11-05', '2026-10-26')).toBe(-10);
  });
});
