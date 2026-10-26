import { describe, expect, it } from 'vitest';
import {
  bestWorst,
  buildIndex,
  chainPeriods,
  chainReturns,
  drawdown,
  heatmap,
  monthEndPoints,
  monthlyReturns,
  perfAnchors,
  periodAnchor,
  PERF_PERIODS,
  pointAtOrBefore,
  rebase,
  returnProfile,
  riskStats,
  rollingReturns,
  shownReturn,
  trailingReturn,
  yearlyReturns,
  type IndexPoint,
  type ProfileConfig,
} from '../src/return-profile';

/** month ends from a first month, with a value for each */
const monthEnds = (from: string, values: number[]): IndexPoint[] => {
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  return values.map((value) => {
    const date = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    return { date, value };
  });
};
/** a line growing by the same share each month */
const steady = (from: string, n: number, g: number, start = 100) =>
  monthEnds(
    from,
    Array.from({ length: n }, (_, i) => start * Math.pow(1 + g, i)),
  );

const CFG: ProfileConfig = {
  annualiseAfterMonths: 12,
  gapDays: 10,
  riskFree: 0.06,
  riskMonths: 36,
  riskMinMonths: 24,
  rollingYears: [1, 3],
  rollingMinWindows: 12,
};

describe('chainPeriods and the index', () => {
  it('starts from nothing when money goes in before the first value, and counts a flow for the time it was in', () => {
    const p = chainPeriods(
      [
        { date: '2025-01-31', value: 100 },
        { date: '2025-02-28', value: 110 },
      ],
      [{ date: '2025-01-15', amount: 100 }],
    );
    expect(p).toHaveLength(2);
    expect(p[0]!.from).toBe('2025-01-14');
    expect(p[0]!.gain).toBeCloseTo(0);
    expect(p[1]!.ret).toBeCloseTo(0.1);
    const idx = buildIndex(p);
    expect(idx[0]!.value).toBe(100);
    expect(idx[idx.length - 1]!.value).toBeCloseTo(110);
  });

  it('weights a flow by the part of the period it was invested (Modified Dietz)', () => {
    const [p] = chainPeriods(
      [
        { date: '2025-01-31', value: 100 },
        { date: '2025-02-28', value: 250 },
      ],
      [{ date: '2025-02-14', amount: 100 }],
    );
    // 14 of 28 days: base 100 + 50, gain 250 - 100 - 100
    expect(p!.base).toBeCloseTo(150);
    expect(p!.gain).toBeCloseTo(50);
    expect(p!.ret).toBeCloseTo(1 / 3);
  });

  it('treats money taken out as a negative flow and gives no return when no money was at work', () => {
    const [sold] = chainPeriods(
      [
        { date: '2025-01-31', value: 200 },
        { date: '2025-02-28', value: 110 },
      ],
      [{ date: '2025-02-10', amount: -100 }],
    );
    expect(sold!.gain).toBeCloseTo(10);
    const [none] = chainPeriods(
      [
        { date: '2025-01-31', value: 0 },
        { date: '2025-02-28', value: 0 },
      ],
      [],
    );
    expect(none!.ret).toBeNull();
    expect(buildIndex([none!])[1]!.value).toBe(100);
  });

  it('returns nothing for an empty history', () => {
    expect(chainPeriods([], [])).toEqual([]);
    expect(buildIndex([])).toEqual([]);
  });
});

