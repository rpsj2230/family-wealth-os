/**
 * The goal and retirement cards of the daily summary: how far each is from being reached, whether the current pace gets there, and
 * by how much it misses. Pure. The numbers are the portal's: a goal's projection is `projectGoal` (through `summariseGoals`, the
 * same as Home and Goals) and retirement is `assess` / `monteCarlo` ("Can I retire now?"). The only things worked out here are the
 * words, the "ahead" threshold (Settings), the delay in months and the monthly top-up that closes a retirement gap.
 */
import type { GoalSummary } from './goal-summary';
import { futureValue, type GoalPlan } from './goals';
import {
  ageOn,
  monthsToRetire,
  type Assumptions,
  type MonteCarloResult,
  type Readiness,
  type RetirementPlan,
} from './retirement';
import { inr, monthsText, niceDate, plainPct } from './digest-format';

export type PaceState = 'on_track' | 'ahead' | 'behind' | 'no_data' | 'past_due';

export interface DigestGoalCard {
  id: string;
  kind: 'goal' | 'retirement';
  name: string;
  state: PaceState;
  /** the date it is wanted by (retirement: the date the person turns the retirement age) */
  date: string | null;
  /** what it costs in today's rupees (retirement: the corpus needed, in today's rupees) */
  targetToday: number | null;
  /** what is needed on the date, with the cost inflated (retirement: the corpus needed, in today's rupees) */
  needed: number | null;
  /** earmarked or held today */
  saved: number;
  /** 0 to 100 of `needed`, capped, for the bar */
  savedPct: number | null;
  /** 0 to 100 of `needed` that the current pace reaches, capped, for the bar */
  projectedPct: number | null;
  /** what the current pace reaches by the date */
  projected: number | null;
  /** positive: how far short the current pace falls on the date */
  shortfall: number | null;
  /** positive: how far past the need the current pace lands */
  surplus: number | null;
  /** about how many months later than the date the current pace gets there; null when not behind or never within the horizon */
  delayMonths: number | null;
  /** more to put in each month to be on track; 0 when on track */
  topUp: number;
  /** the short chip: "On track", "Behind by ₹3.1 L (about 14 months)", "Ahead by ₹2 L", "Not enough data" */
  chip: string;
  /** one plain sentence about the pace */
  line: string;
  /** retirement only */
  extra?: {
    yearsToGo: number | null;
    retireAtAge: number;
    successRate: number | null;
    earliestAge: number | null;
  };
}

/**
 * Months after the target date at which the current pace first covers the cost, the cost still rising by its own inflation.
 * Null when it does not within `horizonMonths` (a goal that falls ever further behind is better told as a shortfall).
 */
export function delayMonths(plan: GoalPlan, horizonMonths = 360): number | null {
  if (!plan.targetToday || !plan.targetDate) return null;
  const years = (Date.parse(plan.targetDate) - Date.parse(plan.today)) / (365.25 * 86_400_000);
  if (years <= 0) return null;
  const months = Math.round(years * 12);
  const covered = (m: number) =>
    futureValue(plan.allocatedNow, plan.monthlyContribution, plan.annualReturn, m) >=
    plan.targetToday! * Math.pow(1 + plan.inflation, m / 12);
  if (covered(months)) return 0;
  for (let m = months + 1; m <= months + horizonMonths; m++) if (covered(m)) return m - months;
  return null;
}

const clampPct = (x: number) => Math.min(100, Math.max(0, x));

