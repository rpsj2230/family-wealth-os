import { describe, expect, it } from 'vitest';
import { xirr } from '../src/xirr';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('xirr', () => {
  it('matches the Microsoft documented XIRR example (0.373362535)', () => {
    const r = xirr([
      { date: d('2008-01-01'), amount: -10000 },
      { date: d('2008-03-01'), amount: 2750 },
      { date: d('2008-10-30'), amount: 4250 },
      { date: d('2009-02-15'), amount: 3250 },
      { date: d('2009-04-01'), amount: 2750 },
    ]);
    expect(r.status).toBe('ok');
    expect(r.rate!).toBeCloseTo(0.373362535, 6);
  });

  it('returns exactly 10% for 100 -> 110 over 365 days', () => {
    const r = xirr([
      { date: d('2024-01-01'), amount: -100 },
      { date: d('2024-12-31'), amount: 110 }, // 365 days (2024 is leap: 1 Jan -> 31 Dec = 365)
    ]);
    expect(r.rate!).toBeCloseTo(0.1, 9);
  });

  it('handles negative returns', () => {
    const r = xirr([
      { date: d('2023-01-01'), amount: -100 },
      { date: d('2024-01-01'), amount: 90 },
    ]);
    expect(r.rate!).toBeCloseTo(-0.1, 9);
  });

  it('is independent of input order', () => {
    const flows = [
      { date: d('2022-01-01'), amount: -1000 },
      { date: d('2023-01-01'), amount: -1000 },
      { date: d('2024-01-01'), amount: 2300 },
    ];
    const a = xirr(flows);
    const b = xirr([...flows].reverse());
    expect(a.rate!).toBeCloseTo(b.rate!, 12);
  });

  it('reproduces a SIP series: 12 x 10,000 then terminal value', () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(Date.UTC(2024, i, 5)),
      amount: -10000,
    }));
    flows.push({ date: d('2025-01-05'), amount: 130000 });
    const r = xirr(flows);
    expect(r.status).toBe('ok');
    // verify by NPV ~ 0 at the returned rate
    const t0 = flows[0]!.date.getTime();
    const npv = flows.reduce(
      (s, f) => s + f.amount / Math.pow(1 + r.rate!, (f.date.getTime() - t0) / 86_400_000 / 365),
      0,
    );
    expect(Math.abs(npv)).toBeLessThan(1e-4);
  });

  it('fails explicitly, never returning 0, when there is no sign change', () => {
    const r = xirr([
      { date: d('2024-01-01'), amount: -100 },
      { date: d('2024-06-01'), amount: -50 },
    ]);
    expect(r.status).toBe('no_sign_change');
    expect(r.rate).toBeNull();
  });

  it('fails on a single flow and on a zero time span', () => {
    expect(xirr([{ date: d('2024-01-01'), amount: -100 }]).status).toBe('insufficient_flows');
    expect(
      xirr([
        { date: d('2024-01-01'), amount: -100 },
        { date: d('2024-01-01'), amount: 120 },
      ]).status,
    ).toBe('zero_span');
  });

  it('rejects invalid input', () => {
    expect(
      xirr([
        { date: new Date('nope'), amount: -100 },
        { date: d('2024-01-01'), amount: 120 },
      ]).status,
    ).toBe('invalid_input');
  });

  it('flags multiple roots instead of picking silently', () => {
    // Classic sign-flipping series with two valid IRRs (10% and 20% annual, yearly spacing).
    const r = xirr([
      { date: d('2020-01-01'), amount: -1000 },
      { date: d('2021-01-01'), amount: 2300 },
      { date: d('2022-01-01'), amount: -1320 },
    ]);
    expect(r.status).toBe('ok_multiple_roots');
    expect(r.roots.length).toBe(2);
  });
});
