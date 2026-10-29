import {
  isCounted,
  isEstimatedTxn,
  latestObservations,
  receivableStatus,
  type AssetType,
  type CentreFund,
  type CentreGoal,
  type CentreHolding,
  type CentreInput,
  type CentreFx,
  type HoldingClass,
  type SavedReport,
} from '@fwos/core';
import { loadSettings, pageAll, unpricedFunds } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';
import { loadGoalSummaries, type GoalSummary } from './goals-view';
import { loadReportsInput } from './reports-data';
import { loadPortfolio } from './portfolio-data';

const CLASS_OF: Partial<Record<AssetType, HoldingClass>> = {
  bank_account: 'cash',
  fixed_deposit: 'fd',
  mutual_fund: 'funds',
};

const GOAL_WORDS = {
  on_track: 'On track',
  shortfall: 'Behind: more needed',
  past_due: 'Date passed',
  no_target: 'No target set',
} as const;

export interface CentreData {
  input: CentreInput;
  /** for the phrase reader and the filter choices */
  banks: string[];
  amcs: string[];
  saved: SavedReport[];
}

/**
 * Everything the Report Centre reads, from the loaders the other pages use (the portfolio, the deposits, the fund ledgers, the goals),
 * plus the daily snapshots and money lent. Nothing new is asked of the household.
 */
export async function loadCentreInput(supabase: Ctx['supabase']): Promise<CentreData> {
  const loaded = await loadPortfolio(supabase);
  const { today, assetRows, obsRows, portfolio, ownerName } = loaded;
  const todayIso = today.toISOString().slice(0, 10);
  const [reports, settings, goals, snaps, insts, recv, pays, unpriced] = await Promise.all([
    loadReportsInput(supabase, { funds: true }),
    loadSettings(supabase as unknown as SupabaseClient),
    loadGoalSummaries(supabase, loaded),
    pageAll<{
      taken_on: string;
      total: number;
      by_type: Record<string, number> | null;
      by_owner: Record<string, number> | null;
    }>((from, to) =>
      supabase
        .from('snapshots')
        .select('taken_on, total, by_type, by_owner')
        .order('taken_on', { ascending: true })
        .range(from, to),
    ),
    supabase.from('institutions').select('id, name'),
    supabase.from('receivables').select('asset_id, counterparty, lent, expected_on'),
    supabase.from('receivable_payments').select('asset_id, amount'),
    unpricedFunds(supabase as unknown as SupabaseClient, assetRows),
  ]);
  const bankName = new Map((insts.data ?? []).map((b) => [b.id as string, b.name as string]));
  const assetBy = new Map(assetRows.map((a) => [a.id, a]));
  const latest = latestObservations(obsRows);

  const holdings: CentreHolding[] = portfolio.valued.filter(isCounted).map((v) => {
    const a = assetBy.get(v.assetId);
    const line = portfolio.lines[v.assetId];
    const obs = latest.get(v.assetId);
    const currency = a?.currency ?? 'INR';
    const fd = loaded.fdRows.find((f) => f.asset_id === v.assetId);
    const fund = reports.view?.groups.flatMap((g) => g.funds).find((f) => f.assetId === v.assetId);
    return {
      id: v.assetId,
      name: v.name,
      ownerId: v.ownerId,
      cls: CLASS_OF[v.type] ?? 'others',
      type: v.type,
      bank: a?.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
      currency,
      value: v.estimate!.estimatedAmount,
      native: currency !== 'INR' && obs ? Number(obs.amount) : null,
      cost: fd ? Number(fd.principal) : fund ? fund.invested : null,
      asOf: line?.asOf ?? null,
      estimated: v.estimate!.basis !== 'calculated' || !!line?.usedAssumption,
      stale: line?.freshness === 'stale' || line?.freshness === 'missing',
    };
  });

  const fx = foreignOf(holdings, (id) => portfolio.lines[id]?.marketDate ?? null);

  const funds: CentreFund[] = (reports.view?.groups ?? []).flatMap((g) =>
    g.funds.map((f) => ({
      id: f.assetId,
      name: f.name,
      ownerId: g.ownerId,
      amc: f.amc,
      category: f.category.label,
      plan: f.plan,
      value: f.value,
      cost: f.invested,
      units: f.units,
      hasStatement: f.hasStatement,
      txns: f.txns.map((t) => ({
        date: t.date,
        kind: t.kind,
        units: t.units,
        amount: t.amount,
        estimated: isEstimatedTxn(t),
      })),
      realised: f.realised,
    })),
  );

  const paid = new Map<string, number>();
  for (const x of pays.data ?? [])
    paid.set(x.asset_id as string, (paid.get(x.asset_id as string) ?? 0) + Number(x.amount));
  const gifted = new Set(assetRows.filter((a) => a.status === 'gifted').map((a) => a.id));
  const receivables = (recv.data ?? [])
    .filter((r) => !gifted.has(r.asset_id as string))
    .map((r) => {
      const id = r.asset_id as string;
      const s = receivableStatus(
        {
          id,
          lent: Number(r.lent),
          repayments: paid.has(id) ? [{ amount: paid.get(id)!, on: today }] : [],
          expectedOn: r.expected_on ? new Date(`${r.expected_on as string}T00:00:00Z`) : null,
        },
        today,
      );
      return {
        id,
        name: r.counterparty as string,
        outstanding: s.outstanding,
        expectedOn: (r.expected_on as string | null) ?? null,
        daysOverdue: s.daysOverdue,
        settled: s.status === 'settled' || s.status === 'overpaid',
      };
    });

  const goalRows: CentreGoal[] = goals.map(centreGoal);

  const deposits = reports.fdLines
    .filter((l) => l.principal > 0)
    .map((l) => {
      const row = loaded.fdRows.find((f) => f.asset_id === l.id);
      return {
        id: l.id,
        name: l.nickname,
        bank: l.bank,
        ownerId: l.ownerId,
        principal: l.principal,
        rate: l.rate,
        bookedOn: l.bookedOn,
        maturityOn: l.maturityOn,
        maturityAmount: l.bankMaturity ?? row?.bank_maturity_amount ?? l.accruedToday,
        compounding: l.compounding ?? 'quarterly',
        running: l.status === 'active' && l.daysLeft >= 0,
      };
    });

  const first = obsRows.reduce<string | null>((m, o) => (!m || o.as_of < m ? o.as_of : m), null);
  return {
    input: {
      today: todayIso,
      first,
      people: Object.fromEntries(ownerName),
      holdings,
      deposits,
      funds,
      fx,
      snapshots: snaps.map((s) => ({
        date: s.taken_on,
        total: Number(s.total),
        byType: s.by_type ?? {},
        byOwner: s.by_owner ?? {},
      })),
      receivables,
      goals: goalRows,
      financialQuarters: settings.config.funds.financialQuarters,
      quality: { toAnswer: null, fundsNoPrice: unpriced.waiting.length },
    },
    banks: [...new Set(holdings.map((h) => h.bank).filter((b): b is string => !!b))].sort(),
    amcs: [...new Set(funds.map((f) => f.amc).filter((a): a is string => !!a))].sort(),
    saved: settings.config.reports.saved,
  };
}

