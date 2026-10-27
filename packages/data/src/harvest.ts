import {
  allowanceUsed,
  approximateFlows,
  effectiveRules,
  fundTaxClass,
  fyStartOf,
  harvestDueOn,
  harvestTaskTitle,
  planHarvest,
  realisedSince,
  type HarvestPlan,
  type HarvestLot,
  type HarvestPosition,
} from '@fwos/core';
import { fundLedger, type CasTxn } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';

/** Fund positions with today's value, for the harvest planner. Works with the user's client (RLS) or the service role. */
export async function loadHarvestPositions(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<{
  positions: HarvestPosition[];
  ownerName: Map<string, string>;
  today: Date;
  /** long-term gains already realised this financial year per person, from the fund statements */
  ytdRealised: Record<string, number>;
  /** net short- and long-term equity gains already booked this financial year per person, before set-off */
  ytd: Record<string, { stcg: number; ltcg: number }>;
}> {
  const [l, settings] = await Promise.all([
    loadPortfolioData(db, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      ...(opts.today ? { today: opts.today } : {}),
    }),
    loadSettings(db, opts.householdId),
  ]);
  const q = db
    .from('mf_positions')
    .select(
      'asset_id, fund_name, invested, started_on, sip_monthly, sip_stopped, amfi_code, exit_load_pct, exit_load_days',
    );
  const rows = ((await (opts.householdId ? q.eq('household_id', opts.householdId) : q)).data ??
    []) as unknown as {
    asset_id: string;
    fund_name: string;
    invested: number | null;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
    amfi_code: string | null;
    exit_load_pct: number | null;
    exit_load_days: number | null;
  }[];
  const owner = new Map(l.assetRows.map((a) => [a.id, a.owner_id]));
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  // purchase history from imported fund statements
  const txRows = await pageAll<{
    asset_id: string;
    txn_on: string;
    kind: CasTxn['kind'];
    amount: number;
    units: number;
    nav: number | null;
    balance_units: number | null;
    description: string | null;
    source: string | null;
  }>((from, to) => {
    const tq = db
      .from('mf_transactions')
      .select('asset_id, txn_on, kind, amount, units, nav, balance_units, description, source')
      .order('txn_on', { ascending: true })
      .order('id');
    return (opts.householdId ? tq.eq('household_id', opts.householdId) : tq).range(from, to);
  });
  const byAsset = new Map<string, (CasTxn & { source: string | null })[]>();
  for (const t of txRows)
    byAsset.set(t.asset_id, [
      ...(byAsset.get(t.asset_id) ?? []),
      {
        date: t.txn_on,
        kind: t.kind,
        description: t.description ?? '',
        amount: Number(t.amount),
        units: Number(t.units),
        nav: t.nav === null ? null : Number(t.nav),
        balance: t.balance_units === null ? null : Number(t.balance_units),
        source: t.source,
      },
    ]);
  const todayIso = l.today.toISOString().slice(0, 10);
  // categories (for the tax class) and prices on 31 Jan 2018 (for units bought before 1 Feb 2018)
  const codes = [...new Set(rows.map((r) => r.amfi_code).filter((c): c is string => !!c))];
  const categoryOf = new Map<string, string | null>();
  if (codes.length > 0) {
    const cq = db.from('amfi_schemes').select('code, category').in('code', codes);
    for (const c of ((await cq).data ?? []) as unknown as {
      code: string;
      category: string | null;
    }[])
      categoryOf.set(c.code, c.category);
  }
  const fmv2018 = new Map<string, number>();
  if (codes.length > 0) {
    const fq = db
      .from('mf_navs')
      .select('amfi_code, nav_date, nav')
      .in('amfi_code', codes)
      .gte('nav_date', '2018-01-20')
      .lte('nav_date', '2018-01-31')
      .order('nav_date');
    for (const n of ((await fq).data ?? []) as unknown as { amfi_code: string; nav: number }[])
      fmv2018.set(n.amfi_code, Number(n.nav)); // the last one on or before 31 Jan 2018 wins
  }
  // price history since each fund's start, to estimate lots for funds without a fund statement
  const need = rows.filter((r) => !byAsset.has(r.asset_id) && r.amfi_code && r.started_on);
  const navHist = new Map<string, { date: string; nav: number }[]>();
  if (need.length > 0) {
    const since = need.reduce((m, r) => (r.started_on! < m ? r.started_on! : m), todayIso);
    const needCodes = [...new Set(need.map((r) => r.amfi_code!))];
    const navRows = await pageAll<{ amfi_code: string; nav_date: string; nav: number }>(
      (from, to) =>
        db
          .from('mf_navs')
          .select('amfi_code, nav_date, nav')
          .in('amfi_code', needCodes)
          .gte('nav_date', since)
          .order('nav_date')
          .range(from, to),
    );
    for (const n of navRows)
      navHist.set(n.amfi_code, [
        ...(navHist.get(n.amfi_code) ?? []),
        { date: n.nav_date, nav: Number(n.nav) },
      ]);
  }
  const fyStart = fyStartOf(todayIso);
  const holdingMonths =
    effectiveRules(todayIso, settings.rules)?.rules.equity.holdingMonthsLong ?? null;
  const ytdRealised: Record<string, number> = {};
  const ytd: Record<string, { stcg: number; ltcg: number }> = {};
  const lotsOf = new Map<string, HarvestPosition['lots']>();
  for (const r of rows) {
    const txns = byAsset.get(r.asset_id);
    if (!txns || txns.length === 0 || !owner.has(r.asset_id)) continue;
    // the same ledger the Investments page uses: same-day lines put in order, assumed instalments never decide
    const res = fundLedger({
      txns,
      costValue: Number(r.invested ?? 0) || null,
      unitsHeld: l.fundInfo[r.asset_id]?.units ?? null,
      unitTolerance: settings.config.funds.unitTolerance,
    });
    // lots only count when they add up to the units held; otherwise the old method is used for this fund
    if (res.reconciled)
      lotsOf.set(
        r.asset_id,
        res.lots.map((x) => ({
          acquiredOn: x.acquiredOn === '1900-01-01' ? '0001-01-01' : x.acquiredOn,
          units: x.units,
          cost: x.acquiredOn === '1900-01-01' ? null : x.cost,
          ...(x.estimated ? { estimated: true } : {}),
        })),
      );
    const ow = owner.get(r.asset_id)!;
    if (
      holdingMonths === null ||
      fundTaxClass(r.fund_name, categoryOf.get(r.amfi_code ?? '') ?? null).class !== 'equity'
    )
      continue;
    const booked = realisedSince({ sold: res.realised, fyStart, holdingMonths });
    const cur = (ytd[ow] ??= { stcg: 0, ltcg: 0 });
    cur.stcg += booked.stcg;
    cur.ltcg += booked.ltcg;
  }
  // a short-term loss is set off against long-term gain before the allowance applies
  for (const k of Object.keys(ytd)) {
    const y = ytd[k]!;
    y.stcg = Math.round(y.stcg);
    y.ltcg = Math.round(y.ltcg);
    ytdRealised[k] = allowanceUsed(y);
  }
  const positions: HarvestPosition[] = rows
    .filter((r) => owner.has(r.asset_id))
    .map((r) => {
      let lots = lotsOf.get(r.asset_id);
      let estimated = false;
      // no fund statement: lots are worked out from the SIP plan and the price history, and marked as estimates
      if (!lots && r.amfi_code && r.started_on && Number(r.invested ?? 0) > 0) {
        const series = navHist.get(r.amfi_code) ?? [];
        const navOn = (d: string) =>
          [...series].reverse().find((n) => n.date <= d)?.nav ?? series[0]?.nav ?? null;
        const flows = approximateFlows(
          {
            invested: Number(r.invested),
            startedOn: r.started_on,
            sipMonthly: r.sip_monthly === null ? null : Number(r.sip_monthly),
            sipStopped: r.sip_stopped,
          },
          todayIso,
        );
        const built: HarvestLot[] = [];
        for (const f of flows) {
          const n = navOn(f.date);
          if (n && n > 0)
            built.push({
              acquiredOn: f.date,
              units: f.amount / n,
              cost: f.amount,
              estimated: true,
            });
        }
        if (built.length > 0 && built.length === flows.length) {
          const known = l.fundInfo[r.asset_id]?.units ?? null;
          const total = built.reduce((a, x) => a + x.units, 0);
          // when the units held are known, the estimated lots are scaled to them
          const k = known && known > 0 && total > 0 ? known / total : 1;
          lots = built.map((x) => ({ ...x, units: x.units * k }));
          estimated = true;
        }
      }
      void estimated;
      const cls = fundTaxClass(r.fund_name, categoryOf.get(r.amfi_code ?? '') ?? null);
      return {
        assetId: r.asset_id,
        ownerId: owner.get(r.asset_id)!,
        fund: r.fund_name,
        value: value.get(r.asset_id) ?? 0,
        invested: Number(r.invested ?? 0),
        startedOn: r.started_on,
        sipActive: !!r.sip_monthly && !r.sip_stopped,
        taxClass: cls.class,
        classCertain: cls.certain,
        nav: l.fundInfo[r.asset_id]?.nav ?? null,
        lockInMonths: cls.lockInMonths,
        ...(r.exit_load_pct !== null && r.exit_load_days !== null
          ? { exitLoad: { pct: Number(r.exit_load_pct), days: r.exit_load_days } }
          : {}),
        ...(r.amfi_code && fmv2018.has(r.amfi_code) ? { fmv2018: fmv2018.get(r.amfi_code)! } : {}),
        ...(lots ? { lots } : {}),
      };
    });
  return { positions, ownerName: l.ownerName, today: l.today, ytdRealised, ytd };
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
