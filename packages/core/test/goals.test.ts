import { describe, expect, it } from 'vitest';
import { allocateToGoals } from '../src/goals';

describe('allocateToGoals', () => {
  const holdings = [{ assetId: 'f1', value: 80_000 }];

  it('splits one holding across four goals without creating value', () => {
    const r = allocateToGoals(holdings, [
      { goalId: 'daughter-edu', assetId: 'f1', method: 'percent', value: 40 },
      { goalId: 'son-edu', assetId: 'f1', method: 'percent', value: 30 },
      { goalId: 'marriage', assetId: 'f1', method: 'percent', value: 10 },
      { goalId: 'retirement', assetId: 'f1', method: 'amount', value: 16_000 },
    ]);
    expect(r.status).toBe('ok');
    expect(r.byGoal).toEqual({
      'daughter-edu': 32_000,
      'son-edu': 24_000,
      marriage: 8_000,
      retirement: 16_000,
    });
    expect(r.totalAllocated).toBe(80_000);
    expect(r.unallocatedByAsset.f1).toBe(0);
  });

  it('reports the unallocated remainder', () => {
    const r = allocateToGoals(holdings, [
      { goalId: 'g', assetId: 'f1', method: 'percent', value: 25 },
    ]);
    expect(r.unallocatedByAsset.f1).toBe(60_000);
  });

  it('flags over-allocation instead of clamping it', () => {
    const r = allocateToGoals(holdings, [
      { goalId: 'a', assetId: 'f1', method: 'percent', value: 70 },
      { goalId: 'b', assetId: 'f1', method: 'percent', value: 50 },
    ]);
    expect(r.status).toBe('over_allocated');
    expect(r.problems[0]!.message).toMatch(/exceeds/);
  });

  it('flags amounts larger than the holding', () => {
    expect(
      allocateToGoals(holdings, [{ goalId: 'a', assetId: 'f1', method: 'amount', value: 90_000 }])
        .status,
    ).toBe('over_allocated');
  });

  it('rejects unknown holdings and invalid values', () => {
    expect(
      allocateToGoals(holdings, [{ goalId: 'a', assetId: 'nope', method: 'percent', value: 10 }])
        .status,
    ).toBe('invalid');
    expect(
      allocateToGoals(holdings, [{ goalId: 'a', assetId: 'f1', method: 'percent', value: 101 }])
        .status,
    ).toBe('invalid');
    expect(
      allocateToGoals(holdings, [{ goalId: 'a', assetId: 'f1', method: 'amount', value: -1 }])
        .status,
    ).toBe('invalid');
  });
});

import { futureValue, projectGoal, type GoalPlan } from '../src/goals';

describe('futureValue', () => {
  it('matches closed-form compounding and the annuity-due formula', () => {
    expect(futureValue(100_000, 0, 0.08, 120)).toBeCloseTo(100_000 * Math.pow(1.08, 10), 4);
    const rm = Math.pow(1.1, 1 / 12) - 1;
    expect(futureValue(0, 10_000, 0.1, 120)).toBeCloseTo(
      10_000 * (1 + rm) * ((Math.pow(1 + rm, 120) - 1) / rm),
      3,
    );
    expect(futureValue(5, 3, 0, 10)).toBe(35);
    expect(futureValue(5, 3, 0.1, 0)).toBe(5);
  });
});

describe('projectGoal', () => {
  const base: GoalPlan = {
    targetToday: 4_000_000,
    targetDate: '2036-10-26',
    inflation: 0.09,
    allocatedNow: 4_500_000,
    monthlyContribution: 0,
    annualReturn: 0.1,
    today: '2026-10-26',
  };

  it('inflates the target, grows the earmarked money and shows the gap in both rupees', () => {
    const p = projectGoal({ ...base, allocatedNow: 1_000_000 });
    const years = (Date.parse('2036-10-26') - Date.parse('2026-10-26')) / (365.25 * 86_400_000);
    expect(p.futureCost).toBeCloseTo(4_000_000 * Math.pow(1.09, years), 2);
    expect(p.projectedValue).toBeCloseTo(1_000_000 * Math.pow(1.1, 10), -2);
    expect(p.status).toBe('shortfall');
    expect(p.gapToday!).toBeLessThan(p.gap!);
  });

  it('reports on track when earmarked money plus contributions cover the future cost', () => {
    const p = projectGoal(base);
    expect(p.status).toBe('on_track');
    expect(p.requiredMonthlyExtra).toBe(0);
    expect(p.fundedPct!).toBeGreaterThan(1);
  });

  it('the extra monthly amount needed really closes the gap', () => {
    const short = { ...base, allocatedNow: 500_000, monthlyContribution: 5_000 };
    const p = projectGoal(short);
    expect(p.status).toBe('shortfall');
    const closed = projectGoal({
      ...short,
      monthlyContribution: short.monthlyContribution + p.requiredMonthlyExtra!,
    });
    expect(Math.abs(closed.gap!)).toBeLessThan(1);
  });

  it('refuses to guess without a target, and handles a date in the past', () => {
    expect(projectGoal({ ...base, targetToday: null }).status).toBe('no_target');
    expect(projectGoal({ ...base, targetDate: null }).status).toBe('no_target');
    expect(projectGoal({ ...base, targetDate: '2025-01-01' }).status).toBe('past_due');
  });
});
