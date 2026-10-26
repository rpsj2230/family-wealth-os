/**
 * Retirement readiness engine.
 *
 * A month-by-month cash-flow simulation (not a "25× expenses" shortcut):
 *   accumulation  -> contributions, goal outflows and growth until the chosen retirement age
 *   retirement    -> inflation-indexed spending, pensions, one-off costs, withdrawals from a configurable
 *                    sequence of buckets, growth on what remains, until the younger spouse reaches the planning age
 *
 * Everything is in INR. Inputs are stated in today's money; the engine inflates them. Nothing here is a forecast:
 * results are conditional on the assumptions passed in, and the caller must show them.
 *
 * Conventions (documented because they decide the numbers):
 *   - monthly steps; annual rates are converted with (1+r)^(1/12)-1
 *   - contributions are made at the start of the month; withdrawals are taken at the start of the month, and
 *     growth is applied afterwards to what remains (conservative)
 *   - at retirement the accessible assets (cash + equity) are rebalanced to `retirementEquityShare`
 *   - locked assets (NPS/ULIP) can be drawn only from `lockedUnlockAge`
 *   - illiquid assets (property, loans, third-party money) are NOT part of the corpus
 */

export type Bucket = 'cash' | 'equity' | 'locked';

export interface Assumptions {
  equityReturn: number;
  cashReturn: number;
  lockedReturn: number;
  inflation: number;
  healthcareInflation: number;
  /** annual volatility used only by the Monte Carlo run */
  equityVol: number;
  cashVol: number;
  inflationVol: number;
}

export interface Pension {
  startAge: number;
  monthlyToday: number;
  indexed: boolean;
}

export interface OneOff {
  label: string;
  /** primary person's age when the cost falls due */
  atAge: number;
  amountToday: number;
  /** own annual inflation (e.g. education); defaults to general inflation */
  inflation?: number;
}

export interface RetirementPlan {
  asOf: string; // YYYY-MM-DD
  primaryDob: string;
  spouseDob: string | null;
  retireAtAge: number;
  /** the plan must last until the younger of the two reaches this age */
  planningEndAge: number;
  holdings: { cash: number; equity: number; locked: number };
  lockedUnlockAge: number;
  contributions: { monthlyEquity: number; monthlyCash: number; annualStepUp: number };
  spending: { monthlyToday: number; healthcareShare: number };
  pensions: Pension[];
  oneOffs: OneOff[];
  legacyToday: number;
  retirementEquityShare: number;
  /** fraction of each withdrawal lost to tax (0 = tax not modelled) */
  withdrawalTaxRate: number;
  withdrawalSequence: Bucket[];
}

export interface PathPoint {
  month: number;
  age: number;
  phase: 'accumulation' | 'retirement';
  cash: number;
  equity: number;
  locked: number;
  nominal: number;
  real: number;
}

export interface SimResult {
  success: boolean;
  ruinMonth: number | null;
  ruinAge: number | null;
  retireMonth: number;
  endMonth: number;
  atRetirement: {
    cash: number;
    equity: number;
    locked: number;
    accessible: number;
    nominal: number;
    real: number;
  };
  finalNominal: number;
  finalReal: number;
  /** goal outflows before retirement that could not be paid from cash/equity (₹, nominal) */
  unfundedGoals: number;
  path: PathPoint[];
}

export type RateSource = (month: number) => {
  equity: number;
  cash: number;
  locked: number;
  inflation: number;
  healthcare: number;
};

// -------------------------------------------------------------------------------------------------
// Dates and rates
// -------------------------------------------------------------------------------------------------
const utc = (s: string) => new Date(s + 'T00:00:00Z').getTime();

/** Age in years using calendar months (so a 30th birthday is exactly 30.0, not 29.9993). */
export function ageOn(dob: string, on: string): number {
  const [y1, m1, d1] = dob.split('-').map(Number) as [number, number, number];
  const [y2, m2, d2] = on.split('-').map(Number) as [number, number, number];
  const daysInMonth = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  return ((y2 - y1) * 12 + (m2 - m1) + (d2 - d1) / daysInMonth) / 12;
}

