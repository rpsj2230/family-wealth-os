import { describe, expect, it } from 'vitest';
import { carryForward, estimateFd, estimateSavings } from '../src/estimate';
import { aggregateNetWorth, type ValuedAsset } from '../src/networth';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-26');

const cash = (id: string, owner: string, amount: number): ValuedAsset => ({
  assetId: id,
  ownerId: owner,
  type: 'bank_account',
  status: 'active',
  name: id,
  estimate: carryForward({ amount, asOf: d('2026-10-25'), today }),
});

describe('aggregateNetWorth', () => {
  it('sums by owner, type and liquidity', () => {
    const r = aggregateNetWorth([
      cash('a', 'rupash', 1_000_000),
      cash('b', 'ragini', 500_000),
      {
        assetId: 'mf1',
        ownerId: 'rupash',
        type: 'mutual_fund',
        status: 'active',
        name: 'MF',
        estimate: carryForward({ amount: 300_000, asOf: d('2026-10-20'), today }),
      },
      {
        assetId: 'prop',
        ownerId: 'rupash',
        type: 'property',
        status: 'active',
        name: 'Flat',
        estimate: carryForward({ amount: 2_500_000, asOf: d('2023-12-15'), today }),
      },
    ]);
    expect(r.total).toBe(4_300_000);
    expect(r.byOwner).toEqual({ rupash: 3_800_000, ragini: 500_000 });
    expect(r.byLiquidity).toEqual({
      liquid: 1_500_000,
      investable: 300_000,
      retirement: 0,
      illiquid: 2_500_000,
    });
    expect(r.investableFinancial).toBe(1_800_000);
  });

  it('never counts insurance cover, and lists it as excluded with a reason', () => {
    const r = aggregateNetWorth([
      cash('a', 'rupash', 100),
      {
        assetId: 'term',
        ownerId: 'rupash',
        type: 'policy',
        status: 'active',
        name: 'Term 1.5 Cr',
        estimate: carryForward({ amount: 15_000_000, asOf: today, today }),
      },
    ]);
    expect(r.total).toBe(100);
    expect(r.excluded).toEqual([
      { assetId: 'term', name: 'Term 1.5 Cr', reason: 'insurance_cover_not_wealth', amount: null },
    ]);
  });

  it('excludes matured-unconfirmed FDs and shows their amount, so nothing disappears silently', () => {
    const fd: ValuedAsset = {
      assetId: 'rbl',
      ownerId: 'rupash',
      type: 'fixed_deposit',
      status: 'matured_unconfirmed',
      name: 'RBL FD',
      estimate: estimateFd({
        principal: 500_000,
        annualRate: 0.0775,
        bookedOn: d('2025-05-12'),
        today,
        maturityOn: d('2026-09-23'),
      }),
    };
    const r = aggregateNetWorth([cash('a', 'rupash', 1000), fd]);
    expect(r.total).toBe(1000);
    expect(r.excluded[0]).toMatchObject({ assetId: 'rbl', reason: 'status_not_counted' });
    expect(r.excluded[0]!.amount).toBeGreaterThan(550_000);
  });

  it('never counts money given away as a gift', () => {
    const gift: ValuedAsset = {
      assetId: 'gift',
      ownerId: 'rupash',
      type: 'receivable',
      status: 'gifted',
      name: 'Gift to a cousin',
      estimate: cash('x', 'rupash', 250_000).estimate,
    };
    const r = aggregateNetWorth([cash('a', 'rupash', 1000), gift]);
    expect(r.total).toBe(1000);
    expect(r.excluded[0]).toMatchObject({
      assetId: 'gift',
      reason: 'status_not_counted',
      amount: 250_000,
    });
  });

  it('reports missing valuations instead of treating them as zero', () => {
    const r = aggregateNetWorth([{ ...cash('x', 'rupash', 0), estimate: null }]);
    expect(r.total).toBe(0);
    expect(r.counted).toBe(0);
    expect(r.excluded[0]!.reason).toBe('no_valuation');
  });

  it('rejects duplicate assets (double counting guard)', () => {
    expect(() => aggregateNetWorth([cash('a', 'rupash', 1), cash('a', 'rupash', 1)])).toThrow(
      /duplicate/,
    );
  });

  it('keeps receivables and third-party-held money out of liquid and investable', () => {
    const r = aggregateNetWorth([
      {
        assetId: 'loan',
        ownerId: 'rupash',
        type: 'receivable',
        status: 'active',
        name: 'Loan',
        estimate: carryForward({ amount: 200_000, asOf: today, today }),
      },
      {
        assetId: 'tp',
        ownerId: 'rupash',
        type: 'third_party_held',
        status: 'active',
        name: 'Held by other',
        estimate: carryForward({ amount: 27_866, asOf: today, today }),
      },
    ]);
    expect(r.byLiquidity.illiquid).toBe(227_866);
    expect(r.investableFinancial).toBe(0);
  });

  it('splits the change since the verified date into interest vs market', () => {
    const r = aggregateNetWorth([
      {
        ...cash('s', 'rupash', 0),
        estimate: estimateSavings({
          balance: 1_000_000,
          balanceAsOf: d('2026-09-26'),
          today,
          annualRate: 0.03,
        }),
      },
    ]);
    expect(r.estimateTotals.anchorTotal).toBe(1_000_000);
    expect(r.estimateTotals.interest).toBeCloseTo((1_000_000 * 0.03 * 30) / 365, 6);
    expect(r.estimateTotals.market).toBe(0);
  });
});