describe('periods and trailing returns', () => {
  it('finds the day each period starts from', () => {
    expect(periodAnchor('1y', '2026-10-26')).toBe('2025-10-26');
    expect(periodAnchor('fy', '2026-10-26')).toBe('2026-03-31');
    expect(periodAnchor('fy', '2026-02-10')).toBe('2025-03-31');
    expect(periodAnchor('ytd', '2026-10-26')).toBe('2025-12-31');
    expect(periodAnchor('all', '2026-10-26')).toBeNull();
    expect(perfAnchors('2026-10-26')).toContain('2023-10-26');
  });

  it('shows a plain change under a year and a rate per year from a year', () => {
    const s = steady('2024-01', 34, 0.01); // to 2026-10-31... values at month ends
    const today = '2026-10-31';
    const one = trailingReturn(
      s,
      today,
      PERF_PERIODS.find((p) => p.key === '1m')!,
      CFG,
    )!;
    expect(one.annualised).toBeNull();
    expect(one.absolute).toBeCloseTo(0.01, 4);
    expect(shownReturn(one)).toBeCloseTo(0.01, 4);
    const year = trailingReturn(
      s,
      today,
      PERF_PERIODS.find((p) => p.key === '1y')!,
      CFG,
    )!;
    expect(year.absolute).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
    expect(year.annualised).toBeCloseTo(Math.pow(1.01, 12) - 1, 2);
    const all = trailingReturn(
      s,
      today,
      PERF_PERIODS.find((p) => p.key === 'all')!,
      CFG,
    )!;
    expect(all.from).toBe('2024-01-31');
  });

  it('gives null when the history does not reach back', () => {
    const s = steady('2026-01', 10, 0.01);
    expect(
      trailingReturn(
        s,
        '2026-10-31',
        PERF_PERIODS.find((p) => p.key === '3y')!,
        CFG,
      ),
    ).toBeNull();
    expect(trailingReturn([], '2026-10-31', PERF_PERIODS[0]!, CFG)).toBeNull();
  });

  it('looks up the last point on or before a day, within a gap', () => {
    const s = steady('2026-01', 3, 0.01);
    expect(pointAtOrBefore(s, '2026-02-10')!.date).toBe('2026-01-31');
    expect(pointAtOrBefore(s, '2026-02-10', 5)).toBeNull();
    expect(pointAtOrBefore(s, '2025-12-01')).toBeNull();
  });
});

describe('months and years', () => {
  const s = monthEnds('2024-11', [100, 110, 99, 108.9, 120]); // Nov 24 .. Mar 25
  it('keeps the last point of each month', () => {
    expect(monthEndPoints([...s, { date: '2025-03-10', value: 5 }])).toHaveLength(5);
  });
  it('works out each month against the month before, marking the first and the current month partial', () => {
    const m = monthlyReturns(s, '2025-03-15');
    expect(m.find((x) => x.month === '2024-12')!.ret).toBeCloseTo(0.1);
    expect(m.find((x) => x.month === '2025-01')!.ret).toBeCloseTo(-0.1);
    expect(m.find((x) => x.month === '2025-03')!.partial).toBe(true);
    expect(m.find((x) => x.month === '2024-12')!.partial).toBe(false);
  });
  it('joins returns', () => {
    expect(chainReturns([0.1, -0.1, null])).toBeCloseTo(-0.01);
  });
  it('gives a return for each calendar and financial year and marks a part year', () => {
    const long = steady('2022-12', 40, 0.01); // Dec 2022 .. Mar 2026
    const cal = yearlyReturns(long, '2026-03-31', 'calendar');
    expect(cal.map((y) => y.key)).toEqual(['2026', '2025', '2024', '2023']);
    const y2024 = cal.find((y) => y.key === '2024')!;
    expect(y2024.ret).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
    expect(y2024.partial).toBe(false);
    expect(cal.find((y) => y.key === '2026')!.partial).toBe(true);
    const fy = yearlyReturns(long, '2026-03-31', 'financial');
    expect(fy.find((y) => y.key === '2024-25')!.ret).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
    expect(fy.find((y) => y.key === '2024-25')!.partial).toBe(false);
  });
  it('lays out the heat map: January to December, or April to March, with the year total', () => {
    const long = steady('2023-12', 28, 0.01);
    const months = monthlyReturns(long, '2026-03-31');
    const cal = heatmap(months, 'calendar');
    const r2024 = cal.find((r) => r.key === '2024')!;
    expect(r2024.cells).toHaveLength(12);
    expect(r2024.cells[0]).toBeCloseTo(0.01);
    expect(r2024.total).toBeCloseTo(Math.pow(1.01, 12) - 1);
    expect(r2024.months).toBe(12);
    const fy = heatmap(months, 'financial');
    const r = fy.find((x) => x.key === '2024-25')!;
    expect(r.cells[0]).toBeCloseTo(0.01); // April
    expect(r.cells[11]).toBeCloseTo(0.01); // March
  });
  it('names the best and worst', () => {
    const b = bestWorst(
      [
        { k: 'a', ret: 0.1 },
        { k: 'b', ret: -0.2 },
        { k: 'c', ret: null },
      ],
      (x) => x.k,
    );
    expect(b.best).toEqual({ key: 'a', ret: 0.1 });
    expect(b.worst).toEqual({ key: 'b', ret: -0.2 });
    expect(bestWorst([], () => '')).toEqual({ best: null, worst: null });
  });
});

