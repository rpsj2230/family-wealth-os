import { describe, expect, it } from 'vitest';
import { delayMonths, goalCard, retirementCard } from '../src/digest-goals';
import { summariseGoals, type GoalRowIn } from '../src/goal-summary';
import { futureValue } from '../src/goals';
import { DEFAULT_SETTINGS, buildPlan } from '../src/planning';
import { SCENARIOS, assess } from '../src/retirement';

const today = '2026-10-27';
const goal = (o: Partial<GoalRowIn> & { id: string }): GoalRowIn => ({
  name: o.id,
  kind: 'other',
  targetAmount: 2_000_000,
  targetDate: '2032-10-27',
  inflationRate: 0.06,
  ...o,
});
/** one goal funded by one holding worth `value`, of which `pct` per cent is earmarked, with a SIP of `sip` a month */
const summary = (g: GoalRowIn, value: number, pct: number, sip = 0) =>
  summariseGoals({
    goals: [g],
    allocations: [{ goalId: g.id, assetId: 'a', method: 'percent', value: pct }],
    values: new Map([['a', value]]),
    sips: new Map([['a', sip]]),
    today,
  })[0]!;

describe('summariseGoals', () => {
  it('earmarks a share of a holding and its SIP, and keeps the plan it projected from', () => {
    const s = summary(goal({ id: 'g' }), 1_000_000, 50, 20_000);
    expect(s.allocated).toBe(500_000);
    expect(s.monthly).toBe(10_000);
    expect(s.plan?.annualReturn).toBe(0.08);
    expect(s.targetToday).toBe(2_000_000);
    expect(s.proj.futureCost).toBeCloseTo(2_000_000 * 1.06 ** s.proj.yearsLeft!, 2);
  });

  it('caps an amount allocation at what the holding is worth', () => {
    const s = summariseGoals({
      goals: [goal({ id: 'g' })],
      allocations: [{ goalId: 'g', assetId: 'a', method: 'amount', value: 900_000 }],
      values: new Map([['a', 400_000]]),
      sips: new Map(),
      today,
    })[0]!;
    expect(s.allocated).toBe(400_000);
  });
});

