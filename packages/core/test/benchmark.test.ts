import { describe, expect, it } from 'vitest';
import { benchmarkWhatIf, versus } from '../src/benchmark';

const navs = [
  { date: '2025-01-01', value: 100 },
  { date: '2025-07-01', value: 110 },
  { date: '2026-01-01', value: 121 },
];

describe('benchmarkWhatIf', () => {
  it('puts each purchase into the benchmark at that day and values the units at the last price', () => {
    const w = benchmarkWhatIf({
      flows: [
        { date: '2025-01-01', amount: 1000 },
        { date: '2025-07-01', amount: 1100 },
      ],
      navs,
      today: '2026-01-01',
      gapDays: 5,
    })!;
    // 10 units + 10 units at 121
    expect(w.value).toBeCloseTo(2420);
    expect(w.netIn).toBe(2100);
    expect(w.gain).toBeCloseTo(320);
    expect(w.coverage).toBe(1);
    expect(w.skipped).toBe(0);
    expect(w.xirr).toBeGreaterThan(0.1);
  });

  it('takes a sale out of the units and never goes below none', () => {
    const w = benchmarkWhatIf({
      flows: [
        { date: '2025-01-01', amount: 1000 },
        { date: '2025-07-01', amount: -550 },
      ],
      navs,
      today: '2026-01-01',
      gapDays: 5,
    })!;
    // 10 units, 5 sold at 110, 5 left at 121
    expect(w.value).toBeCloseTo(605);
    expect(w.netIn).toBe(450);
  });

  it('leaves out money that went in before the benchmark began, and says how much that is', () => {
    const w = benchmarkWhatIf({
      flows: [
        { date: '2024-01-01', amount: 1000 },
        { date: '2025-01-01', amount: 1000 },
      ],
      navs,
      today: '2026-01-01',
      gapDays: 5,
    })!;
    expect(w.skipped).toBe(1);
    expect(w.coverage).toBeCloseTo(0.5);
    expect(w.netIn).toBe(1000);
  });

  it('gives nothing without prices or flows', () => {
    expect(benchmarkWhatIf({ flows: [], navs, today: '2026-01-01', gapDays: 5 })).toBeNull();
    expect(
      benchmarkWhatIf({
        flows: [{ date: '2025-01-01', amount: 5 }],
        navs: [],
        today: '2026-01-01',
        gapDays: 5,
      }),
    ).toBeNull();
  });
});

describe('versus', () => {
  it('puts two sets of returns side by side and works out the difference where both exist', () => {
    const v = versus(
      [
        { key: '1y', ret: 0.12 },
        { key: '3y', ret: null },
      ],
      [
        { key: '1y', ret: 0.1 },
        { key: '3y', ret: 0.09 },
      ],
    );
    expect(v[0]!.diff).toBeCloseTo(0.02);
    expect(v[1]!.diff).toBeNull();
    expect(v[1]!.benchmark).toBe(0.09);
  });
});