const monthly = (annual: number) => Math.pow(1 + annual, 1 / 12) - 1;

export function constantRates(a: Assumptions): RateSource {
  const r = {
    equity: monthly(a.equityReturn),
    cash: monthly(a.cashReturn),
    locked: monthly(a.lockedReturn),
    inflation: monthly(a.inflation),
    healthcare: monthly(a.healthcareInflation),
  };
  return () => r;
}

/** Months from `asOf` until the younger of the two reaches `planningEndAge`. */
export function monthsToEnd(plan: RetirementPlan): number {
  const youngest =
    plan.spouseDob && utc(plan.spouseDob) > utc(plan.primaryDob) ? plan.spouseDob : plan.primaryDob;
  const yearsLeft = plan.planningEndAge - ageOn(youngest, plan.asOf);
  const m = Math.round(yearsLeft * 12);
  return Number.isFinite(m) ? Math.max(0, m) : 0;
}

export function monthsToRetire(plan: RetirementPlan): number {
  const m = Math.ceil((plan.retireAtAge - ageOn(plan.primaryDob, plan.asOf)) * 12 - 1e-9);
  return Number.isFinite(m) ? Math.max(0, m) : 0;
}

// -------------------------------------------------------------------------------------------------
// Core simulation
// -------------------------------------------------------------------------------------------------
interface State {
  cash: number;
  equity: number;
  locked: number;
  cpi: number;
  health: number;
}

function draw(state: State, amount: number, order: Bucket[], lockedOpen: boolean): number {
  let left = amount;
  for (const b of order) {
    if (left <= 0) break;
    if (b === 'locked' && !lockedOpen) continue;
    const take = Math.min(state[b], left);
    state[b] -= take;
    left -= take;
  }
  return left; // amount that could not be paid
}

