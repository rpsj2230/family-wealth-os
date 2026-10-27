/**
 * Each goal with what is earmarked for it and whether it is on track: the one place this arithmetic lives, used by Home, the Goals
 * page and the daily summary, so the three can never disagree. Pure. The assumptions (cost inflation by kind of goal, a cautious
 * return that depends on how far away the goal is) are assumptions, not promises.
 */
import { projectGoal, type GoalPlan, type GoalProjection } from './goals';

/** Cost inflation assumed for a goal when none is set on it. */
export const DEFAULT_INFLATION: Record<string, number> = {
  education: 0.09,
  marriage: 0.07,
  retirement: 0.055,
  property: 0.06,
  emergency: 0.055,
  other: 0.055,
};

/** A cautious, horizon-based return assumption for money earmarked for a goal. It is an assumption, not a promise. */
export const returnFor = (years: number) => (years >= 8 ? 0.1 : years >= 4 ? 0.08 : 0.065);

export interface GoalSummary {
  id: string;
  name: string;
  kind: string;
  targetDate: string | null;
  allocated: number;
  monthly: number;
  futureCost: number | null;
  proj: GoalProjection;
  /** the cost in today's rupees and the plan handed to projectGoal, so a reader can restate the projection */
  targetToday?: number | null;
  plan?: GoalPlan;
}

export interface GoalRowIn {
  id: string;
  name: string;
  kind: string;
  targetAmount: number | null;
  targetDate: string | null;
  inflationRate: number | null;
}

export interface GoalAllocIn {
  goalId: string;
  assetId: string;
  method: 'percent' | 'amount';
  value: number;
}

export function summariseGoals(i: {
  goals: GoalRowIn[];
  allocations: GoalAllocIn[];
  /** worth today of each holding, by asset */
  values: ReadonlyMap<string, number>;
  /** monthly SIP of each holding (0 when stopped), by asset */
  sips: ReadonlyMap<string, number>;
  today: string;
}): GoalSummary[] {
  return i.goals.map((g) => {
    let allocated = 0;
    let monthly = 0;
    for (const a of i.allocations.filter((x) => x.goalId === g.id)) {
      const v = i.values.get(a.assetId) ?? 0;
      allocated += a.method === 'percent' ? (v * a.value) / 100 : Math.min(v, a.value);
      if (a.method === 'percent') monthly += ((i.sips.get(a.assetId) ?? 0) * a.value) / 100;
    }
    const years = g.targetDate
      ? (Date.parse(g.targetDate) - Date.parse(i.today)) / (365.25 * 86_400_000)
      : 0;
    const infl =
      g.inflationRate !== null && g.inflationRate !== undefined
        ? g.inflationRate
        : (DEFAULT_INFLATION[g.kind] ?? 0.055);
    const plan: GoalPlan = {
      targetToday: g.targetAmount ? g.targetAmount : null,
      targetDate: g.targetDate,
      inflation: infl,
      allocatedNow: allocated,
      monthlyContribution: monthly,
      annualReturn: returnFor(years),
      today: i.today,
    };
    const proj = projectGoal(plan);
    return {
      id: g.id,
      name: g.name,
      kind: g.kind,
      targetDate: g.targetDate,
      allocated,
      monthly,
      futureCost: proj.futureCost,
      proj,
      targetToday: plan.targetToday,
      plan,
    };
  });
}
