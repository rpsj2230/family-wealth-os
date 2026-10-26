import { describe, expect, it } from 'vitest';
import { flowsOfFund, perfDates } from '../src/perf-inputs';

describe('perfDates', () => {
  it('has every month end, the start of each period and today, once and in order', () => {
    const d = perfDates('2023-01-10', '2026-10-26');
    expect(d[0]).toBe('2023-01-31');
    expect(d[d.length - 1]).toBe('2026-10-26');
    expect(d).toContain('2025-10-26'); // a year back
    expect(d).toContain('2026-03-31'); // the start of this financial year
    expect(new Set(d).size).toBe(d.length);
    expect([...d].sort()).toEqual(d);
  });
  it('leaves out period starts before the fund began', () => {
    const d = perfDates('2026-05-10', '2026-10-26');
    expect(d.some((x) => x < '2026-05-10')).toBe(false);
  });
});

describe('flowsOfFund', () => {
  it('signs the statement lines: money in positive, money out negative', () => {
    const r = flowsOfFund({
      txns: [
        { date: '2025-01-05', units: 10, amount: 1000, nav: 100, balance: 10 },
        { date: '2025-06-05', units: -5, amount: -600, nav: 120, balance: 5 },
      ],
      plan: null,
      today: '2026-10-26',
    });
    expect(r.estimated).toBe(false);
    expect(r.flows).toEqual([
      { date: '2025-01-05', amount: 1000 },
      { date: '2025-06-05', amount: -600 },
    ]);
  });
  it('counts units held before the statement began as money put in on its first day', () => {
    const r = flowsOfFund({
      txns: [{ date: '2025-01-05', units: 10, amount: 1000, nav: 100, balance: 60 }],
      plan: null,
      today: '2026-10-26',
    });
    expect(r.flows).toContainEqual({ date: '2025-01-05', amount: 5000 });
  });
  it('works the flows out from the plan, marked estimated, when there is no statement', () => {
    const r = flowsOfFund({
      txns: [],
      plan: { invested: 12_000, startedOn: '2026-01-05', sipMonthly: 1000, sipStopped: false },
      today: '2026-10-26',
    });
    expect(r.estimated).toBe(true);
    expect(r.flows.length).toBeGreaterThan(5);
    expect(r.flows.every((f) => f.amount > 0)).toBe(true);
    expect(flowsOfFund({ txns: [], plan: null, today: '2026-10-26' }).flows).toEqual([]);
  });
});
