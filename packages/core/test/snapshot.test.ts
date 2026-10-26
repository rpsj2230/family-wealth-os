import { describe, expect, it } from 'vitest';
import { carryForward, estimateSavings } from '../src/estimate';
import { aggregateNetWorth } from '../src/networth';
import { changeOver, makeSnapshot, pointsInRange } from '../src/snapshot';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe('makeSnapshot', () => {
  it('captures totals, the interest/market/fx split, basis and exclusions', () => {
    const today = d('2026-10-26');
    const nw = aggregateNetWorth([
      {
        assetId: 'a',
        ownerId: 'r',
        type: 'bank_account',
        status: 'active',
        name: 'A',
        estimate: estimateSavings({
          balance: 1_000_000,
          balanceAsOf: d('2026-09-26'),
          today,
          annualRate: 0.03,
        }),
      },
      {
        assetId: 'b',
        ownerId: 'r',
        type: 'property',
        status: 'active',
        name: 'B',
        estimate: carryForward({ amount: 2_500_000, asOf: d('2023-12-15'), today }),
      },
      {
        assetId: 'c',
        ownerId: 'r',
        type: 'fixed_deposit',
        status: 'matured_unconfirmed',
        name: 'C',
        estimate: carryForward({ amount: 500_000, asOf: today, today }),
      },
    ]);
    const s = makeSnapshot(nw, '2026-10-26', '2026-10-25');
    expect(s.total).toBe(nw.total);
    expect(s.components.anchorTotal).toBe(3_500_000);
    expect(s.components.interest).toBeGreaterThan(0);
    expect(s.basis.carried_forward).toBe(2_500_000);
    expect(s.excluded).toBe(1);
    expect(s.status).toBe('has_exclusions');
    expect(s.latestRecordedAsOf).toBe('2026-10-25');
  });
});

describe('pointsInRange', () => {
  const pts = [
    { date: '2023-10-26', value: 1 },
    { date: '2025-10-26', value: 2 },
    { date: '2026-04-25', value: 3 },
    { date: '2026-07-26', value: 4 },
    { date: '2026-10-01', value: 5 },
    { date: '2026-10-26', value: 6 },
  ];
  it('filters by window', () => {
    expect(pointsInRange(pts, '1M', '2026-10-26').map((p) => p.value)).toEqual([5, 6]);
    expect(pointsInRange(pts, '3M', '2026-10-26').map((p) => p.value)).toEqual([4, 5, 6]);
    expect(pointsInRange(pts, '6M', '2026-10-26').map((p) => p.value)).toEqual([4, 5, 6]);
    expect(pointsInRange(pts, '1Y', '2026-10-26').map((p) => p.value)).toEqual([2, 3, 4, 5, 6]); // boundary day is included
    expect(pointsInRange(pts, '3Y', '2026-10-26').map((p) => p.value)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(pointsInRange(pts, 'ALL', '2026-10-26')).toHaveLength(6);
  });
  it('sorts unsorted input', () => {
    expect(pointsInRange([...pts].reverse(), 'ALL', '2026-10-26')[0]!.value).toBe(1);
  });
});

describe('changeOver', () => {
  it('returns null for fewer than two points instead of a fake zero', () => {
    expect(changeOver([])).toBeNull();
    expect(changeOver([{ date: '2026-10-26', value: 5 }])).toBeNull();
  });
  it('computes amount and fraction', () => {
    expect(
      changeOver([
        { date: 'a', value: 100 },
        { date: 'b', value: 110 },
      ]),
    ).toEqual({ amount: 10, pct: 0.1 });
    expect(
      changeOver([
        { date: 'a', value: 0 },
        { date: 'b', value: 10 },
      ]),
    ).toEqual({ amount: 10, pct: null });
  });
});
