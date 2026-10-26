import { describe, expect, it } from 'vitest';
import { perfDates } from '../src/perf-inputs';
import {
  alignSeries,
  bucketOf,
  compareWithPrevious,
  lastBuckets,
  parsePlKind,
  periodPL,
  weekStart,
} from '../src/period-pl';
import { chainPeriods } from '../src/return-profile';

const periods = chainPeriods(
  [
    { date: '2026-07-31', value: 100 },
    { date: '2026-08-31', value: 110 },
    { date: '2026-09-30', value: 121 },
    { date: '2026-10-31', value: 70 }, // a sale of 40 on 10-15 and a fall
  ],
  [
    { date: '2026-07-15', amount: 100 },
    { date: '2026-10-15', amount: -40 },
  ],
);
const opts = { weeks: 26, estimatedSince: null };

describe('buckets', () => {
  it('names the week, month, quarter and years of a date with their first and last days', () => {
    expect(weekStart('2026-10-28')).toBe('2026-10-26');
    expect(weekStart('2026-11-01')).toBe('2026-10-26');
    expect(bucketOf('2026-10-28', 'week')).toMatchObject({
      start: '2026-10-26',
      end: '2026-11-01',
    });
    expect(bucketOf('2026-10-28', 'month')).toMatchObject({
      key: '2026-10',
      label: 'Oct 2026',
      end: '2026-10-31',
    });
    const q = bucketOf('2026-08-10', 'quarter');
    expect(q).toMatchObject({ key: '2026-Q2', start: '2026-07-01', end: '2026-09-30' });
    expect(q.label).toContain('Q2 FY 2026-27');
    expect(bucketOf('2027-02-10', 'quarter')).toMatchObject({
      key: '2026-Q4',
      start: '2027-01-01',
      end: '2027-03-31',
    });
    expect(bucketOf('2026-05-01', 'quarter')).toMatchObject({
      key: '2026-Q1',
      start: '2026-04-01',
      end: '2026-06-30',
    });
    expect(bucketOf('2027-01-05', 'fy')).toMatchObject({
      key: '2026-27',
      label: 'FY 2026-27',
      start: '2026-04-01',
      end: '2027-03-31',
    });
    expect(bucketOf('2026-10-28', 'year')).toMatchObject({
      key: '2026',
      start: '2026-01-01',
      end: '2026-12-31',
    });
  });
  it('reads the kind from the address', () => {
    expect(parsePlKind('fy')).toBe('fy');
    expect(parsePlKind('x')).toBe('month');
  });
});

describe('periodPL', () => {
  it('gives the gain and return of each month, with money put in kept out of the profit', () => {
    const m = periodPL(periods, 'month', '2026-10-31', opts);
    expect(m.map((b) => b.key)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10']);
    expect(m[0]!.gain).toBeCloseTo(0); // the 100 put in is not a gain
    expect(m[0]!.netIn).toBe(100);
    expect(m[1]!.gain).toBeCloseTo(10);
    expect(m[1]!.ret).toBeCloseTo(0.1);
    // October: 121 -> 70 with 40 taken out: 70 - 121 + 40 = -11
    expect(m[3]!.gain).toBeCloseTo(-11);
    expect(m[3]!.netIn).toBe(-40);
    expect(m[3]!.ret!).toBeLessThan(0);
  });
  it('adds up months into a quarter and gives the running total', () => {
    const q = periodPL(periods, 'quarter', '2026-10-31', opts);
    expect(q.map((b) => b.key)).toEqual(['2026-Q2', '2026-Q3']);
    expect(q[0]!.gain).toBeCloseTo(21);
    expect(q[0]!.ret).toBeCloseTo(0.21);
    expect(q[1]!.cumGain).toBeCloseTo(21 - 11);
    expect(q[0]!.partial).toBe(true); // the history began on 14 July
    expect(q[1]!.partial).toBe(true);
  });
  it('marks the first bucket partial when the history began part-way through it, and the estimated ones', () => {
    const m = periodPL(periods, 'month', '2026-10-31', { weeks: 26, estimatedSince: '2026-09-01' });
    expect(m[0]!.partial).toBe(true);
    expect(m[1]!.partial).toBe(false);
    expect(m.map((b) => b.estimated)).toEqual([false, false, true, true]);
  });
  it('builds weeks only for the latest weeks', () => {
    const w = periodPL(periods, 'week', '2026-10-31', { weeks: 2, estimatedSince: null });
    expect(w.length).toBeLessThanOrEqual(2);
    expect(w.every((b) => b.key >= '2026-10-19')).toBe(true);
  });
  it('gives financial and calendar years', () => {
    expect(periodPL(periods, 'fy', '2026-10-31', opts).map((b) => b.key)).toEqual(['2026-27']);
    expect(periodPL(periods, 'year', '2026-10-31', opts)[0]!.gain).toBeCloseTo(10);
  });
});

describe('comparisons', () => {
  const m = periodPL(periods, 'month', '2026-10-31', opts);
  it('puts the latest bucket against the one before', () => {
    const c = compareWithPrevious(m)!;
    expect(c.current.key).toBe('2026-10');
    expect(c.previous.key).toBe('2026-09');
    expect(c.diffGain).toBeCloseTo(-11 - 11);
    expect(c.diffRet!).toBeLessThan(0);
    expect(compareWithPrevious(m.slice(0, 1))).toBeNull();
  });
  it('keeps the latest buckets and works the running totals out again', () => {
    const l = lastBuckets(m, 2);
    expect(l).toHaveLength(2);
    expect(l[0]!.cumGain).toBeCloseTo(11);
    expect(l[1]!.cumGain).toBeCloseTo(0);
  });
  it('lines several series up by bucket', () => {
    const a = { id: 'a', label: 'A', colour: 'x', buckets: m };
    const b = { id: 'b', label: 'B', colour: 'y', buckets: m.slice(1) };
    const rows = alignSeries([a, b], 10);
    expect(rows).toHaveLength(4);
    expect(rows[0]!.cells[1]!.gain).toBeNull();
    expect(rows[1]!.cells[1]!.gain).toBeCloseTo(10);
    expect(alignSeries([a, b], 2).map((r) => r.key)).toEqual(['2026-09', '2026-10']);
  });
});

describe('perfDates with weeks', () => {
  it('adds every Sunday of the latest weeks, once', () => {
    const d = perfDates('2025-01-01', '2026-10-28', 4);
    expect(d).toContain('2026-10-25');
    expect(d).toContain('2026-10-04');
    expect(d).not.toContain('2026-09-27');
    expect(new Set(d).size).toBe(d.length);
    expect(perfDates('2025-01-01', '2026-10-28')).not.toContain('2026-10-25');
  });
});
