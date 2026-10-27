import { DEFAULT_INFLATION, returnFor, summariseGoals, type GoalSummary } from '@fwos/core';
import type { LoadedPortfolio } from '@fwos/data';
import type { Ctx } from './data';

// the arithmetic lives in core (goal-summary.ts), shared with the daily summary
export { DEFAULT_INFLATION, returnFor };
export type { GoalSummary };

/** Each goal with what is earmarked for it and whether it is on track, the same arithmetic as the Goals page. */
export async function loadGoalSummaries(
  supabase: Ctx['supabase'],
  l: LoadedPortfolio,
): Promise<GoalSummary[]> {
  const [goals, allocs, sips] = await Promise.all([
    supabase
      .from('goals')
      .select('id, name, kind, target_amount, target_date, inflation_rate')
      .order('name'),
    supabase.from('goal_allocations').select('goal_id, asset_id, method, value'),
    supabase.from('mf_positions').select('asset_id, sip_monthly, sip_stopped'),
  ]);
  return summariseGoals({
    goals: (goals.data ?? []).map((g) => ({
      id: g.id as string,
      name: g.name as string,
      kind: g.kind as string,
      targetAmount: g.target_amount ? Number(g.target_amount) : null,
      targetDate: (g.target_date as string | null) ?? null,
      inflationRate:
        g.inflation_rate !== null && g.inflation_rate !== undefined
          ? Number(g.inflation_rate)
          : null,
    })),
    allocations: (allocs.data ?? []).map((a) => ({
      goalId: a.goal_id as string,
      assetId: a.asset_id as string,
      method: a.method as 'percent' | 'amount',
      value: Number(a.value),
    })),
    values: new Map(l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0])),
    sips: new Map(
      (sips.data ?? []).map((s) => [
        s.asset_id as string,
        s.sip_stopped ? 0 : Number(s.sip_monthly ?? 0),
      ]),
    ),
    today: l.today.toISOString().slice(0, 10),
  });
}