describe('goalCard', () => {
  it('on track: no change needed, no deviation', () => {
    const c = goalCard(summary(goal({ id: 'g' }), 3_000_000, 100, 10_000), 10);
    expect(c.state).toBe('on_track');
    expect(c.chip).toBe('On track');
    expect(c.shortfall).toBeNull();
    expect(c.topUp).toBe(0);
    expect(c.line).toContain('At the current pace you reach');
    expect(c.line).toContain('No change needed');
  });

  it('ahead: the pace lands well past the cost, by more than the margin from Settings', () => {
    const s = summary(goal({ id: 'g' }), 6_000_000, 100, 10_000);
    const c = goalCard(s, 0.1);
    expect(c.state).toBe('ahead');
    expect(c.chip).toMatch(/^Ahead by ₹/);
    expect(c.surplus).toBeCloseTo(-(s.proj.gap ?? 0), 2);
    // the same goal with a wider margin is only on track
    expect(goalCard(s, 5).state).toBe('on_track');
  });

  it('behind: names the shortfall, the delay in months and the extra to add each month', () => {
    const s = summary(goal({ id: 'g' }), 700_000, 100, 8_000);
    const c = goalCard(s, 0.1);
    expect(s.proj.status).toBe('shortfall');
    expect(c.state).toBe('behind');
    expect(c.shortfall).toBeCloseTo(s.proj.gap!, 2);
    expect(c.delayMonths).toBeGreaterThan(0);
    expect(c.chip).toMatch(/^Behind by ₹[\d.,]+ (L|Cr)? ?\(about \d+ (months?|years?)/);
    expect(c.topUp).toBe(Math.round(s.proj.requiredMonthlyExtra!));
    expect(c.line).toContain(`shortfall`);
    expect(c.line).toContain('To be on track add');
    expect(c.line).toContain('a month');
    // saved so far and what the pace reaches, as shares of what is needed, for the bar
    expect(c.savedPct).toBeCloseTo((700_000 / s.proj.futureCost!) * 100, 5);
    expect(c.projectedPct).toBeCloseTo((s.proj.projectedValue! / s.proj.futureCost!) * 100, 5);
  });

  it('adding the monthly top-up really closes the gap (the portal arithmetic)', () => {
    const s = summary(goal({ id: 'g' }), 700_000, 100, 8_000);
    const c = goalCard(s, 0.1);
    const plan = s.plan!;
    const fv = futureValue(
      plan.allocatedNow,
      plan.monthlyContribution + c.topUp + 1, // the top-up is rounded to the rupee
      plan.annualReturn,
      Math.round(s.proj.yearsLeft! * 12),
    );
    expect(fv).toBeGreaterThanOrEqual(s.proj.futureCost! - 1);
  });

  it('not enough data: says what to set, and never guesses', () => {
    const noDate = goalCard(summary(goal({ id: 'g', targetDate: null }), 1_000_000, 50), 0.1);
    expect(noDate.state).toBe('no_data');
    expect(noDate.line).toBe('Not enough data: set a target date.');
    expect(noDate.projected).toBeNull();
    expect(noDate.savedPct).toBeNull();
    const noAmount = goalCard(summary(goal({ id: 'g', targetAmount: null }), 1_000_000, 50), 0.1);
    expect(noAmount.line).toBe('Not enough data: set a target amount.');
    const neither = goalCard(
      summary(goal({ id: 'g', targetAmount: null, targetDate: null }), 1_000_000, 50),
      0.1,
    );
    expect(neither.line).toBe('Not enough data: set a target amount and date.');
    expect(neither.chip).toBe('Not enough data');
  });

  it('a date that has passed is said so, not judged', () => {
    const c = goalCard(summary(goal({ id: 'g', targetDate: '2026-01-01' }), 1_000_000, 50), 0.1);
    expect(c.state).toBe('past_due');
    expect(c.line).toContain('has passed');
  });

  it('a goal with nothing earmarked is behind by the whole cost, with no divide-by-zero', () => {
    const c = goalCard(summary(goal({ id: 'g' }), 0, 0), 0.1);
    expect(c.state).toBe('behind');
    expect(c.saved).toBe(0);
    expect(c.savedPct).toBe(0);
    expect(Number.isFinite(c.topUp)).toBe(true);
  });
});

describe('delayMonths', () => {
  it('is zero when the target is already covered, and counts months past the date otherwise', () => {
    const covered = summary(goal({ id: 'g' }), 5_000_000, 100, 0).plan!;
    expect(delayMonths(covered)).toBe(0);
    const plan = summary(goal({ id: 'g' }), 700_000, 100, 8_000).plan!;
    const late = delayMonths(plan)!;
    expect(late).toBeGreaterThan(0);
    // one month earlier is not enough, the month it names is
    const months = Math.round(
      ((Date.parse(plan.targetDate!) - Date.parse(plan.today)) / 86_400_000 / 365.25) * 12,
    );
    const at = (m: number) =>
      futureValue(plan.allocatedNow, plan.monthlyContribution, plan.annualReturn, m) >=
      plan.targetToday! * (1 + plan.inflation) ** (m / 12);
    expect(at(months + late)).toBe(true);
    expect(at(months + late - 1)).toBe(false);
  });

  it('is null when it never catches up within the horizon', () => {
    const plan = summary(goal({ id: 'g', targetAmount: 90_000_000 }), 100_000, 100, 0).plan!;
    expect(delayMonths(plan, 120)).toBeNull();
  });
});

describe('retirementCard', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    primaryDob: '1980-03-15',
    spouseDob: '1982-06-01',
    monthlySpendingToday: 100_000,
    retireAtAge: 60,
  };
  const make = (
    holdings: { cash: number; equity: number; locked: number },
    sip: number,
    mc = null as null | { successRate: number; runs: number },
  ) => {
    const plan = buildPlan(settings, { ...holdings, excluded: [] }, sip, today);
    const readiness = assess(plan, settings.assumptions);
    return retirementCard({
      plan,
      assumptions: settings.assumptions,
      readiness,
      monteCarlo: mc,
      earliestAge: null,
      aheadMargin: 0.1,
    });
  };

  it('shortfall: needed against projected, the gap, years to go and the extra a month', () => {
    const c = make({ cash: 2_000_000, equity: 3_000_000, locked: 0 }, 20_000, {
      successRate: 0.41,
      runs: 2000,
    });
    expect(c.kind).toBe('retirement');
    expect(c.state).toBe('behind');
    expect(c.name).toBe('Retirement at 60');
    expect(c.shortfall).toBeGreaterThan(0);
    expect(c.needed).toBeGreaterThan(c.projected!);
    expect(c.topUp).toBeGreaterThan(0);
    expect(c.extra?.yearsToGo).toBeCloseTo(13.4, 0);
    expect(c.extra?.successRate).toBe(0.41);
    expect(c.chip).toMatch(/^Behind by ₹/);
    expect(c.line).toContain('shortfall');
    expect(c.line).toContain('more a month');
    expect(c.line).toContain('41%');
    expect(c.date).toBe('2040-03-15');
  });

  it('the monthly top-up closes the gap when invested at the equity return until retirement', () => {
    const c = make({ cash: 2_000_000, equity: 3_000_000, locked: 0 }, 20_000);
    const plan = buildPlan(
      settings,
      { cash: 2_000_000, equity: 3_000_000, locked: 0, excluded: [] },
      20_000 + c.topUp,
      today,
    );
    // the step-up is ignored in the estimate, so the closed plan is at least as good as asked
    expect(assess(plan, settings.assumptions).status).toBe('meets_plan');
  });

  it('on track or ahead: a surplus, no top-up', () => {
    const c = make({ cash: 60_000_000, equity: 40_000_000, locked: 0 }, 50_000);
    expect(['on_track', 'ahead']).toContain(c.state);
    expect(c.surplus).toBeGreaterThan(0);
    expect(c.topUp).toBe(0);
    expect(c.line).toContain('to spare');
  });

  it('not enough data when the plan lacks what it needs', () => {
    const plan = buildPlan(
      { ...settings, monthlySpendingToday: 0 },
      { cash: 1, equity: 1, locked: 0, excluded: [] },
      0,
      today,
    );
    const readiness = assess(plan, SCENARIOS.base);
    const c = retirementCard({ plan, assumptions: SCENARIOS.base, readiness, aheadMargin: 0.1 });
    expect(c.state).toBe('no_data');
    expect(c.line).toContain('Not enough data');
    expect(c.projectedPct).toBeNull();
  });

  it('leaves the chance out when the Monte Carlo run was not made', () => {
    const c = make({ cash: 2_000_000, equity: 3_000_000, locked: 0 }, 20_000, null);
    expect(c.extra?.successRate).toBeNull();
    expect(c.line).not.toContain('chance');
  });
});