export function simulate(
  plan: RetirementPlan,
  rates: RateSource,
  opts: { startState?: Partial<State>; skipAccumulation?: boolean } = {},
): SimResult {
  const ageNow = ageOn(plan.primaryDob, plan.asOf);
  const retireMonth = monthsToRetire(plan);
  const endMonth = Math.max(retireMonth, monthsToEnd(plan));
  const s: State = { ...plan.holdings, cpi: 1, health: 1, ...opts.startState };
  const path: PathPoint[] = [];
  const point = (m: number, phase: PathPoint['phase']) => {
    const nominal = s.cash + s.equity + s.locked;
    path.push({
      month: m,
      age: ageNow + m / 12,
      phase,
      cash: s.cash,
      equity: s.equity,
      locked: s.locked,
      nominal,
      real: nominal / s.cpi,
    });
  };
  const doneOneOffs = new Set<number>();
  let unfundedGoals = 0;
  let ruinMonth: number | null = null;
  const seqPre: Bucket[] = ['cash', 'equity'];

  const dueOneOffs = (m: number) => {
    const due: number[] = [];
    plan.oneOffs.forEach((o, i) => {
      if (!doneOneOffs.has(i) && ageNow + m / 12 >= o.atAge - 1e-9) {
        doneOneOffs.add(i);
        due.push(i);
      }
    });
    return due;
  };
  const oneOffNominal = (i: number, m: number, cpi: number) => {
    const o = plan.oneOffs[i]!;
    return o.amountToday * (o.inflation === undefined ? cpi : Math.pow(1 + o.inflation, m / 12));
  };

  let m = 0;
  // ---- accumulation ----
  if (!opts.skipAccumulation) {
    let stepUp = 1;
    for (; m < retireMonth; m++) {
      if (m % 12 === 0) point(m, 'accumulation');
      if (m > 0 && m % 12 === 0) stepUp *= 1 + plan.contributions.annualStepUp;
      s.equity += plan.contributions.monthlyEquity * stepUp;
      s.cash += plan.contributions.monthlyCash * stepUp;
      for (const i of dueOneOffs(m)) {
        const unpaid = draw(s, oneOffNominal(i, m, s.cpi), seqPre, false);
        unfundedGoals += unpaid;
      }
      const r = rates(m);
      s.cash *= 1 + r.cash;
      s.equity *= 1 + r.equity;
      s.locked *= 1 + r.locked;
      s.cpi *= 1 + r.inflation;
      s.health *= 1 + r.healthcare;
    }
  } else {
    m = retireMonth;
    // costs that fell due before retirement were already handled by the full run; do not count them again
    plan.oneOffs.forEach((o, i) => {
      if (ageNow + (retireMonth - 1) / 12 >= o.atAge - 1e-9) doneOneOffs.add(i);
    });
  }

  // ---- rebalance accessible assets at retirement ----
  const accessible = s.cash + s.equity;
  s.equity = accessible * plan.retirementEquityShare;
  s.cash = accessible - s.equity;
  const atRetirement = {
    cash: s.cash,
    equity: s.equity,
    locked: s.locked,
    accessible,
    nominal: accessible + s.locked,
    real: (accessible + s.locked) / s.cpi,
  };
  point(m, 'retirement');

  // ---- retirement ----
  for (; m < endMonth; m++) {
    if (m % 12 === 0 && m !== retireMonth) point(m, 'retirement');
    const age = ageNow + m / 12;
    const hs = plan.spending.healthcareShare;
    const spend = plan.spending.monthlyToday * ((1 - hs) * s.cpi + hs * s.health);
    let income = 0;
    for (const p of plan.pensions)
      if (age >= p.startAge) income += p.monthlyToday * (p.indexed ? s.cpi : 1);
    let oneOff = 0;
    for (const i of dueOneOffs(m)) oneOff += oneOffNominal(i, m, s.cpi);
    const need = spend + oneOff - income;
    if (need > 0) {
      const gross = need / (1 - plan.withdrawalTaxRate);
      const unpaid = draw(s, gross, plan.withdrawalSequence, age >= plan.lockedUnlockAge);
      if (unpaid > 0.5 && ruinMonth === null) ruinMonth = m;
    } else {
      s.cash += -need; // surplus pension income is kept
    }
    const r = rates(m);
    s.cash *= 1 + r.cash;
    s.equity *= 1 + r.equity;
    s.locked *= 1 + r.locked;
    s.cpi *= 1 + r.inflation;
    s.health *= 1 + r.healthcare;
  }
  point(endMonth, 'retirement');

  const finalNominal = s.cash + s.equity + s.locked;
  const finalReal = finalNominal / s.cpi;
  const success = ruinMonth === null && finalReal + 1e-6 >= plan.legacyToday;
  return {
    success,
    ruinMonth,
    ruinAge: ruinMonth === null ? null : ageNow + ruinMonth / 12,
    retireMonth,
    endMonth,
    atRetirement,
    finalNominal,
    finalReal,
    unfundedGoals,
    path,
  };
}

// -------------------------------------------------------------------------------------------------
// Required corpus, readiness, earliest age
// -------------------------------------------------------------------------------------------------
export interface Readiness {
  status: 'meets_plan' | 'shortfall' | 'insufficient_data';
  missing: string[];
  retireAtAge: number;
  projectedAccessible: number; // nominal at retirement
  projectedAccessibleReal: number;
  lockedAtRetirement: number;
  requiredAccessible: number | null; // nominal at retirement (accessible assets needed, locked assets counted separately)
  requiredAccessibleReal: number | null;
  surplus: number | null; // nominal
  surplusReal: number | null;
  sim: SimResult;
}

export function missingInputs(plan: RetirementPlan): string[] {
  const m: string[] = [];
  if (!(plan.spending.monthlyToday > 0)) m.push('monthly spending after retirement');
  if (!plan.primaryDob) m.push('your date of birth');
  if (!(plan.planningEndAge > plan.retireAtAge))
    m.push('a planning age later than the retirement age');
  if (plan.holdings.cash + plan.holdings.equity + plan.holdings.locked <= 0)
    m.push('any retirement-eligible assets');
  if (plan.contributions.monthlyEquity + plan.contributions.monthlyCash <= 0)
    m.push('future monthly contributions (enter 0 only if you really mean none)');
  return m;
}