describe('drawdown', () => {
  it('finds the deepest fall from a peak and whether it recovered', () => {
    const d = drawdown(monthEnds('2025-01', [100, 120, 90, 100, 125, 110]));
    expect(d.max!.depth).toBeCloseTo(-0.25);
    expect(d.max!.peakOn).toBe('2025-02-28');
    expect(d.max!.troughOn).toBe('2025-03-31');
    expect(d.max!.recoveredOn).toBe('2025-05-31');
    expect(d.current!.depth).toBeCloseTo(110 / 125 - 1);
    expect(d.current!.peakOn).toBe('2025-05-31');
    expect(d.points[0]!.value).toBe(0);
  });
  it('has no fall in a line that only rises', () => {
    expect(drawdown(steady('2025-01', 6, 0.01)).max).toBeNull();
    expect(drawdown([]).current).toBeNull();
  });
});

describe('rolling returns', () => {
  it('summarises every window, per year for a year or more', () => {
    const r = rollingReturns(steady('2022-01', 48, 0.01), 12, 12);
    expect(r.windows).toBe(36);
    expect(r.min!.ret).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
    expect(r.positiveShare).toBe(1);
    expect(r.median).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
    expect(r.latest).toBeCloseTo(Math.pow(1.01, 12) - 1, 4);
  });
  it('withholds the statistics when there are too few windows', () => {
    const r = rollingReturns(steady('2025-01', 18, 0.01), 12, 12);
    expect(r.windows).toBe(6);
    expect(r.min).toBeNull();
    expect(r.points).toHaveLength(6);
    expect(rollingReturns(steady('2025-01', 6, 0.01), 12, 12).windows).toBe(0);
  });
});

describe('risk figures', () => {
  it('needs enough months, and a steady climb has no spread to divide by', () => {
    const flat = monthlyReturns(steady('2022-01', 40, 0.01), '2025-04-30');
    expect(riskStats(flat.slice(0, 10), { months: 36, minMonths: 24, riskFree: 0.06 })).toBeNull();
    const r = riskStats(flat, { months: 36, minMonths: 24, riskFree: 0.06 })!;
    expect(r.months).toBe(36);
    expect(r.annualReturn).toBeCloseTo(Math.pow(1.01, 12) - 1, 3);
    expect(r.volatility).toBeCloseTo(0, 6);
    expect(r.sharpe).toBeNull();
  });
  it('works out volatility, Sharpe and Sortino from alternating months', () => {
    const vals = [100];
    for (let i = 1; i < 37; i++) vals.push(vals[i - 1]! * (i % 2 ? 1.04 : 0.98));
    const m = monthlyReturns(monthEnds('2022-01', vals), '2026-12-31');
    const r = riskStats(m, { months: 36, minMonths: 24, riskFree: 0.06 })!;
    expect(r.volatility).toBeGreaterThan(0.1);
    expect(r.sharpe).not.toBeNull();
    expect(r.sortino).not.toBeNull();
    // the same figures with a higher risk-free rate give a lower Sharpe ratio
    const hi = riskStats(m, { months: 36, minMonths: 24, riskFree: 0.1 })!;
    expect(hi.sharpe!).toBeLessThan(r.sharpe!);
  });
});

describe('returnProfile and rebase', () => {
  it('collects every view of a line', () => {
    const p = returnProfile(steady('2021-01', 70, 0.008), '2026-10-31', CFG);
    expect(p.trailing.find((t) => t.def.key === '5y')!.r).not.toBeNull();
    expect(p.calendar.length).toBeGreaterThan(4);
    expect(p.heatFinancial.length).toBeGreaterThan(4);
    expect(p.bestYear).not.toBeNull();
    expect(p.rolling).toHaveLength(2);
    expect(p.rolling[1]!.windows).toBeGreaterThan(12);
    expect(p.risk).not.toBeNull();
    expect(p.drawdown.max).toBeNull();
  });
  it('rebases a line to 100 from a date', () => {
    const r = rebase(steady('2024-01', 6, 0.1, 50), '2024-03-31');
    expect(r[0]!.value).toBeCloseTo(100);
    expect(r[1]!.value).toBeCloseTo(110);
    expect(rebase([], '2024-01-01')).toEqual([]);
  });
});
