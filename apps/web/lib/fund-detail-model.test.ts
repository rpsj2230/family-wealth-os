import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type FundRangeKey } from '@fwos/core';
import { demoFund, DEMO_HOLDING_MONTHS, DEMO_TODAY } from './demo-funds';
import { buildFundDetail } from './fund-detail-model';

const detail = (id: string, range: FundRangeKey = 'all') => {
  const s = demoFund(id, range);
  return {
    s,
    d: buildFundDetail({
      fund: s.row,
      navs: s.navs,
      today: DEMO_TODAY,
      range,
      holdingMonths: DEMO_HOLDING_MONTHS,
      config: DEFAULT_CONFIG.funds,
      maxPoints: 100,
    }),
  };
};

describe('buildFundDetail on the sample funds', () => {
  it('a fund with a statement: average cost from lots, purchases on the price line, long-term split', () => {
    const { s, d } = detail('f1');
    expect(d.avgCostBasis).toBe('statement');
    expect(d.avgCost).toBeGreaterThan(100);
    expect(d.nav.buys.length).toBeGreaterThan(40);
    expect(d.nav.sells).toHaveLength(1);
    expect(d.nav.line.length).toBeLessThanOrEqual(100);
    expect(d.holding?.basis).toBe('statement');
    expect(d.holding!.longValue + d.holding!.shortValue).toBeCloseTo(s.row.value, 0);
    expect(d.sip.basis).toBe('statement');
    expect(d.calendar.missed).toBe(2);
    expect(d.unrealised).toBe(s.row.value - s.row.invested);
    expect(d.units.at(-1)!.value).toBeCloseTo(s.row.units!, 2);
    expect(d.cagr).toBeNull(); // money went in over time
  });
  it('a single lump sum gets a compound growth figure', () => {
    const { d } = detail('f5');
    expect(d.cagrFrom).toBe('2025-01-06');
    expect(d.cagr).not.toBeNull();
    expect(d.holding).toBeNull(); // gold: the long-term rule for equity funds does not apply
    expect(d.holdingNote).toMatch(/equity-oriented funds only/);
  });
  it('a fund without a statement is marked estimated, never real', () => {
    const { d, s } = detail('f6');
    expect(s.row.hasStatement).toBe(false);
    expect(d.sip.basis).toBe('plan');
    expect(d.calendar.basis).toBe('plan');
    expect(d.holding?.basis).toBe('estimated');
    expect(d.nav.buys).toEqual([]);
    expect(d.realised.sales).toBe(0);
    expect(d.units).toEqual([]);
  });
  it('a short range keeps only the points inside it', () => {
    const { d } = detail('f1', '1m');
    expect(d.points.length).toBeGreaterThan(15);
    expect(d.nav.line.every((n) => n.date >= '2026-09-26')).toBe(true);
  });
});
