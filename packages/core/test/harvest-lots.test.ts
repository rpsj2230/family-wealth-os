import { describe, expect, it } from 'vitest';
import {
  addMonthsIso,
  grandfatheredCost,
  lotLadder,
  lotStatus,
  sellPrefix,
  type HarvestLot,
} from '../src/harvest-lots';

const rules = { holdingMonths: 12, exitLoadDays: 365, exitLoadPct: 0.01 };

describe('dates', () => {
  it('adds months without overflowing short months', () => {
    expect(addMonthsIso('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonthsIso('2024-02-29', 12)).toBe('2025-02-28');
  });
});

describe('lotStatus', () => {
  it('is long-term only the day after the first anniversary, and load-free the day after 365 days', () => {
    const s = lotStatus({ acquiredOn: '2025-10-15', units: 100, cost: 10_000 }, 120, rules);
    expect(s.longTermOn).toBe('2026-10-16');
    expect(s.loadFreeOn).toBe('2026-10-16');
    expect(s.readyOn).toBe('2026-10-16');
    expect(s.gain).toBe(2000);
  });
  it('waits for an ELSS lock-in', () => {
    const s = lotStatus({ acquiredOn: '2024-01-10', units: 1, cost: 100 }, 150, {
      ...rules,
      lockInMonths: 36,
    });
    expect(s.unlockedOn).toBe('2027-01-10');
    expect(s.readyOn).toBe('2027-01-10');
  });
  it('adds the safety margin', () => {
    const s = lotStatus({ acquiredOn: '2025-10-15', units: 1, cost: 1 }, 1, {
      ...rules,
      marginMonths: 1,
    });
    expect(s.readyOn).toBe('2026-11-16');
  });
});

describe('grandfatheredCost', () => {
  it('uses the higher of cost and the lower of the 2018 value and the sale value', () => {
    const a = { acquiredOn: '2016-05-01', cost: 100_000, units: 1000 };
    expect(grandfatheredCost({ ...a, fmv2018PerUnit: 150, saleValue: 400_000 })).toBe(150_000);
    expect(grandfatheredCost({ ...a, fmv2018PerUnit: 150, saleValue: 120_000 })).toBe(120_000);
    expect(grandfatheredCost({ ...a, fmv2018PerUnit: 60, saleValue: 400_000 })).toBe(100_000);
  });
  it('does not touch later purchases or a missing 2018 price', () => {
    expect(
      grandfatheredCost({
        acquiredOn: '2019-01-01',
        cost: 5,
        units: 1,
        fmv2018PerUnit: 99,
        saleValue: 99,
      }),
    ).toBe(5);
    expect(
      grandfatheredCost({
        acquiredOn: '2016-01-01',
        cost: 5,
        units: 1,
        fmv2018PerUnit: null,
        saleValue: 99,
      }),
    ).toBe(5);
  });
});

describe('lotLadder for a monthly SIP', () => {
  // twelve monthly instalments from 15 Jan 2026; today is 20 Oct 2026, price 12 against a cost of 10
  const lots: HarvestLot[] = Array.from({ length: 10 }, (_, i) => ({
    acquiredOn: `2026-${String(i + 1).padStart(2, '0')}-15`,
    units: 100,
    cost: 1000,
  }));
  const early: HarvestLot[] = [
    { acquiredOn: '2025-08-15', units: 100, cost: 900 },
    { acquiredOn: '2025-09-15', units: 100, cost: 950 },
    ...lots,
  ];
  const l = lotLadder({ lots: early, unitValue: 12, today: '2026-10-20', rules });
  it('counts only lots past a year as ready, and the rest as waiting', () => {
    expect(l.ready.lots).toBe(2);
    expect(l.ready.gain).toBe(300 + 250);
    expect(l.waiting.lots).toBe(10);
    expect(l.firstPurchase).toBe('2025-08-15');
  });
  it('lists when each later instalment turns ready, soonest first', () => {
    expect(l.upcoming[0]).toMatchObject({ on: '2027-01-16', lots: 1, gain: 200 });
    expect(l.upcoming.length).toBe(10);
    expect(l.upcoming[0]!.daysAway).toBe(88);
  });
  it('shows the exit load that selling the waiting lots now would cost', () => {
    expect(l.loadIfSoldToday).toBeCloseTo(10 * 100 * 12 * 0.01, 6);
  });
  it('puts ready lots that are not in profit apart, and unknown costs apart', () => {
    const m = lotLadder({
      lots: [
        { acquiredOn: '2024-01-01', units: 10, cost: 500 },
        { acquiredOn: '2024-02-01', units: 10, cost: null },
        { acquiredOn: '2024-03-01', units: 10, cost: 50 },
      ],
      unitValue: 10,
      today: '2026-10-20',
      rules,
    });
    expect(m.readyAtLoss.lots).toBe(1);
    expect(m.unknownCost.lots).toBe(1);
    expect(m.ready.lots).toBe(1);
  });
});

describe('sellPrefix', () => {
  it('books the oldest lots first and splits short and long', () => {
    const l = lotLadder({
      lots: [
        { acquiredOn: '2025-01-15', units: 100, cost: 1000 },
        { acquiredOn: '2026-06-15', units: 100, cost: 1500 },
      ],
      unitValue: 12,
      today: '2026-10-20',
      rules,
    });
    expect(sellPrefix(l.lots, 1, '2026-10-20')).toEqual({ long: 200, short: 0, proceeds: 1200 });
    expect(sellPrefix(l.lots, 2, '2026-10-20')).toEqual({ long: 200, short: -300, proceeds: 2400 });
  });
});
