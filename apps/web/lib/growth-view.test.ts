import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@fwos/core';
import { buildGrowth, growthMarkers, type GrowthFundIn } from './growth-view';

const history = [
  { date: '2025-01-31', value: 10_000, invested: 10_000 },
  { date: '2026-01-31', value: 24_000, invested: 20_000 },
  { date: '2026-10-26', value: 30_000, invested: 20_000 },
];

const fund = (name: string, txns: GrowthFundIn['txns']): GrowthFundIn => ({
  assetId: name,
  name,
  hasStatement: txns.length > 0,
  txns,
  history,
});

describe('growthMarkers', () => {
  it('adds one-off purchases and sales on the same day, ignores instalments and switches', () => {
    const m = growthMarkers(
      [
        fund('A', [
          { date: '2026-05-01', kind: 'purchase', units: 10, amount: 1000 },
          { date: '2026-05-05', kind: 'sip', units: 5, amount: 500 },
          { date: '2026-06-01', kind: 'redeem', units: -4, amount: -450 },
          { date: '2026-06-02', kind: 'switch_out', units: -4, amount: -450 },
        ]),
        fund('B', [{ date: '2026-05-01', kind: 'purchase', units: 3, amount: 250 }]),
      ],
      null,
    );
    expect(m).toEqual([
      { date: '2026-05-01', kind: 'lump', amount: 1250, funds: ['A', 'B'] },
      { date: '2026-06-01', kind: 'sale', amount: 450, funds: ['A'] },
    ]);
  });
  it('keeps only what is inside the range', () => {
    const m = growthMarkers(
      [fund('A', [{ date: '2024-05-01', kind: 'purchase', units: 10, amount: 1000 }])],
      '2025-01-01',
    );
    expect(m).toEqual([]);
  });
});

describe('buildGrowth', () => {
  it('clips to the range, works out the change and the coverage', () => {
    const g = buildGrowth({
      funds: [
        fund('A', [{ date: '2025-01-05', kind: 'purchase', units: 100, amount: 10_000 }]),
        fund('B', []),
      ],
      trend: history,
      monthly: history,
      today: '2026-10-26',
      range: '1y',
      config: DEFAULT_CONFIG.funds,
    });
    expect(g.points.map((p) => p.date)).toEqual(['2025-01-31', '2026-01-31', '2026-10-26']);
    expect(g.change).toMatchObject({ netIn: 10_000, gain: 10_000 });
    expect(g.statementFunds).toBe(1);
    expect(g.totalFunds).toBe(2);
    expect(g.returns).toHaveLength(3);
    expect(g.contributions).toHaveLength(DEFAULT_CONFIG.funds.contributionMonths);
  });
  it('draws the annual return only from transactions and after the minimum time', () => {
    const g = buildGrowth({
      funds: [
        fund('A', [
          { date: '2025-01-05', kind: 'purchase', units: 100, amount: 10_000 },
          { date: '2025-09-05', kind: 'sip', units: 50, amount: 10_000 },
        ]),
      ],
      trend: history,
      monthly: history,
      today: '2026-10-26',
      range: 'all',
      config: DEFAULT_CONFIG.funds,
    });
    expect(g.xirr.map((p) => p.date)).toEqual(['2026-01-31', '2026-10-26']);
    expect(g.xirr.every((p) => p.value > 0)).toBe(true);
    const none = buildGrowth({
      funds: [fund('B', [])],
      trend: history,
      monthly: history,
      today: '2026-10-26',
      range: 'all',
      config: DEFAULT_CONFIG.funds,
    });
    expect(none.xirr).toEqual([]);
  });
});
