import { describe, expect, it } from 'vitest';
import { portfolioPerformance, type PerfFundIn } from '../src/portfolio-performance';
import type { ProfileConfig } from '../src/return-profile';

const CFG: ProfileConfig = {
  annualiseAfterMonths: 12,
  gapDays: 10,
  riskFree: 0.06,
  riskMonths: 36,
  riskMinMonths: 24,
  rollingYears: [1],
  rollingMinWindows: 6,
};

const monthEnd = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

/** A fund bought once on 2024-01-02 for 1,000 that grows 1% a month; value at each month end up to 2026-03. */
function oneFund(): PerfFundIn {
  const perf = [];
  let v = 1000;
  for (let i = 0; i < 27; i++) {
    const y = 2024 + Math.floor(i / 12);
    const m = (i % 12) + 1;
    v *= i === 0 ? 1 : 1.01;
    perf.push({ date: monthEnd(y, m), value: v, invested: 1000 });
  }
  return {
    assetId: 'a',
    perf,
    flows: [{ date: '2024-01-02', amount: 1000 }],
    flowsEstimated: false,
    value: perf[perf.length - 1]!.value,
  };
}

describe('portfolioPerformance', () => {
  it('turns values and one purchase into a time-weighted index and yearly figures with rupee gains', () => {
    const f = oneFund();
    const p = portfolioPerformance({ funds: [f], today: '2026-03-31', cfg: CFG, benchmark: [] });
    const y2025 = p.calendar.find((y) => y.key === '2025')!;
    expect(y2025.ret).toBeCloseTo(Math.pow(1.01, 12) - 1, 3);
    // the rupee gain in 2025 is the value at the end of 2025 less the value at the end of 2024
    const v = (d: string) => f.perf.find((x) => x.date === d)!.value;
    expect(Math.abs(y2025.gain - (v('2025-12-31') - v('2024-12-31')))).toBeLessThan(1);
    expect(y2025.netIn).toBe(0);
    expect(p.periodGains['1y']!.gain).toBeGreaterThan(0);
    expect(p.estimatedShare).toBe(0);
    expect(p.profile.heatCalendar.length).toBe(3);
    expect(p.whatIf).toBeNull();
    expect(p.versus.every((x) => x.v.benchmark === null)).toBe(true);
  });

  it('reports how much of the value rests on estimated flows', () => {
    const a = oneFund();
    const b = { ...oneFund(), assetId: 'b', flowsEstimated: true };
    const p = portfolioPerformance({ funds: [a, b], today: '2026-03-31', cfg: CFG, benchmark: [] });
    expect(p.estimatedShare).toBeCloseTo(0.5);
  });

  it('compares with a benchmark for each period and asks what the same money would have done', () => {
    const f = oneFund();
    // the benchmark rises 0.5% a month over the same days
    const bench = [];
    let v = 100;
    for (
      let d = new Date('2023-12-01T00:00:00Z');
      d <= new Date('2026-03-31T00:00:00Z');
      d = new Date(d.getTime() + 86_400_000 * 5)
    ) {
      v *= 1.0008;
      bench.push({ date: d.toISOString().slice(0, 10), value: v });
    }
    const p = portfolioPerformance({ funds: [f], today: '2026-03-31', cfg: CFG, benchmark: bench });
    const y1 = p.versus.find((x) => x.def.key === '1y')!.v;
    expect(y1.yours).not.toBeNull();
    expect(y1.benchmark).not.toBeNull();
    expect(y1.diff).toBeGreaterThan(0);
    expect(p.whatIf).not.toBeNull();
    expect(p.whatIf!.netIn).toBe(1000);
    expect(p.whatIf!.coverage).toBe(1);
  });
});
