import { describe, expect, it } from 'vitest';
import {
  SCENARIOS,
  ageOn,
  assess,
  constantRates,
  earliestRetirementAge,
  levers,
  monteCarlo,
  monthsToEnd,
  monthsToRetire,
  simulate,
  type Assumptions,
  type RetirementPlan,
} from '../src/retirement';

const flat = (r: number, infl: number): Assumptions => ({
  equityReturn: r,
  cashReturn: r,
  lockedReturn: r,
  inflation: infl,
  healthcareInflation: infl,
  equityVol: 0,
  cashVol: 0,
  inflationVol: 0,
});

const basePlan = (o: Partial<RetirementPlan> = {}): RetirementPlan => ({
  asOf: '2026-10-26',
  primaryDob: '1988-06-10',
  spouseDob: '1992-08-20',
  retireAtAge: 60,
  planningEndAge: 95,
  holdings: { cash: 0, equity: 0, locked: 0 },
  lockedUnlockAge: 60,
  contributions: { monthlyEquity: 0, monthlyCash: 0, annualStepUp: 0 },
  spending: { monthlyToday: 100_000, healthcareShare: 0 },
  pensions: [],
  oneOffs: [],
  legacyToday: 0,
  retirementEquityShare: 0.5,
  withdrawalTaxRate: 0,
  withdrawalSequence: ['cash', 'equity', 'locked'],
  ...o,
});

describe('dates', () => {
  it('computes ages and the planning horizon from the younger spouse', () => {
    const p = basePlan();
    expect(ageOn(p.primaryDob, p.asOf)).toBeCloseTo(38.38, 1);
    expect(monthsToRetire(p)).toBe(Math.ceil((60 - ageOn(p.primaryDob, p.asOf)) * 12 - 1e-9));
    // wife (born 1992) reaches 95 in 2087: about 60.8 years from now
    expect(monthsToEnd(p) / 12).toBeCloseTo(95 - ageOn('1992-08-20', p.asOf), 1);
    expect(monthsToEnd({ ...p, spouseDob: null }) / 12).toBeCloseTo(
      95 - ageOn(p.primaryDob, p.asOf),
      1,
    );
  });
});

