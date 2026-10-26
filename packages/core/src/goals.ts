/**
 * Goal allocation overlays. A holding can fund several goals, but its value is counted once.
 * Over-allocation is reported, never silently clamped.
 */
export interface HoldingValue {
  assetId: string;
  value: number;
}
export type Allocation =
  | { goalId: string; assetId: string; method: 'percent'; value: number }
  | { goalId: string; assetId: string; method: 'amount'; value: number };

export interface AllocationResult {
  status: 'ok' | 'over_allocated' | 'invalid';
  byGoal: Record<string, number>;
  unallocatedByAsset: Record<string, number>;
  totalAllocated: number;
  problems: { assetId: string; message: string }[];
}

export function allocateToGoals(
  holdings: HoldingValue[],
  allocations: Allocation[],
): AllocationResult {
  const value = new Map(holdings.map((h) => [h.assetId, h.value]));
  const problems: AllocationResult['problems'] = [];
  const byGoal: Record<string, number> = {};
  const used = new Map<string, number>();
  let invalid = false;

  const perAsset = new Map<string, Allocation[]>();
  for (const a of allocations) {
    if (!value.has(a.assetId)) {
      problems.push({ assetId: a.assetId, message: 'allocation refers to an unknown holding' });
      invalid = true;
      continue;
    }
    if (!(a.value >= 0) || (a.method === 'percent' && a.value > 100)) {
      problems.push({ assetId: a.assetId, message: `invalid ${a.method} value ${a.value}` });
      invalid = true;
      continue;
    }
    perAsset.set(a.assetId, [...(perAsset.get(a.assetId) ?? []), a]);
  }

  let over = false;
  for (const [assetId, list] of perAsset) {
    const v = value.get(assetId)!;
    const pct = list.filter((x) => x.method === 'percent').reduce((s, x) => s + x.value, 0);
    const amt = list.filter((x) => x.method === 'amount').reduce((s, x) => s + x.value, 0);
    const total = (v * pct) / 100 + amt;
    if (pct > 100 + 1e-9 || total > v + 0.005) {
      problems.push({
        assetId,
        message: `allocated ${total.toFixed(2)} exceeds holding value ${v.toFixed(2)}`,
      });
      over = true;
    }
    for (const x of list) {
      const amount = x.method === 'percent' ? (v * x.value) / 100 : x.value;
      byGoal[x.goalId] = (byGoal[x.goalId] ?? 0) + amount;
    }
    used.set(assetId, total);
  }
  const unallocatedByAsset: Record<string, number> = {};
  for (const h of holdings) unallocatedByAsset[h.assetId] = h.value - (used.get(h.assetId) ?? 0);
  return {
    status: invalid ? 'invalid' : over ? 'over_allocated' : 'ok',
    byGoal,
    unallocatedByAsset,
    totalAllocated: [...used.values()].reduce((s, v) => s + v, 0),
    problems,
  };
}

// -------------------------------------------------------------------------------------------------
// Goal funding projection
// -------------------------------------------------------------------------------------------------
export interface GoalPlan {
  /** cost in today's rupees; null/0 = no target yet */
  targetToday: number | null;
  targetDate: string | null; // YYYY-MM-DD
  /** the goal's own cost inflation (education usually runs above general inflation) */
  inflation: number;
  /** value already earmarked for this goal (allocated share of holdings) */
  allocatedNow: number;
  /** monthly investing that flows to this goal (its share of each SIP) */
  monthlyContribution: number;
  /** assumed annual return on the earmarked money; an assumption, not a promise */
  annualReturn: number;
  today: string;
}

export interface GoalProjection {
  status: 'no_target' | 'past_due' | 'on_track' | 'shortfall';
  yearsLeft: number | null;
  futureCost: number | null;
  projectedValue: number | null;
  gap: number | null; // positive = shortfall, in future rupees
  gapToday: number | null; // same gap in today's purchasing power
  requiredMonthlyExtra: number | null;
  fundedPct: number | null; // projected / future cost
  message: string;
}

/** Future value of a lump sum and of equal monthly contributions made at the start of each month. */
export function futureValue(
  lump: number,
  monthly: number,
  annualReturn: number,
  months: number,
): number {
  const r = Math.pow(1 + annualReturn, 1 / 12) - 1;
  if (months <= 0) return lump;
  const lumpFv = lump * Math.pow(1 + r, months);
  const annuity = r === 0 ? months : ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
  return lumpFv + monthly * annuity;
}

export function projectGoal(g: GoalPlan): GoalProjection {
  const none = (status: GoalProjection['status'], message: string): GoalProjection => ({
    status,
    yearsLeft: null,
    futureCost: null,
    projectedValue: null,
    gap: null,
    gapToday: null,
    requiredMonthlyExtra: null,
    fundedPct: null,
    message,
  });
  if (!g.targetToday || g.targetToday <= 0 || !g.targetDate)
    return none('no_target', 'Set a target amount and date to see whether this goal is funded.');
  const years = (Date.parse(g.targetDate) - Date.parse(g.today)) / (365.25 * 86_400_000);
  if (years <= 0) return { ...none('past_due', 'The target date has passed.'), yearsLeft: years };
  const months = Math.round(years * 12);
  const futureCost = g.targetToday * Math.pow(1 + g.inflation, years);
  const projected = futureValue(g.allocatedNow, g.monthlyContribution, g.annualReturn, months);
  const gap = futureCost - projected;
  const r = Math.pow(1 + g.annualReturn, 1 / 12) - 1;
  const annuity = r === 0 ? months : ((Math.pow(1 + r, months) - 1) / r) * (1 + r);
  return {
    status: gap <= 0 ? 'on_track' : 'shortfall',
    yearsLeft: years,
    futureCost,
    projectedValue: projected,
    gap,
    gapToday: gap / Math.pow(1 + g.inflation, years),
    requiredMonthlyExtra: gap > 0 && annuity > 0 ? gap / annuity : 0,
    fundedPct: projected / futureCost,
    message:
      gap <= 0
        ? 'On track under these assumptions.'
        : 'Projected shortfall under these assumptions.',
  };
}
