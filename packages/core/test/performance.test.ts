import { describe, expect, it } from 'vitest';
import {
  approximateFlows,
  contributionSeries,
  lastNavMove,
  moveAmount,
  returnsFor,
  type FundForReturns,
} from '../src/performance';

const fund = (o: Partial<FundForReturns> = {}): FundForReturns => ({
  assetId: 'a',
  ownerId: 'p',
  name: 'Fund',
  value: 121_000,
  txns: [{ date: '2024-10-26', units: 100, amount: 100_000 }],
  ...o,
});

describe('returnsFor', () => {
  it('works out an annual return from the transactions', () => {
    const r = returnsFor([fund()], '2026-10-26');
    // 100,000 grew to 121,000 in two years: 10% a year
    expect(r.xirr).toBeCloseTo(0.1, 2);
    expect(r.invested).toBe(100_000);
    expect(r.gain).toBe(21_000);
  });
  it('counts money taken out', () => {
    const r = returnsFor(
      [
        fund({
          value: 60_000,
          txns: [
            { date: '2024-10-26', units: 100, amount: 100_000 },
            { date: '2025-10-26', units: -40, amount: 55_000 },
          ],
        }),
      ],
      '2026-10-26',
    );
    expect(r.redeemed).toBe(55_000);
    expect(r.gain).toBe(15_000);
    expect(r.xirr).not.toBeNull();
  });
  it('combines funds and ignores funds with no transactions', () => {
    const r = returnsFor([fund(), fund({ assetId: 'b', value: 50_000, txns: [] })], '2026-10-26');
    expect(r.funds).toBe(1);
    expect(r.value).toBe(121_000);
  });
  it('says so when it cannot compute', () => {
    const r = returnsFor([fund({ txns: [], value: 1000 })], '2026-10-26');
    expect(r.xirr).toBeNull();
    expect(r.funds).toBe(0);
  });
});

describe('contributionSeries', () => {
  it('accumulates purchases less sales by month', () => {
    const s = contributionSeries([
      fund({
        txns: [
          { date: '2024-01-05', units: 1, amount: 1000 },
          { date: '2024-01-20', units: 1, amount: 500 },
          { date: '2024-03-01', units: -1, amount: 400 },
        ],
      }),
    ]);
    expect(s).toEqual([
      { month: '2024-01', cumulative: 1500 },
      { month: '2024-03', cumulative: 1100 },
    ]);
  });
});

describe('estimates without a statement', () => {
  it('spreads a SIP fund over its instalments and a lump-sum fund over one purchase', () => {
    const sip = approximateFlows(
      { invested: 120_000, startedOn: '2025-10-26', sipMonthly: 10_000, sipStopped: false },
      '2026-10-26',
    );
    expect(sip.length).toBe(13);
    expect(sip.reduce((a, f) => a + f.amount, 0)).toBeCloseTo(120_000);
    expect(
      approximateFlows(
        { invested: 50_000, startedOn: '2024-01-01', sipMonthly: null, sipStopped: false },
        '2026-10-26',
      ),
    ).toEqual([{ date: '2024-01-01', units: 1, amount: 50_000 }]);
    expect(
      approximateFlows(
        { invested: 0, startedOn: '2024-01-01', sipMonthly: null, sipStopped: false },
        '2026-10-26',
      ),
    ).toEqual([]);
    expect(
      approximateFlows(
        { invested: 5, startedOn: null, sipMonthly: null, sipStopped: false },
        '2026-10-26',
      ),
    ).toEqual([]);
  });
  it('gives an estimated return and counts the estimated funds', () => {
    const r = returnsFor(
      [
        fund({
          txns: [],
          value: 121_000,
          plan: { invested: 100_000, startedOn: '2024-10-26', sipMonthly: null, sipStopped: false },
        }),
      ],
      '2026-10-26',
    );
    expect(r.xirr).toBeCloseTo(0.1, 2);
    expect(r.estimatedFunds).toBe(1);
  });
  it('prefers real transactions over the plan', () => {
    const r = returnsFor(
      [
        fund({
          plan: { invested: 1, startedOn: '2000-01-01', sipMonthly: null, sipStopped: false },
        }),
      ],
      '2026-10-26',
    );
    expect(r.estimatedFunds).toBe(0);
  });
});

describe('price moves', () => {
  it('reads the move between the last two prices', () => {
    expect(
      lastNavMove([
        { date: '2026-10-22', nav: 100 },
        { date: '2026-10-23', nav: 101 },
      ]),
    ).toMatchObject({ from: '2026-10-22', to: '2026-10-23' });
    expect(
      lastNavMove([
        { date: '2026-10-22', nav: 100 },
        { date: '2026-10-23', nav: 101 },
      ])!.pct,
    ).toBeCloseTo(0.01);
    expect(lastNavMove([{ date: '2026-10-23', nav: 100 }])).toBeNull();
    expect(
      lastNavMove([
        { date: '2026-10-23', nav: 100 },
        { date: '2026-10-23', nav: 101 },
      ]),
    ).toBeNull();
  });
  it('turns it into rupees', () => {
    expect(moveAmount(101_000, 0.01)).toBeCloseTo(1000);
    expect(moveAmount(99_000, -0.01)).toBeCloseTo(-1000);
  });
});