/** Smallest accessible corpus (nominal, at retirement) that lets the plan succeed; null if even an enormous corpus fails. */
export function requiredAccessible(
  plan: RetirementPlan,
  rates: RateSource,
  projected: SimResult,
): number | null {
  // Price indices reached at the retirement month (replayed exactly from the same rate path).
  let cpi = 1;
  let health = 1;
  for (let k = 0; k < projected.retireMonth; k++) {
    const r = rates(k);
    cpi *= 1 + r.inflation;
    health *= 1 + r.healthcare;
  }
  const run = (x: number) =>
    simulate(plan, rates, {
      skipAccumulation: true,
      startState: {
        cash: x * (1 - plan.retirementEquityShare),
        equity: x * plan.retirementEquityShare,
        locked: projected.atRetirement.locked,
        cpi,
        health,
      },
    });
  let hi = Math.max(1, plan.spending.monthlyToday * 12 * 10);
  let guard = 0;
  while (!run(hi).success) {
    hi *= 2;
    if (++guard > 60) return null;
  }
  let lo = 0;
  for (let i = 0; i < 100 && hi - lo > Math.max(1, hi * 1e-10); i++) {
    const mid = (lo + hi) / 2;
    if (run(mid).success) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function assess(plan: RetirementPlan, a: Assumptions): Readiness {
  const rates = constantRates(a);
  const sim = simulate(plan, rates);
  const miss = missingInputs(plan);
  const cpiAtRetire = sim.atRetirement.nominal / Math.max(1e-9, sim.atRetirement.real);
  if (miss.length > 0) {
    return {
      status: 'insufficient_data',
      missing: miss,
      retireAtAge: plan.retireAtAge,
      projectedAccessible: sim.atRetirement.accessible,
      projectedAccessibleReal: sim.atRetirement.accessible / cpiAtRetire,
      lockedAtRetirement: sim.atRetirement.locked,
      requiredAccessible: null,
      requiredAccessibleReal: null,
      surplus: null,
      surplusReal: null,
      sim,
    };
  }
  const req = requiredAccessible(plan, rates, sim);
  if (req === null) {
    return {
      status: 'shortfall',
      missing: [],
      retireAtAge: plan.retireAtAge,
      projectedAccessible: sim.atRetirement.accessible,
      projectedAccessibleReal: sim.atRetirement.accessible / cpiAtRetire,
      lockedAtRetirement: sim.atRetirement.locked,
      requiredAccessible: null,
      requiredAccessibleReal: null,
      surplus: null,
      surplusReal: null,
      sim,
    };
  }
  const surplus = sim.atRetirement.accessible - req;
  return {
    status: surplus >= 0 && sim.unfundedGoals < 1 ? 'meets_plan' : 'shortfall',
    missing: [],
    retireAtAge: plan.retireAtAge,
    projectedAccessible: sim.atRetirement.accessible,
    projectedAccessibleReal: sim.atRetirement.accessible / cpiAtRetire,
    lockedAtRetirement: sim.atRetirement.locked,
    requiredAccessible: req,
    requiredAccessibleReal: req / cpiAtRetire,
    surplus,
    surplusReal: surplus / cpiAtRetire,
    sim,
  };
}

export interface AgeRow {
  age: number;
  status: Readiness['status'];
  projectedReal: number;
  requiredReal: number | null;
  surplusReal: number | null;
}

/** Evaluates each candidate retirement age and reports the earliest one that meets the plan (or null). */
export function earliestRetirementAge(
  plan: RetirementPlan,
  a: Assumptions,
  opts: { fromAge?: number; toAge?: number } = {},
) {
  const now = ageOn(plan.primaryDob, plan.asOf);
  const from = Math.max(now, opts.fromAge ?? now);
  const to = opts.toAge ?? Math.min(70, plan.planningEndAge - 1);
  const ages: number[] = [now];
  for (let x = Math.ceil(from + 1e-9); x <= to; x++) if (x > now + 1e-9) ages.push(x);
  const table: AgeRow[] = [];
  let earliest: number | null = null;
  for (const age of ages) {
    const r = assess({ ...plan, retireAtAge: age }, a);
    table.push({
      age,
      status: r.status,
      projectedReal: r.projectedAccessibleReal,
      requiredReal: r.requiredAccessibleReal,
      surplusReal: r.surplusReal,
    });
    if (earliest === null && r.status === 'meets_plan') earliest = age;
    if (r.status === 'insufficient_data') break;
  }
  return { earliest, table };
}

// -------------------------------------------------------------------------------------------------
// Monte Carlo
// -------------------------------------------------------------------------------------------------
export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(rng: () => number) {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface MonteCarloResult {
  runs: number;
  seed: number;
  successRate: number;
  finalRealPercentiles: { p10: number; p50: number; p90: number };
  corpusAtRetirementRealPercentiles: { p10: number; p50: number; p90: number };
  ruinBeforeEnd: number; // fraction of runs that ran out of money
}

const pct = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]!;

/**
 * Independent yearly shocks (no correlation between assets, inflation drawn separately). Equity returns are log-normal with
 * the stated arithmetic mean and volatility. Reproducible for a given seed. This shows a range of outcomes, not a prediction.
 */
export function monteCarlo(
  plan: RetirementPlan,
  a: Assumptions,
  runs = 2000,
  seed = 12345,
): MonteCarloResult {
  const rng = mulberry32(seed);
  const years = Math.ceil(monthsToEnd(plan) / 12) + 2;
  const finals: number[] = [];
  const atRet: number[] = [];
  let ok = 0;
  let ruined = 0;
  const sLog2 = Math.log(1 + (a.equityVol * a.equityVol) / Math.pow(1 + a.equityReturn, 2));
  const muLog = Math.log(1 + a.equityReturn) - sLog2 / 2;
  for (let n = 0; n < runs; n++) {
    const yr: {
      equity: number;
      cash: number;
      locked: number;
      inflation: number;
      healthcare: number;
    }[] = [];
    for (let y = 0; y < years; y++) {
      const infl = Math.max(0, a.inflation + a.inflationVol * normal(rng));
      yr.push({
        equity: monthly(Math.exp(muLog + Math.sqrt(sLog2) * normal(rng)) - 1),
        cash: monthly(Math.max(-0.5, a.cashReturn + a.cashVol * normal(rng))),
        locked: monthly(a.lockedReturn),
        inflation: monthly(infl),
        healthcare: monthly(infl + (a.healthcareInflation - a.inflation)),
      });
    }
    const sim = simulate(plan, (m) => yr[Math.min(years - 1, Math.floor(m / 12))]!);
    if (sim.success) ok++;
    if (sim.ruinMonth !== null) ruined++;
    finals.push(sim.finalReal);
    atRet.push(sim.atRetirement.real);
  }
  finals.sort((x, y) => x - y);
  atRet.sort((x, y) => x - y);
  return {
    runs,
    seed,
    successRate: ok / runs,
    finalRealPercentiles: { p10: pct(finals, 0.1), p50: pct(finals, 0.5), p90: pct(finals, 0.9) },
    corpusAtRetirementRealPercentiles: {
      p10: pct(atRet, 0.1),
      p50: pct(atRet, 0.5),
      p90: pct(atRet, 0.9),
    },
    ruinBeforeEnd: ruined / runs,
  };
}

// -------------------------------------------------------------------------------------------------
// Scenarios and levers
// -------------------------------------------------------------------------------------------------
export const SCENARIOS: Record<'conservative' | 'base' | 'optimistic', Assumptions> = {
  conservative: {
    equityReturn: 0.08,
    cashReturn: 0.06,
    lockedReturn: 0.07,
    inflation: 0.065,
    healthcareInflation: 0.09,
    equityVol: 0.18,
    cashVol: 0.01,
    inflationVol: 0.015,
  },
  base: {
    equityReturn: 0.1,
    cashReturn: 0.065,
    lockedReturn: 0.08,
    inflation: 0.055,
    healthcareInflation: 0.08,
    equityVol: 0.16,
    cashVol: 0.01,
    inflationVol: 0.015,
  },
  optimistic: {
    equityReturn: 0.12,
    cashReturn: 0.07,
    lockedReturn: 0.09,
    inflation: 0.05,
    healthcareInflation: 0.07,
    equityVol: 0.15,
    cashVol: 0.01,
    inflationVol: 0.015,
  },
};

export interface Lever {
  label: string;
  earliestAge: number | null;
  readyAtChosenAge: boolean;
  surplusRealAtChosenAge: number | null;
  requiredRealAtChosenAge: number | null;
}

/** Impact of common changes on the chosen retirement age and on the earliest viable age. */
export function levers(plan: RetirementPlan, a: Assumptions): Lever[] {
  const variants: [string, RetirementPlan, Assumptions][] = [
    ['As planned', plan, a],
    [
      'Invest ₹10,000 more per month',
      {
        ...plan,
        contributions: {
          ...plan.contributions,
          monthlyEquity: plan.contributions.monthlyEquity + 10_000,
        },
      },
      a,
    ],
    [
      'Invest ₹25,000 more per month',
      {
        ...plan,
        contributions: {
          ...plan.contributions,
          monthlyEquity: plan.contributions.monthlyEquity + 25_000,
        },
      },
      a,
    ],
    [
      'Invest ₹50,000 more per month',
      {
        ...plan,
        contributions: {
          ...plan.contributions,
          monthlyEquity: plan.contributions.monthlyEquity + 50_000,
        },
      },
      a,
    ],
    [
      'Raise investments 10% every year',
      {
        ...plan,
        contributions: {
          ...plan.contributions,
          annualStepUp: plan.contributions.annualStepUp + 0.1,
        },
      },
      a,
    ],
    [
      'Spend 10% less in retirement',
      { ...plan, spending: { ...plan.spending, monthlyToday: plan.spending.monthlyToday * 0.9 } },
      a,
    ],
    ['Retire 2 years later', { ...plan, retireAtAge: plan.retireAtAge + 2 }, a],
    [
      'Returns 2 points lower',
      plan,
      {
        ...a,
        equityReturn: a.equityReturn - 0.02,
        cashReturn: a.cashReturn - 0.02,
        lockedReturn: a.lockedReturn - 0.02,
      },
    ],
    [
      'Inflation 1 point higher',
      plan,
      { ...a, inflation: a.inflation + 0.01, healthcareInflation: a.healthcareInflation + 0.01 },
    ],
    // stress cases: what if things go worse than assumed
    [
      'Equity returns 4 points lower for the whole period',
      plan,
      { ...a, equityReturn: a.equityReturn - 0.04 },
    ],
    [
      'Inflation 3 points higher, healthcare too',
      plan,
      { ...a, inflation: a.inflation + 0.03, healthcareInflation: a.healthcareInflation + 0.03 },
    ],
    [
      'Spending 20% higher in retirement',
      { ...plan, spending: { ...plan.spending, monthlyToday: plan.spending.monthlyToday * 1.2 } },
      a,
    ],
    [
      'Monthly investing falls by half (for example a lost income)',
      {
        ...plan,
        contributions: {
          ...plan.contributions,
          monthlyEquity: plan.contributions.monthlyEquity * 0.5,
          monthlyCash: plan.contributions.monthlyCash * 0.5,
        },
      },
      a,
    ],
    ['Retire 2 years earlier', { ...plan, retireAtAge: plan.retireAtAge - 2 }, a],
  ];
  return variants.map(([label, p, as]) => {
    const r = assess(p, as);
    const e = earliestRetirementAge(p, as);
    return {
      label,
      earliestAge: e.earliest,
      readyAtChosenAge: r.status === 'meets_plan',
      surplusRealAtChosenAge: r.surplusReal,
      requiredRealAtChosenAge: r.requiredAccessibleReal,
    };
  });
}
