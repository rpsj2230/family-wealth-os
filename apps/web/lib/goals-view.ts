import { projectGoal, type GoalProjection } from '@fwos/core';
import type { LoadedPortfolio } from '@fwos/data';
import type { Ctx } from './data';

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
}

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
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  const sip = new Map(
    (sips.data ?? []).map((s) => [
      s.asset_id as string,
      s.sip_stopped ? 0 : Number(s.sip_monthly ?? 0),
    ]),
  );
  const todayIso = l.today.toISOString().slice(0, 10);
  return (goals.data ?? []).map((g) => {
    let allocated = 0;
    let monthly = 0;
    for (const a of (allocs.data ?? []).filter((x) => x.goal_id === g.id)) {
      const v = value.get(a.asset_id as string) ?? 0;
      allocated +=
        a.method === 'percent' ? (v * Number(a.value)) / 100 : Math.min(v, Number(a.value));
      if (a.method === 'percent')
        monthly += ((sip.get(a.asset_id as string) ?? 0) * Number(a.value)) / 100;
    }
    const years = g.target_date
      ? (Date.parse(g.target_date as string) - Date.parse(todayIso)) / (365.25 * 86_400_000)
      : 0;
    const infl =
      g.inflation_rate !== null && g.inflation_rate !== undefined
        ? Number(g.inflation_rate)
        : (DEFAULT_INFLATION[g.kind as string] ?? 0.055);
    const proj = projectGoal({
      targetToday: g.target_amount ? Number(g.target_amount) : null,
      targetDate: (g.target_date as string | null) ?? null,
      inflation: infl,
      allocatedNow: allocated,
      monthlyContribution: monthly,
      annualReturn: returnFor(years),
      today: todayIso,
    });
    return {
      id: g.id as string,
      name: g.name as string,
      kind: g.kind as string,
      targetDate: (g.target_date as string | null) ?? null,
      allocated,
      monthly,
      futureCost: proj.futureCost,
      proj,
    };
  });
}