/** Foreign cash by currency: the balance in its own currency, its rupee value, the rate between them and the rate's date. */
export function foreignOf(
  holdings: CentreHolding[],
  marketDate: (id: string) => string | null,
): CentreFx[] {
  const fxBy = new Map<string, CentreFx>();
  for (const h of holdings) {
    if (h.cls !== 'cash' || h.currency === 'INR' || h.native === null || h.native === 0) continue;
    const cur = fxBy.get(h.currency) ?? {
      currency: h.currency,
      native: 0,
      inr: 0,
      rate: 0,
      rateDate: null,
      asOf: null,
      accounts: 0,
    };
    cur.native += h.native;
    cur.inr += h.value;
    cur.accounts++;
    const md = marketDate(h.id);
    if (md && (!cur.rateDate || md > cur.rateDate)) cur.rateDate = md;
    if (h.asOf && (!cur.asOf || h.asOf > cur.asOf)) cur.asOf = h.asOf;
    fxBy.set(h.currency, cur);
  }
  return [...fxBy.values()]
    .map((f) => ({ ...f, rate: f.native ? f.inr / f.native : 0, rateDate: f.rateDate ?? f.asOf }))
    .sort((a, b) => b.inr - a.inr);
}

/** A goal as the Report Centre lists it: its target (the future cost when worked out), what is set aside and where it stands. */
export const centreGoal = (g: GoalSummary): CentreGoal => ({
  id: g.id,
  name: g.name,
  target: g.futureCost ?? g.targetToday ?? null,
  targetOn: g.targetDate,
  setAside: g.allocated,
  status: GOAL_WORDS[g.proj.status] ?? g.proj.status,
});