/** The card of one goal, from the portal's own summary. `aheadMargin` is from Settings (digest.aheadMargin). */
export function goalCard(g: GoalSummary, aheadMargin: number): DigestGoalCard {
  const p = g.proj;
  const base = {
    id: g.id,
    kind: 'goal' as const,
    name: g.name,
    date: g.targetDate,
    targetToday: g.targetToday ?? null,
    saved: g.allocated,
    topUp: 0,
    delayMonths: null,
    shortfall: null,
    surplus: null,
  };
  if (p.status === 'no_target') {
    const noDate = !g.targetDate;
    const noAmount = !g.targetToday || g.targetToday <= 0;
    const what =
      noDate && noAmount
        ? 'a target amount and date'
        : noDate
          ? 'a target date'
          : 'a target amount';
    return {
      ...base,
      state: 'no_data',
      needed: null,
      savedPct: null,
      projectedPct: null,
      projected: null,
      chip: 'Not enough data',
      line: `Not enough data: set ${what}.`,
    };
  }
  if (p.status === 'past_due')
    return {
      ...base,
      state: 'past_due',
      needed: null,
      savedPct: null,
      projectedPct: null,
      projected: null,
      chip: 'Date passed',
      line: `The target date (${g.targetDate ? niceDate(g.targetDate) : '–'}) has passed. Move the date or close the goal.`,
    };
  const needed = p.futureCost ?? 0;
  const projected = p.projectedValue ?? 0;
  const gap = p.gap ?? 0;
  const dateText = niceDate(g.targetDate!);
  const savedPct = needed > 0 ? clampPct((g.allocated / needed) * 100) : null;
  const projectedPct = needed > 0 ? clampPct((projected / needed) * 100) : null;
  const common = { ...base, needed, savedPct, projectedPct, projected };
  if (gap > 0) {
    const delay = g.plan ? delayMonths(g.plan) : null;
    const topUp = Math.max(0, Math.round(p.requiredMonthlyExtra ?? 0));
    return {
      ...common,
      state: 'behind',
      shortfall: gap,
      delayMonths: delay,
      topUp,
      chip: `Behind by ${inr(gap)}${delay ? ` (about ${monthsText(delay)})` : ''}`,
      line: `At the current pace you reach ${inr(projected)} by ${dateText} against ${inr(needed)} needed: shortfall ${inr(gap)}${
        delay ? `, about ${monthsText(delay)} late` : ', and it does not catch up within 30 years'
      }. To be on track add ${inr(topUp)} a month.`,
    };
  }
  const surplus = -gap;
  const ahead = needed > 0 && surplus > needed * aheadMargin;
  return {
    ...common,
    state: ahead ? 'ahead' : 'on_track',
    surplus,
    chip: ahead ? `Ahead by ${inr(surplus)}` : 'On track',
    line: `At the current pace you reach ${inr(projected)} by ${dateText} against ${inr(needed)} needed${
      surplus > 0 ? `: ${inr(surplus)} to spare` : ''
    }. No change needed.`,
  };
}

// ------------------------------------------------------------------------------------------------
// Retirement
// ------------------------------------------------------------------------------------------------
export interface RetirementCardInput {
  plan: RetirementPlan;
  assumptions: Assumptions;
  readiness: Readiness;
  /** the success chance of the Monte Carlo run, when it was run */
  monteCarlo?: Pick<MonteCarloResult, 'successRate' | 'runs'> | null;
  /** the earliest age that meets the plan under the assumptions (earliestRetirementAge), when worked out */
  earliestAge?: number | null;
  aheadMargin: number;
}

