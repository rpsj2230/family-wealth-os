import { carryForward, estimateFd } from '../src/estimate';
import type { ValuedAsset } from '../src/networth';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, buildPlan, holdingsFromAssets, settingsFromJson } from '../src/planning';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-26');
const v = (type: ValuedAsset['type'], amount: number, status = 'active'): ValuedAsset => ({
  assetId: type + amount,
  ownerId: 'o',
  type,
  status,
  name: type,
  estimate: carryForward({ amount, asOf: today, today }),
});

describe('holdingsFromAssets', () => {
  it('maps asset types to corpus buckets and keeps illiquid assets out, listing them', () => {
    const h = holdingsFromAssets([
      v('bank_account', 100),
      v('fixed_deposit', 200),
      v('mutual_fund', 300),
      v('stock', 50),
      v('ulip', 7),
      v('property', 2_500_000),
      v('receivable', 200_000),
      v('third_party_held', 27_000),
      v('policy', 15_000_000),
    ]);
    expect(h).toMatchObject({ cash: 300, equity: 350, locked: 7 });
    expect(h.excluded.map((e) => e.label).sort()).toEqual([
      'Money held by others',
      'Money lent to others',
      'Property (not sold)',
    ]);
  });
  it('ignores matured-unconfirmed deposits and assets without a valuation', () => {
    const fd: ValuedAsset = {
      assetId: 'x',
      ownerId: 'o',
      type: 'fixed_deposit',
      status: 'matured_unconfirmed',
      name: 'x',
      estimate: estimateFd({
        principal: 500_000,
        annualRate: 0.08,
        bookedOn: d('2025-01-01'),
        today,
        maturityOn: d('2026-09-23'),
      }),
    };
    const none: ValuedAsset = {
      assetId: 'y',
      ownerId: 'o',
      type: 'bank_account',
      status: 'active',
      name: 'y',
      estimate: null,
    };
    expect(holdingsFromAssets([fd, none])).toMatchObject({ cash: 0, equity: 0, locked: 0 });
  });
});

describe('settingsFromJson', () => {
  it('returns safe defaults for empty or junk input', () => {
    expect(settingsFromJson(null)).toEqual(DEFAULT_SETTINGS);
    expect(settingsFromJson('x')).toEqual(DEFAULT_SETTINGS);
    expect(
      settingsFromJson({ retireAtAge: 'soon', monthlySpendingToday: -5, primaryDob: 'yesterday' }),
    ).toEqual(DEFAULT_SETTINGS);
  });
  it('keeps valid values and drops invalid one-offs', () => {
    const s = settingsFromJson({
      primaryDob: '1990-01-01',
      retireAtAge: 55,
      monthlySpendingToday: 150000,
      scenario: 'conservative',
      assumptions: { equityReturn: 0.07 },
      oneOffs: [
        { label: 'Education', atAge: 49, amountToday: 4_000_000, inflation: 0.09 },
        { label: 'bad', atAge: 'x', amountToday: 1 },
      ],
    });
    expect(s.retireAtAge).toBe(55);
    expect(s.assumptions.equityReturn).toBe(0.07);
    expect(s.assumptions.inflation).toBe(0.065); // conservative preset fills the rest
    expect(s.oneOffs).toHaveLength(1);
  });
});

describe('buildPlan', () => {
  it('adds existing SIPs to the extra equity contribution and passes spending through', () => {
    const plan = buildPlan(
      {
        ...DEFAULT_SETTINGS,
        monthlySpendingToday: 150_000,
        extraMonthlyEquity: 10_000,
        extraMonthlyCash: 5_000,
      },
      { cash: 1, equity: 2, locked: 3, excluded: [] },
      115_000,
      '2026-10-26',
    );
    expect(plan.contributions).toMatchObject({ monthlyEquity: 125_000, monthlyCash: 5_000 });
    expect(plan.spending.monthlyToday).toBe(150_000);
    expect(plan.holdings).toEqual({ cash: 1, equity: 2, locked: 3 });
  });
});
