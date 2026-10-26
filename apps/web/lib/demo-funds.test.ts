import { describe, expect, it } from 'vitest';
import { statBlock } from '@fwos/core';
import { DEMO_HOLDING_MONTHS, DEMO_TODAY, demoView } from './demo-funds';
import { investGrowth, investStats } from './invest-view';

describe('the sample funds', () => {
  const view = demoView(null, 'all');
  const funds = view.groups.flatMap((g) => g.funds);
  it('are consistent: lots add up to the units, value is units times price', () => {
    for (const f of funds) {
      if (f.lots.length > 0 && f.units !== null) {
        const held = f.lots.reduce((a, l) => a + l.units, 0);
        expect(held).toBeCloseTo(f.units, 1);
      }
      if (f.units !== null && f.nav !== null) expect(f.value).toBe(Math.round(f.units * f.nav));
    }
    expect(view.household.value).toBe(funds.reduce((a, f) => a + f.value, 0));
  });
  it('cover every kind of statistic the page shows', () => {
    const s = investStats(view);
    expect(s.all.byCategory.length).toBeGreaterThanOrEqual(5);
    expect(s.all.holding.longShare).toBeGreaterThan(0.5);
    expect(s.all.holding.shortValue).toBeGreaterThan(0);
    expect(s.all.holding.fundsByBasis.estimated).toBeGreaterThan(0);
    expect(s.all.holding.otherValue).toBeGreaterThan(0);
    expect(s.all.sip.stopped).toBe(1);
    expect(s.all.realised.stcg).not.toBe(0);
    expect(s.all.realised.ltcg).not.toBe(0);
    expect(s.all.estimated).toBe(2);
    expect(s.all.best).not.toBeNull();
    expect(Object.keys(s.byOwner)).toEqual(['p1', 'p2']);
    // the by-person figures add up to everyone
    expect(s.byOwner.p1!.value + s.byOwner.p2!.value).toBe(s.all.value);
  });
  it('a person filter narrows the statistics but not the colour palette', () => {
    const one = demoView('p1', 'all');
    expect(one.groups).toHaveLength(1);
    expect(one.palette).toEqual(view.palette);
    const b = statBlock(one.groups[0]!.funds, {
      today: DEMO_TODAY,
      holdingMonths: DEMO_HOLDING_MONTHS,
      config: one.config,
    });
    expect(b.funds).toBe(3);
  });
  it('growth for each range has points inside the range', () => {
    for (const r of ['1m', '6m', '1y', '3y', 'all'] as const) {
      const g = investGrowth(demoView(null, r));
      expect(g.points.length).toBeGreaterThan(1);
      expect(g.range).toBe(r);
    }
    const all = investGrowth(demoView(null, 'all'));
    expect(all.markers.some((m) => m.kind === 'lump')).toBe(true);
    expect(all.markers.some((m) => m.kind === 'sale')).toBe(true);
    expect(all.xirr.length).toBeGreaterThan(5);
  });
});
