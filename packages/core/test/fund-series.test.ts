import { describe, expect, it } from 'vitest';
import {
  combineSeries,
  fundSeries,
  corpusValue,
  monthEnds,
  paceFromSeries,
  projectCorpus,
  projectionPath,
  type FundHistory,
} from '../src/fund-series';

const empty: FundHistory = { txns: [], navs: [], observations: [], snapshots: [] };

describe('monthEnds', () => {
  it('lists month ends and finishes on the given day', () => {
    expect(monthEnds('2026-01-15', '2026-03-10')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-10',
    ]);
    expect(monthEnds('2026-03-10', '2026-03-10')).toEqual(['2026-03-10']);
  });
});

describe('fundSeries', () => {
  it('prefers the ledger times the price, with the cost of the units held', () => {
    const s = fundSeries(
      {
        ...empty,
        txns: [
          { date: '2026-01-05', units: 100, amount: 10_000 },
          { date: '2026-03-05', units: -50, amount: 6_000 },
        ],
        navs: [
          { date: '2026-01-30', nav: 105 },
          { date: '2026-02-27', nav: 110 },
          { date: '2026-03-31', nav: 120 },
        ],
      },
      '2026-03-31',
    );
    expect(s.map((p) => p.date)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(s[0]).toEqual({ date: '2026-01-31', value: 10_500, invested: 10_000 });
    expect(s[1]!.value).toBeCloseTo(11_000);
    // half the units sold: half the cost goes with them
    expect(s[2]).toEqual({ date: '2026-03-31', value: 6_000, invested: 5_000 });
  });
  it('falls back to snapshots, then to recorded values with the plan cost', () => {
    const s = fundSeries(
      {
        ...empty,
        snapshots: [{ date: '2026-02-28', value: 5_200, invested: 5_000 }],
        observations: [{ date: '2026-01-20', value: 4_900 }],
        plan: { invested: 4_800, startedOn: '2026-01-01' },
      },
      '2026-03-31',
    );
    expect(s[0]).toEqual({ date: '2026-01-31', value: 4_900, invested: 4_800 });
    expect(s[1]).toEqual({ date: '2026-02-28', value: 5_200, invested: 5_000 });
    expect(s[2]!.value).toBe(5_200); // carried to the end of March
  });
  it('ends on today with the current figures', () => {
    const s = fundSeries(
      { ...empty, observations: [{ date: '2026-01-20', value: 100 }] },
      '2026-03-10',
      { value: 130, invested: 90 },
    );
    expect(s[s.length - 1]).toEqual({ date: '2026-03-10', value: 130, invested: 90 });
  });
  it('returns just today when nothing is known', () => {
    expect(fundSeries(empty, '2026-03-10')).toEqual([]);
    expect(fundSeries(empty, '2026-03-10', { value: 5, invested: null })).toEqual([
      { date: '2026-03-10', value: 5, invested: null },
    ]);
  });
});

describe('combineSeries', () => {
  it('adds funds month by month and carries each forward from when it starts', () => {
    const a = [
      { date: '2026-01-31', value: 100, invested: 90 },
      { date: '2026-03-31', value: 120, invested: 90 },
    ];
    const b = [{ date: '2026-02-28', value: 50, invested: 40 }];
    expect(combineSeries([a, b])).toEqual([
      { date: '2026-01-31', value: 100, invested: 90 },
      { date: '2026-02-28', value: 150, invested: 130 },
      { date: '2026-03-31', value: 170, invested: 130 },
    ]);
  });
});

describe('projection', () => {
  it('grows a lump sum at the yearly return', () => {
    expect(corpusValue(100_000, 0, 0.1, 12)).toBeCloseTo(110_000, 0);
    expect(corpusValue(0, 10_000, 0, 12)).toBe(120_000);
  });
  it('adds the monthly amount with growth', () => {
    const fv = corpusValue(0, 10_000, 0.12, 120);
    expect(fv).toBeGreaterThan(10_000 * 120);
    expect(fv).toBeCloseTo(2_219_000, -3); // about ₹22.2 lakh for ₹10,000 a month for ten years at 12% a year
  });
  it('gives a slower, expected and faster path for each horizon', () => {
    const p = projectCorpus({
      today: '2026-10-26',
      value: 1_000_000,
      monthly: 20_000,
      annualReturn: 0.1,
      horizons: [5, 10],
    });
    expect(p).toHaveLength(2);
    expect(p[0]!.date).toBe('2031-10-26');
    expect(p[0]!.low).toBeLessThan(p[0]!.expected);
    expect(p[0]!.expected).toBeLessThan(p[0]!.high);
    expect(p[1]!.contributions).toBe(2_400_000);
    expect(
      projectionPath({ today: '2026-10-26', value: 1, monthly: 0, annualReturn: 0.1, years: 3 }),
    ).toHaveLength(3);
  });
  it('measures the recent pace of a series', () => {
    const pts = [
      { date: '2025-10-31', value: 1_000_000 },
      { date: '2026-04-30', value: 1_300_000 },
      { date: '2026-10-31', value: 1_600_000 },
    ];
    const pace = paceFromSeries(pts)!;
    expect(pace.monthlyChange).toBeCloseTo(50_000, -3);
    expect(pace.annualGrowth).toBeCloseTo(0.6, 1);
    expect(paceFromSeries([pts[0]!])).toBeNull();
  });
});
