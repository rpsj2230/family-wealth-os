import { projectGoal } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { DEFAULT_INFLATION, returnFor } from '@/lib/goals-view';
import { loadPortfolio } from '@/lib/portfolio-data';
import { createGoal, deleteGoal, removeAllocation, setAllocation, updateGoal } from './actions';
import { GoalsView, parseGoalTab, type FreeHolding } from './GoalsView';
import type { GoalModel } from './Parts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Goals' };

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string; tab?: string }>;
}) {
  const { e, tab } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, portfolio, assetRows }, goals, allocs, sips] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('goals')
      .select('id, name, kind, target_amount, target_date, inflation_rate')
      .order('name'),
    supabase.from('goal_allocations').select('goal_id, asset_id, method, value'),
    supabase.from('mf_positions').select('asset_id, sip_monthly, sip_stopped'),
  ]);
  const value = new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]));
  const nick = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const sip = new Map(
    (sips.data ?? []).map((s) => [
      s.asset_id as string,
      s.sip_stopped ? 0 : Number(s.sip_monthly ?? 0),
    ]),
  );
  const todayIso = today.toISOString().slice(0, 10);

  const models: GoalModel[] = (goals.data ?? []).map((g) => {
    const mine = (allocs.data ?? []).filter((a) => a.goal_id === g.id);
    let allocated = 0;
    let monthly = 0;
    const funds = mine.map((a) => {
      const v = value.get(a.asset_id as string) ?? 0;
      const share =
        a.method === 'percent' ? (v * Number(a.value)) / 100 : Math.min(v, Number(a.value));
      allocated += share;
      if (a.method === 'percent')
        monthly += ((sip.get(a.asset_id as string) ?? 0) * Number(a.value)) / 100;
      return {
        assetId: a.asset_id as string,
        name: nick.get(a.asset_id as string) ?? 'Holding',
        pct: a.method === 'percent' ? Number(a.value) : null,
        share,
      };
    });
    const target = g.target_amount ? Number(g.target_amount) : null;
    const years = g.target_date
      ? (Date.parse(g.target_date as string) - Date.parse(todayIso)) / (365.25 * 86_400_000)
      : 0;
    const defaultInfl = DEFAULT_INFLATION[g.kind as string] ?? 0.055;
    const infl =
      g.inflation_rate !== null && g.inflation_rate !== undefined
        ? Number(g.inflation_rate)
        : defaultInfl;
    const ret = returnFor(years);
    return {
      id: g.id as string,
      name: g.name as string,
      kind: g.kind as string,
      targetToday: target,
      targetDate: (g.target_date as string | null) ?? null,
      inflationPct:
        g.inflation_rate !== null && g.inflation_rate !== undefined
          ? String(+(Number(g.inflation_rate) * 100).toFixed(2))
          : '',
      defaultInflationPct: (defaultInfl * 100).toFixed(1),
      yearsLeft: g.target_date ? years : null,
      returnPct: (ret * 100).toFixed(1),
      inflation: infl,
      allocated,
      monthly,
      funds,
      proj: projectGoal({
        targetToday: target,
        targetDate: (g.target_date as string | null) ?? null,
        inflation: infl,
        allocatedNow: allocated,
        monthlyContribution: monthly,
        annualReturn: ret,
        today: todayIso,
      }),
    };
  });

  const usedBy = new Map<string, number>();
  for (const a of allocs.data ?? [])
    if (a.method === 'percent')
      usedBy.set(a.asset_id as string, (usedBy.get(a.asset_id as string) ?? 0) + Number(a.value));
  const choices: FreeHolding[] = assetRows
    .filter(
      (a) =>
        ['mutual_fund', 'fixed_deposit', 'bank_account', 'stock'].includes(a.type) &&
        ['active', 'stopped'].includes(a.status),
    )
    .sort((a, b) => a.nickname.localeCompare(b.nickname))
    .map((a) => {
      const v = value.get(a.id) ?? 0;
      const freePct = Math.max(0, 100 - Math.min(100, usedBy.get(a.id) ?? 0));
      return {
        id: a.id,
        name: a.nickname,
        value: v,
        freePct: Math.round(freePct * 100) / 100,
        freeValue: (v * freePct) / 100,
      };
    });

  return (
    <GoalsView
      goals={models}
      choices={choices}
      tab={parseGoalTab(tab)}
      base="/goals"
      error={e}
      addGoal={createGoal}
      setAllocation={setAllocation}
      actions={{ update: updateGoal, remove: deleteGoal, removeAllocation, setAllocation }}
    />
  );
}