describe('accumulation matches closed-form finance', () => {
  it('lump sum grows at the stated annual return', () => {
    const p = basePlan({
      primaryDob: '1996-10-26',
      retireAtAge: 40,
      holdings: { cash: 0, equity: 100_000, locked: 0 },
      retirementEquityShare: 1,
    });
    const sim = simulate(p, constantRates(flat(0.08, 0.05)));
    expect(sim.retireMonth).toBe(120);
    expect(sim.atRetirement.equity).toBeCloseTo(100_000 * Math.pow(1.08, 10), 2);
  });

  it('monthly contributions equal the annuity-due formula', () => {
    const p = basePlan({
      primaryDob: '1996-10-26',
      retireAtAge: 40,
      contributions: { monthlyEquity: 10_000, monthlyCash: 0, annualStepUp: 0 },
      retirementEquityShare: 1,
    });
    const rm = Math.pow(1.1, 1 / 12) - 1;
    const fv = 10_000 * (1 + rm) * ((Math.pow(1 + rm, 120) - 1) / rm);
    const sim = simulate(p, constantRates(flat(0.1, 0.05)));
    expect(sim.atRetirement.accessible).toBeCloseTo(fv, 1);
  });

  it('annual step-up raises later contributions', () => {
    const flatP = basePlan({
      primaryDob: '1996-10-26',
      retireAtAge: 36,
      contributions: { monthlyEquity: 1000, monthlyCash: 0, annualStepUp: 0 },
    });
    const up = basePlan({
      primaryDob: '1996-10-26',
      retireAtAge: 36,
      contributions: { monthlyEquity: 1000, monthlyCash: 0, annualStepUp: 0.1 },
    });
    const r = constantRates(flat(0, 0));
    expect(simulate(flatP, r).atRetirement.accessible).toBeCloseTo(1000 * 72, 4);
    // year 1: 12 x 1000, year 2: 12 x 1100, ... six years
    const expected = Array.from({ length: 6 }, (_, y) => 12 * 1000 * Math.pow(1.1, y)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(simulate(up, r).atRetirement.accessible).toBeCloseTo(expected, 4);
  });

  it('pays pre-retirement goals from cash then equity, and reports what could not be funded', () => {
    const p = basePlan({
      primaryDob: '1996-10-26',
      retireAtAge: 40,
      holdings: { cash: 50_000, equity: 50_000, locked: 0 },
      oneOffs: [
        { label: 'Education', atAge: 35, amountToday: 80_000, inflation: 0 },
        { label: 'Wedding', atAge: 36, amountToday: 80_000, inflation: 0 },
      ],
    });
    const sim = simulate(p, constantRates(flat(0, 0)));
    expect(sim.atRetirement.accessible).toBe(0);
    expect(sim.unfundedGoals).toBeCloseTo(60_000, 4);
  });
});

describe('required corpus matches the annuity formula', () => {
  it('retire now, constant return and inflation, no legacy', () => {
    const r = 0.08,
      i = 0.05;
    const p = basePlan({
      retireAtAge: 38.4,
      spouseDob: null,
      planningEndAge: 68.38,
      holdings: { cash: 1, equity: 0, locked: 0 },
      contributions: { monthlyEquity: 1, monthlyCash: 0, annualStepUp: 0 },
    });
    const rd = assess(p, flat(r, i));
    const rm = Math.pow(1 + r, 1 / 12) - 1;
    const im = Math.pow(1 + i, 1 / 12) - 1;
    const N = monthsToEnd(p);
    const M = monthsToRetire(p);
    // withdrawals at start of each month, growth after: PV = sum_{k=0}^{N-M-1} S (1+im)^(M+k) / (1+rm)^k  (cpi at retirement = (1+im)^M)
    let pv = 0;
    for (let k = 0; k < N - M; k++) pv += (100_000 * Math.pow(1 + im, M + k)) / Math.pow(1 + rm, k);
    expect(rd.requiredAccessible!).toBeCloseTo(pv, 0);
  });

  it('a legacy target adds its discounted value', () => {
    const p0 = basePlan({
      retireAtAge: 38.4,
      spouseDob: null,
      planningEndAge: 58.38,
      holdings: { cash: 1, equity: 0, locked: 0 },
      contributions: { monthlyEquity: 1, monthlyCash: 0, annualStepUp: 0 },
    });
    const a = flat(0.08, 0.05);
    const without = assess(p0, a).requiredAccessible!;
    const withLegacy = assess({ ...p0, legacyToday: 5_000_000 }, a).requiredAccessible!;
    const rm = Math.pow(1.08, 1 / 12) - 1;
    const im = Math.pow(1.05, 1 / 12) - 1;
    const n = monthsToEnd(p0) - monthsToRetire(p0);
    // legacy is in today's rupees: nominal at the end = legacy x cpi_end; discounted back n months at the return
    const extra = (5_000_000 * Math.pow(1 + im, monthsToEnd(p0))) / Math.pow(1 + rm, n);
    expect(withLegacy - without).toBeCloseTo(extra, 0);
  });

  it('pensions and taxes move the requirement in the right direction', () => {
    const p = basePlan({
      retireAtAge: 50,
      holdings: { cash: 1, equity: 0, locked: 0 },
      contributions: { monthlyEquity: 1, monthlyCash: 0, annualStepUp: 0 },
    });
    const a = SCENARIOS.base;
    const plain = assess(p, a).requiredAccessible!;
    const withPension = assess(
      { ...p, pensions: [{ startAge: 60, monthlyToday: 30_000, indexed: true }] },
      a,
    ).requiredAccessible!;
    const withTax = assess({ ...p, withdrawalTaxRate: 0.1 }, a).requiredAccessible!;
    expect(withPension).toBeLessThan(plain);
    expect(withTax).toBeGreaterThan(plain);
  });

  it('healthcare inflation above general inflation raises the requirement', () => {
    const p = basePlan({
      retireAtAge: 50,
      spending: { monthlyToday: 100_000, healthcareShare: 0.3 },
      holdings: { cash: 1, equity: 0, locked: 0 },
      contributions: { monthlyEquity: 1, monthlyCash: 0, annualStepUp: 0 },
    });
    const same = assess(p, flat(0.08, 0.05)).requiredAccessible!;
    const higher = assess(p, {
      ...flat(0.08, 0.05),
      healthcareInflation: 0.09,
    }).requiredAccessible!;
    expect(higher).toBeGreaterThan(same);
  });
});

describe('readiness status', () => {
  it('refuses a verdict when essential inputs are missing, and says which', () => {
    const r = assess(
      basePlan({
        spending: { monthlyToday: 0, healthcareShare: 0 },
        holdings: { cash: 0, equity: 0, locked: 0 },
      }),
      SCENARIOS.base,
    );
    expect(r.status).toBe('insufficient_data');
    expect(r.missing).toEqual(
      expect.arrayContaining([
        'monthly spending after retirement',
        'any retirement-eligible assets',
      ]),
    );
    expect(r.requiredAccessible).toBeNull();
  });

  it('meets the plan with ample assets and reports a surplus', () => {
    const p = basePlan({
      retireAtAge: 50,
      holdings: { cash: 20_000_000, equity: 100_000_000, locked: 0 },
      contributions: { monthlyEquity: 50_000, monthlyCash: 0, annualStepUp: 0.05 },
    });
    const r = assess(p, SCENARIOS.base);
    expect(r.status).toBe('meets_plan');
    expect(r.surplus!).toBeGreaterThan(0);
  });

  it('reports a shortfall when assets are too small, with the gap', () => {
    const p = basePlan({
      retireAtAge: 45,
      holdings: { cash: 500_000, equity: 1_000_000, locked: 0 },
      contributions: { monthlyEquity: 10_000, monthlyCash: 0, annualStepUp: 0 },
    });
    const r = assess(p, SCENARIOS.base);
    expect(r.status).toBe('shortfall');
    expect(r.surplus!).toBeLessThan(0);
  });

  it('runs out of money in the simulation exactly when the corpus is too small', () => {
    const p = basePlan({
      retireAtAge: 38.4,
      spouseDob: null,
      planningEndAge: 48.4,
      holdings: { cash: 1_000_000, equity: 0, locked: 0 },
      retirementEquityShare: 0,
    });
    const sim = simulate(p, constantRates(flat(0, 0)));
    expect(sim.success).toBe(false);
    // 1,000,000 / 100,000 per month = 10 full months of spending, so the 11th month after retirement fails
    expect(sim.ruinMonth).toBe(sim.retireMonth + 10);
    expect(sim.ruinAge!).toBeCloseTo(ageOn(p.primaryDob, p.asOf) + (sim.retireMonth + 10) / 12, 6);
  });

  it('locked assets are not usable before their unlock age', () => {
    const p = basePlan({
      retireAtAge: 38.4,
      spouseDob: null,
      planningEndAge: 40,
      holdings: { cash: 0, equity: 0, locked: 100_000_000 },
      lockedUnlockAge: 60,
      retirementEquityShare: 0,
    });
    expect(simulate(p, constantRates(flat(0.05, 0.05))).success).toBe(false);
    expect(simulate({ ...p, lockedUnlockAge: 38 }, constantRates(flat(0.05, 0.05))).success).toBe(
      true,
    );
  });
});

describe('earliest retirement age', () => {
  const rich = basePlan({
    holdings: { cash: 10_000_000, equity: 20_000_000, locked: 0 },
    contributions: { monthlyEquity: 115_000, monthlyCash: 0, annualStepUp: 0.05 },
  });
  it('finds a first age at which the plan is met and lists every age tested', () => {
    const e = earliestRetirementAge(rich, SCENARIOS.base);
    expect(e.table.length).toBeGreaterThan(5);
    if (e.earliest !== null) {
      const row = e.table.find((r) => r.age === e.earliest)!;
      expect(row.status).toBe('meets_plan');
      expect(
        e.table.filter((r) => r.age < e.earliest!).every((r) => r.status !== 'meets_plan'),
      ).toBe(true);
    }
  });
  it('is never earlier under tougher assumptions', () => {
    const base = earliestRetirementAge(rich, SCENARIOS.base).earliest;
    const tough = earliestRetirementAge(rich, SCENARIOS.conservative).earliest;
    if (base !== null && tough !== null) expect(tough).toBeGreaterThanOrEqual(base);
    if (base === null) expect(tough).toBeNull();
  });
  it('stops with insufficient data instead of inventing an age', () => {
    const e = earliestRetirementAge(
      basePlan({ spending: { monthlyToday: 0, healthcareShare: 0 } }),
      SCENARIOS.base,
    );
    expect(e.earliest).toBeNull();
    expect(e.table[0]!.status).toBe('insufficient_data');
  });
});

describe('Monte Carlo', () => {
  const plan = basePlan({
    retireAtAge: 55,
    holdings: { cash: 5_000_000, equity: 15_000_000, locked: 0 },
    contributions: { monthlyEquity: 115_000, monthlyCash: 0, annualStepUp: 0.05 },
  });

  it('is reproducible for a seed and different for another', () => {
    const a = monteCarlo(plan, SCENARIOS.base, 300, 7);
    const b = monteCarlo(plan, SCENARIOS.base, 300, 7);
    const c = monteCarlo(plan, SCENARIOS.base, 300, 8);
    expect(a).toEqual(b);
    expect(a.finalRealPercentiles.p50).not.toBe(c.finalRealPercentiles.p50);
  });

  it('with zero volatility it agrees with the deterministic run', () => {
    const calm: Assumptions = { ...SCENARIOS.base, equityVol: 0, cashVol: 0, inflationVol: 0 };
    const det = simulate(plan, constantRates(calm));
    const mc = monteCarlo(plan, calm, 50, 1);
    expect(mc.successRate).toBe(det.success ? 1 : 0);
    expect(mc.finalRealPercentiles.p50).toBeCloseTo(det.finalReal, 0);
  });

  it('orders percentiles and keeps probabilities in [0,1]', () => {
    const mc = monteCarlo(plan, SCENARIOS.base, 400, 3);
    expect(mc.finalRealPercentiles.p10).toBeLessThanOrEqual(mc.finalRealPercentiles.p50);
    expect(mc.finalRealPercentiles.p50).toBeLessThanOrEqual(mc.finalRealPercentiles.p90);
    expect(mc.successRate).toBeGreaterThanOrEqual(0);
    expect(mc.successRate).toBeLessThanOrEqual(1);
  });

  it('for a well-funded plan, more volatility raises the chance of running out of money', () => {
    const lowVol = monteCarlo(plan, { ...SCENARIOS.base, equityVol: 0.05 }, 400, 11);
    const hiVol = monteCarlo(plan, { ...SCENARIOS.base, equityVol: 0.3 }, 400, 11);
    expect(hiVol.ruinBeforeEnd).toBeGreaterThan(lowVol.ruinBeforeEnd);
  });
});

describe('levers', () => {
  it('returns the variants with an age and a surplus for each, and "as planned" first', () => {
    const p = basePlan({
      retireAtAge: 55,
      holdings: { cash: 5_000_000, equity: 15_000_000, locked: 0 },
      contributions: { monthlyEquity: 115_000, monthlyCash: 0, annualStepUp: 0.05 },
    });
    const l = levers(p, SCENARIOS.base);
    expect(l[0]!.label).toBe('As planned');
    expect(l.length).toBeGreaterThanOrEqual(8);
    const more = l.find((x) => x.label.includes('₹50,000'))!;
    expect(more.surplusRealAtChosenAge!).toBeGreaterThan(l[0]!.surplusRealAtChosenAge!);
    const worse = l.find((x) => x.label.includes('Returns 2 points lower'))!;
    expect(worse.surplusRealAtChosenAge!).toBeLessThan(l[0]!.surplusRealAtChosenAge!);
  });

  it('includes stress cases that each leave the plan worse off than as planned', () => {
    const p = basePlan({
      retireAtAge: 55,
      holdings: { cash: 5_000_000, equity: 15_000_000, locked: 0 },
      contributions: { monthlyEquity: 115_000, monthlyCash: 0, annualStepUp: 0.05 },
    });
    const l = levers(p, SCENARIOS.base);
    const base = l[0]!.surplusRealAtChosenAge!;
    for (const label of [
      'Equity returns 4 points lower',
      'Inflation 3 points higher',
      'Spending 20% higher',
      'Monthly investing falls by half',
      'Retire 2 years earlier',
    ]) {
      const row = l.find((x) => x.label.startsWith(label));
      expect(row, label).toBeDefined();
      expect(row!.surplusRealAtChosenAge!, label).toBeLessThan(base);
    }
  });
});
