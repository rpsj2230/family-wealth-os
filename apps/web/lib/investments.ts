import {
  contributionSeries,
  moveAmount,
  returnsFor,
  type FundForReturns,
  type FundTxn,
} from '@fwos/core';
import type { LoadedPortfolio } from '@fwos/data';
import { loadPortfolio } from './portfolio-data';
import type { Ctx } from './data';

export interface FundRow {
  assetId: string;
  ownerId: string;
  name: string;
  value: number;
  invested: number;
  startedOn: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** annual return from the transactions, or estimated from the start date and SIP when there is no statement */
  xirr: number | null;
  xirrEstimated: boolean;
  gain: number;
  /** how much the fund moved over its last two prices, in rupees and as a share */
  dayAmount: number | null;
  dayPct: number | null;
  dayFrom: string | null;
  dayTo: string | null;
  goalIds: string[];
}

export interface Totals {
  funds: number;
  value: number;
  invested: number;
  gain: number;
  xirr: number | null;
  xirrEstimated: boolean;
  dayAmount: number;
  /** share of yesterday's value; null when no fund has a day move */
  dayPct: number | null;
  sipMonthly: number;
}

export interface OwnerGroup {
  ownerId: string;
  name: string;
  panLast4: string | null;
  funds: FundRow[];
  totals: Totals;
}

export interface InvestmentView {
  today: string;
  groups: OwnerGroup[];
  household: Totals;
  /** money put in over time, cumulative by month */
  series: { month: string; cumulative: number }[];
  goals: { id: string; name: string }[];
}

type Supabase = Ctx['supabase'];

function totalsOf(rows: FundRow[], forReturns: FundForReturns[], today: string): Totals {
  const r = returnsFor(forReturns, today);
  const value = rows.reduce((a, f) => a + f.value, 0);
  const invested = rows.reduce((a, f) => a + f.invested, 0);
  const withDay = rows.filter((f) => f.dayAmount !== null);
  const dayAmount = withDay.reduce((a, f) => a + (f.dayAmount ?? 0), 0);
  const prior = withDay.reduce((a, f) => a + f.value - (f.dayAmount ?? 0), 0);
  return {
    funds: rows.length,
    value,
    invested,
    gain: r.funds > 0 ? r.gain : value - invested,
    xirr: r.xirr,
    xirrEstimated: r.estimatedFunds > 0,
    dayAmount,
    dayPct: withDay.length > 0 && prior > 0 ? dayAmount / prior : null,
    sipMonthly: rows.filter((f) => !f.sipStopped).reduce((a, f) => a + (f.sipMonthly ?? 0), 0),
  };
}

/** Everything the Investments page and the dashboard show about mutual funds. `loaded` avoids reading the portfolio twice. */
export async function loadInvestmentView(
  supabase: Supabase,
  loaded?: LoadedPortfolio,
  onlyOwner?: string | null,
): Promise<InvestmentView> {
  const l = loaded ?? (await loadPortfolio(supabase));
  const [pos, tx, goals, allocs, owners] = await Promise.all([
    supabase
      .from('mf_positions')
      .select('asset_id, fund_name, invested, started_on, sip_monthly, sip_stopped'),
    supabase
      .from('mf_transactions')
      .select('asset_id, txn_on, units, amount')
      .order('txn_on')
      .limit(20000),
    supabase.from('goals').select('id, name').order('name'),
    supabase.from('goal_allocations').select('goal_id, asset_id'),
    supabase.from('owners').select('id, display_name, pan_last4').order('created_at'),
  ]);
  const today = l.today.toISOString().slice(0, 10);
  const ownerOf = new Map(l.assetRows.map((a) => [a.id, a.owner_id]));
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  const txBy = new Map<string, FundTxn[]>();
  for (const t of (tx.data ?? []) as unknown as {
    asset_id: string;
    txn_on: string;
    units: number;
    amount: number;
  }[])
    txBy.set(t.asset_id, [
      ...(txBy.get(t.asset_id) ?? []),
      { date: t.txn_on, units: Number(t.units), amount: Number(t.amount) },
    ]);
  const goalsBy = new Map<string, string[]>();
  for (const a of (allocs.data ?? []) as unknown as { goal_id: string; asset_id: string }[])
    goalsBy.set(a.asset_id, [...(goalsBy.get(a.asset_id) ?? []), a.goal_id]);

  const forRet = new Map<string, FundForReturns>();
  const rows: FundRow[] = [];
  for (const p of (pos.data ?? []) as unknown as {
    asset_id: string;
    fund_name: string;
    invested: number | null;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
  }[]) {
    const ownerId = ownerOf.get(p.asset_id);
    if (!ownerId || (onlyOwner && ownerId !== onlyOwner)) continue;
    const v = value.get(p.asset_id) ?? 0;
    const invested = Number(p.invested ?? 0);
    const fr: FundForReturns = {
      assetId: p.asset_id,
      ownerId,
      name: p.fund_name,
      value: v,
      txns: txBy.get(p.asset_id) ?? [],
      plan: {
        invested,
        startedOn: p.started_on,
        sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
        sipStopped: p.sip_stopped,
      },
    };
    forRet.set(p.asset_id, fr);
    const r = returnsFor([fr], today);
    const move = l.fundDay[p.asset_id];
    rows.push({
      assetId: p.asset_id,
      ownerId,
      name: p.fund_name,
      value: v,
      invested,
      startedOn: p.started_on,
      sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
      sipStopped: p.sip_stopped,
      xirr: r.xirr,
      xirrEstimated: r.estimatedFunds > 0,
      gain: r.funds > 0 && r.estimatedFunds === 0 ? r.gain : v - invested,
      dayAmount: move && v > 0 ? moveAmount(v, move.pct) : null,
      dayPct: move ? move.pct : null,
      dayFrom: move?.from ?? null,
      dayTo: move?.to ?? null,
      goalIds: goalsBy.get(p.asset_id) ?? [],
    });
  }
  const groups: OwnerGroup[] = (
    (owners.data ?? []) as unknown as {
      id: string;
      display_name: string;
      pan_last4: string | null;
    }[]
  )
    .map((o) => {
      const funds = rows.filter((r) => r.ownerId === o.id).sort((a, b) => b.value - a.value);
      return {
        ownerId: o.id,
        name: o.display_name,
        panLast4: o.pan_last4,
        funds,
        totals: totalsOf(
          funds,
          funds.map((f) => forRet.get(f.assetId)!),
          today,
        ),
      };
    })
    .filter((g) => g.funds.length > 0);
  return {
    today,
    groups,
    household: totalsOf(
      rows,
      rows.map((f) => forRet.get(f.assetId)!),
      today,
    ),
    series: contributionSeries(rows.map((f) => forRet.get(f.assetId)!)),
    goals: ((goals.data ?? []) as unknown as { id: string; name: string }[]).map((g) => ({
      id: g.id,
      name: g.name,
    })),
  };
}