/** Date a person born on `dob` turns `age` (a 29 February birthday is moved to 28 February). */
function dateAtAge(dob: string, age: number): string {
  const y = Number(dob.slice(0, 4)) + Math.floor(age);
  const extraMonths = Math.round((age - Math.floor(age)) * 12);
  const d = new Date(`${y}-${dob.slice(5, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + extraMonths);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(Number(dob.slice(8, 10)), dim);
  return `${d.toISOString().slice(0, 8)}${String(day).padStart(2, '0')}`;
}

/**
 * Retirement as a goal: the corpus needed against the corpus the current savings and SIPs reach by the retirement age, both in
 * today's rupees (how "Can I retire now?" leads). The extra a month that would close a gap is the shortfall at retirement over the
 * growth one rupee a month earns in equity until then: a close estimate (it ignores the yearly step-up), worded as "about".
 */
export function retirementCard(i: RetirementCardInput): DigestGoalCard {
  const { plan, readiness: r } = i;
  const age = plan.primaryDob ? ageOn(plan.primaryDob, plan.asOf) : null;
  const yearsToGo = age === null ? null : Math.max(0, plan.retireAtAge - age);
  const date = plan.primaryDob ? dateAtAge(plan.primaryDob, plan.retireAtAge) : null;
  const saved = plan.holdings.cash + plan.holdings.equity;
  const success = i.monteCarlo ? i.monteCarlo.successRate : null;
  const extra = {
    yearsToGo,
    retireAtAge: plan.retireAtAge,
    successRate: success,
    earliestAge: i.earliestAge ?? null,
  };
  const base = {
    id: 'retirement',
    kind: 'retirement' as const,
    name: `Retirement at ${plan.retireAtAge}`,
    date,
    targetToday: r.requiredAccessibleReal,
    saved,
    topUp: 0,
    delayMonths: null,
    shortfall: null,
    surplus: null,
    extra,
  };
  const chance =
    success === null
      ? ''
      : ` Chance the money lasts: ${plainPct(success)} in ${i.monteCarlo!.runs.toLocaleString('en-IN')} simulated paths.`;
  if (r.status === 'insufficient_data')
    return {
      ...base,
      state: 'no_data',
      needed: null,
      savedPct: null,
      projectedPct: null,
      projected: null,
      chip: 'Not enough data',
      line: `Not enough data: add ${r.missing[0] ?? 'your retirement details'} in Can I retire now?`,
    };
  const projected = r.projectedAccessibleReal;
  const needed = r.requiredAccessibleReal;
  if (needed === null || r.surplusReal === null) {
    return {
      ...base,
      state: 'behind',
      needed: null,
      savedPct: null,
      projectedPct: null,
      projected,
      chip: 'Behind',
      line: `Under these assumptions the money does not last, even with a very large corpus. Review spending and assumptions in Can I retire now?`,
    };
  }
  const gap = Math.max(0, -r.surplusReal);
  const surplus = Math.max(0, r.surplusReal);
  const savedPct = needed > 0 ? clampPct((saved / needed) * 100) : null;
  const projectedPct = needed > 0 ? clampPct((projected / needed) * 100) : null;
  const common = { ...base, needed, savedPct, projectedPct, projected };
  const years =
    yearsToGo === null
      ? ''
      : ` in ${yearsToGo < 1 ? 'under a year' : `${Math.round(yearsToGo)} years`}`;
  if (r.status === 'shortfall') {
    // nominal shortfall at retirement over what one rupee a month grows to by then
    const months = Math.max(1, monthsToRetire(plan));
    const nominalGap = Math.max(0, (r.requiredAccessible ?? 0) - r.projectedAccessible);
    const per = futureValue(0, 1, i.assumptions.equityReturn, months);
    const topUp = per > 0 ? Math.round(nominalGap / per) : 0;
    const later =
      i.earliestAge !== null && i.earliestAge !== undefined && i.earliestAge > plan.retireAtAge
        ? ` Retiring at ${i.earliestAge} would meet the plan.`
        : '';
    return {
      ...common,
      state: 'behind',
      shortfall: gap,
      topUp,
      chip: `Behind by ${inr(gap)}`,
      line: `At the current pace you reach ${inr(projected)} (today's money) at ${plan.retireAtAge}${years} against ${inr(needed)} needed: shortfall ${inr(gap)}. To close it, save about ${inr(topUp)} more a month until then.${later}${chance}`,
    };
  }
  const ahead = needed > 0 && surplus > needed * i.aheadMargin;
  return {
    ...common,
    state: ahead ? 'ahead' : 'on_track',
    surplus,
    chip: ahead ? `Ahead by ${inr(surplus)}` : 'On track',
    line: `At the current pace you reach ${inr(projected)} (today's money) at ${plan.retireAtAge}${years} against ${inr(needed)} needed: ${inr(surplus)} to spare.${chance}`,
  };
}
