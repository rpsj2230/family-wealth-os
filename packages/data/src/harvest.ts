import {
  harvestDueOn,
  harvestTaskTitle,
  planHarvest,
  type HarvestPlan,
  type HarvestPosition,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';

/** Fund positions with today's value, for the harvest planner. Works with the user's client (RLS) or the service role. */
export async function loadHarvestPositions(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<{ positions: HarvestPosition[]; ownerName: Map<string, string>; today: Date }> {
  const l = await loadPortfolioData(db, {
    ...(opts.householdId ? { householdId: opts.householdId } : {}),
    ...(opts.today ? { today: opts.today } : {}),
  });
  const q = db
    .from('mf_positions')
    .select('asset_id, fund_name, invested, started_on, sip_monthly, sip_stopped');
  const rows = ((await (opts.householdId ? q.eq('household_id', opts.householdId) : q)).data ??
    []) as unknown as {
    asset_id: string;
    fund_name: string;
    invested: number | null;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
  }[];
  const owner = new Map(l.assetRows.map((a) => [a.id, a.owner_id]));
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  const positions: HarvestPosition[] = rows
    .filter((r) => owner.has(r.asset_id))
    .map((r) => ({
      assetId: r.asset_id,
      ownerId: owner.get(r.asset_id)!,
      fund: r.fund_name,
      value: value.get(r.asset_id) ?? 0,
      invested: Number(r.invested ?? 0),
      startedOn: r.started_on,
      sipActive: !!r.sip_monthly && !r.sip_stopped,
    }));
  return { positions, ownerName: l.ownerName, today: l.today };
}

/**
 * Turns the plan into reminder tasks, once per person per financial year. Existing tasks are never changed, so a task you
 * completed or dropped stays that way. Returns how many were added.
 */
export async function ensureHarvestTasks(
  db: SupabaseClient,
  householdId: string,
  plan: HarvestPlan,
  ownerName: Map<string, string>,
  today: string,
  remind: { month: number; day: number },
): Promise<number> {
  if (plan.status !== 'ok') return 0;
  const existing = ((await db.from('tasks').select('title').eq('household_id', householdId)).data ??
    []) as { title: string }[];
  const have = new Set(existing.map((t) => t.title.split(']')[0]));
  const add = plan.plans
    .filter((p) => p.picks.length > 0)
    .map((p) => ({ p, name: ownerName.get(p.ownerId) ?? 'Owner' }))
    .filter(({ name }) => !have.has(`[Harvest ${plan.fy} ${name}`))
    .map(({ p, name }) => ({
      household_id: householdId,
      title: harvestTaskTitle(plan.fy, name, p),
      due_on: harvestDueOn(plan, today, remind),
    }));
  if (add.length === 0) return 0;
  const { error } = await db.from('tasks').insert(add);
  if (error) throw new Error(`harvest tasks: ${error.message}`);
  return add.length;
}

/**
 * Keeps one refund record per person per financial year in step with the harvest plan. A record the person has already
 * moved on (sale made, return filed, refund received) is never overwritten. Returns how many were added or refreshed.
 */
export async function ensureRefundRecords(
  db: SupabaseClient,
  householdId: string,
  plan: HarvestPlan,
): Promise<number> {
  if (plan.status !== 'ok') return 0;
  const existing = ((
    await db
      .from('tds_refunds')
      .select('id, owner_id, status')
      .eq('household_id', householdId)
      .eq('fy', plan.fy)
      .eq('kind', 'harvest')
  ).data ?? []) as { id: string; owner_id: string; status: string }[];
  const have = new Map(existing.map((e) => [e.owner_id, e]));
  let n = 0;
  for (const p of plan.plans) {
    if (p.picks.length === 0) continue;
    const row = {
      expected_gain: p.totalGain,
      expected_tds: p.tdsWithheld,
      expected_refund: p.refundExpected,
      description: `Tax-gain harvest: sell ${p.picks.map((x) => x.fund).join(', ')} and buy back`,
      updated_at: new Date().toISOString(),
    };
    const cur = have.get(p.ownerId);
    if (!cur) {
      const { error } = await db.from('tds_refunds').insert({
        household_id: householdId,
        owner_id: p.ownerId,
        fy: plan.fy,
        kind: 'harvest',
        ...row,
      });
      if (error) throw new Error(`refund records: ${error.message}`);
      n += 1;
    } else if (cur.status === 'planned') {
      await db.from('tds_refunds').update(row).eq('id', cur.id);
      n += 1;
    }
  }
  return n;
}

export { planHarvest };
