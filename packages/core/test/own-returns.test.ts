import { describe, expect, it } from 'vitest';
import { heldLine, ownPeriods, shadowLine } from '../src/own-returns';
import { PERF_PERIODS } from '../src/return-profile';

const TODAY = '2026-10-30';
const defs = PERF_PERIODS.filter((d) => ['1m', '1y', '3y', '5y', 'all'].includes(d.key));

describe('ownPeriods', () => {
  // ₹1,000 put in on 1 Jan 2025 and ₹1,000 on 1 Jan 2026; worth 1,100 at the end of 2025 and 2,400 today
  const flows = [
    { date: '2025-01-01', amount: 1000 },
    { date: '2026-01-01', amount: 1000 },
  ];
  const points = [
    { date: '2025-01-01', value: 1000 },
    { date: '2025-09-30', value: 1050 },
    { date: '2025-12-31', value: 1100 },
    { date: '2026-09-30', value: 2350 },
    { date: TODAY, value: 2400 },
  ];
  const rows = ownPeriods({ points, flows, today: TODAY, defs, annualiseAfterMonths: 12 });

  it('stops at the first period that reaches back before the first purchase, counted from it', () => {
    expect(rows.map((r) => r.def.key)).toEqual(['1m', '1y', '3y']);
    const all = rows[2]!;
    expect(all.sinceFirst).toBe(true);
    expect(all.from).toBe('2025-01-01');
    expect(all.startValue).toBe(0);
    expect(all.putIn).toBe(2000);
    expect(all.gain).toBe(400);
    // money-weighted per year: 1,000 × (1+r)^1.83 + 1,000 × (1+r)^0.83 = 2,400 gives r ≈ 14.5%
    expect(all.annualised).toBe(true);
    expect(all.ret!).toBeCloseTo(0.1452, 3);
  });

  it('counts a year from the value a year ago and the money put in since', () => {
    const y = rows[1]!;
    expect(y.from).toBe('2025-10-30');
    expect(y.startValue).toBe(1050);
    expect(y.putIn).toBe(1000);
    expect(y.gain).toBe(350);
    expect(y.sinceFirst).toBe(false);
  });

  it('gives a short period the profit on the money at work, not a rate per year', () => {
    const m = rows[0]!;
    expect(m.annualised).toBe(false);
    expect(m.startValue).toBe(2350);
    expect(m.putIn).toBe(0);
    expect(m.gain).toBe(50);
    expect(m.ret).toBeCloseTo(50 / 2350, 6);
  });

  it('has nothing to say without money put in or a value', () => {
    expect(ownPeriods({ points, flows: [], today: TODAY, defs, annualiseAfterMonths: 12 })).toEqual(
      [],
    );
    expect(ownPeriods({ points: [], flows, today: TODAY, defs, annualiseAfterMonths: 12 })).toEqual(
      [],
    );
  });

  it('takes sales out of the money put in', () => {
    const r = ownPeriods({
      points: [
        { date: '2024-01-01', value: 1000 },
        { date: TODAY, value: 700 },
      ],
      flows: [
        { date: '2024-01-01', amount: 1000 },
        { date: '2025-06-01', amount: -500 },
      ],
      today: TODAY,
      defs: defs.filter((d) => d.key === 'all'),
      annualiseAfterMonths: 12,
    });
    expect(r[0]!.takenOut).toBe(500);
    expect(r[0]!.gain).toBe(200);
  });
});

describe('shadowLine', () => {
  const bench = [
    { date: '2025-01-01', value: 10 },
    { date: '2025-07-01', value: 20 },
    { date: '2026-01-01', value: 25 },
  ];
  it('buys the benchmark on the same days for the same money', () => {
    const s = shadowLine(
      [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-07-01', amount: 100 },
      ],
      bench,
      ['2024-12-01', '2025-01-01', '2025-07-01', '2026-01-01'],
    );
    // 10 units, then 5 more: 15 units × 20, then × 25
    expect(s).toEqual([
      { date: '2025-01-01', value: 100 },
      { date: '2025-07-01', value: 300 },
      { date: '2026-01-01', value: 375 },
    ]);
  });
  it('a sale takes out the same rupees', () => {
    const s = shadowLine(
      [
        { date: '2025-01-01', amount: 100 },
        { date: '2025-07-01', amount: -100 },
      ],
      bench,
      ['2026-01-01'],
    );
    expect(s[0]!.value).toBeCloseTo(125, 6);
  });
  it('leaves out a date when the benchmark has no price for a purchase', () => {
    expect(shadowLine([{ date: '2024-06-01', amount: 100 }], bench, ['2026-01-01'])).toEqual([]);
  });
});

describe('heldLine', () => {
  const line = [
    { date: '2012-01-01', value: 10 },
    { date: '2018-10-31', value: 40 },
    { date: '2018-11-30', value: 42 },
    { date: '2019-01-31', value: 45 },
  ];
  it('starts at the price on (or just before) the first purchase', () => {
    expect(heldLine(line, '2018-11-05').map((p) => p.date)).toEqual([
      '2018-10-31',
      '2018-11-30',
      '2019-01-31',
    ]);
    expect(heldLine(line, null)).toBe(line);
  });
});
