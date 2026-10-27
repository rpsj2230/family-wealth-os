import {
  buildBankBlocks,
  buildSources,
  personStyles,
  receivableStatus,
  settingsFromJson,
  type HomeRange,
  type FundForRaise,
} from '@fwos/core';
import { loadPositionInput, loadSettings, pageAll } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';
import { bankOverviewOptions } from './bank-overview-options';
import { buildDeposits } from './deposits';
import { loadGoalSummaries } from './goals-view';
import { buildHome, type HomeInput, type HomeModel } from './home';
import { fundPace, loadInvestmentView } from './investments';
import { loadPortfolio } from './portfolio-data';

type Supabase = Ctx['supabase'];

/** How many of the latest recorded values the "latest updates" list keeps. */
const RECENT = 6;

/**
 * Reads everything Home needs for the signed-in household and builds the page model. Row Level Security limits every read to the
 * household. Returns null while nothing has been recorded yet. The portfolio is loaded once and shared by the fund, goal and bank views.
 */
export async function loadHome(supabase: Supabase, range: HomeRange): Promise<HomeModel | null> {
  const loaded = await loadPortfolio(supabase);
  const { today, assetRows, obsRows, fdRows, ownerName, portfolio } = loaded;
  if (assetRows.length === 0) return null;
  const todayIso = today.toISOString().slice(0, 10);
  const [settings, inv, goals, snaps, insts, pols, tasks, recv, pays, assetsFull, plan, inbox] =
    await Promise.all([
      loadSettings(supabase as unknown as SupabaseClient),
      loadInvestmentView(supabase, loaded),
      loadGoalSummaries(supabase, loaded),
      pageAll<{
        taken_on: string;
        total: number;
        by_type: Record<string, number> | null;
        by_owner: Record<string, number> | null;
        source: string;
      }>((from, to) =>
        supabase
          .from('snapshots')
          .select('taken_on, total, by_type, by_owner, source')
          .order('taken_on', { ascending: true })
          .range(from, to),
      ),
      supabase.from('institutions').select('id, name, deposit_insured'),
      supabase.from('policies').select('id, insurer, renewal_on, expires_on'),
      supabase.from('tasks').select('id, title, due_on').eq('status', 'open'),
      supabase.from('receivables').select('asset_id, counterparty, lent, expected_on'),
      supabase.from('receivable_payments').select('asset_id, amount'),
      supabase
        .from('assets')
        .select(
          'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
        ),
      supabase.from('plan_settings').select('settings').maybeSingle(),
      supabase
        .from('inbox_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outcome', 'needs_review')
        .is('resolved_at', null),
    ]);

  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const bankNames = Object.fromEntries(
    (insts.data ?? []).map((x) => [x.id as string, x.name as string]),
  );
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: bankNames,
    today,
    hideMaturedAfterDays: settings.config.deposits.hideMaturedAfterDays,
  });
  const overview = await bankOverviewOptions({
    supabase,
    blocks,
    assetRows,
    institutions: (insts.data ?? []).map((x) => ({
      id: x.id as string,
      deposit_insured: x.deposit_insured as boolean | null,
    })),
    config: settings.config,
    today,
  });
  const cover = buildDeposits(
    (assetsFull.data ?? []).map((a) => ({
      id: a.id as string,
      ownerId: a.owner_id as string,
      institutionId: (a.institution_id as string | null) ?? null,
      type: a.type as string,
      status: a.status as string,
      nickname: a.nickname as string,
      accountKind: (a.account_kind as string | null) ?? null,
      isJoint: !!a.is_joint,
      jointHolderId: (a.joint_holder_id as string | null) ?? null,
    })),
    portfolio.valued,
    fdRows,
    new Map(Object.entries(bankNames)),
    ownerName,
    today,
    settings.config.deposits.insuranceLimit,
    overview.uninsuredBanks ?? new Set(),
  ).cover;

  const funds: FundForRaise[] = inv.groups.flatMap((g) =>
    g.funds.map((f) => ({
      assetId: f.assetId,
      invested: f.invested,
      startedOn: f.startedOn,
      sipActive: !!f.sipMonthly && !f.sipStopped,
    })),
  );
  const sources = buildSources({
    valued: portfolio.valued,
    assetRows,
    fds: fdRows,
    funds,
    today: todayIso,
    institutionNames: bankNames,
    rules: settings.rules,
    config: settings.config.liquidity,
    nri: settings.config.harvest.nri,
  });

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
        daysOverdue: s.daysOverdue,
        expectedOn: (r.expected_on as string | null) ?? null,
        settled: s.status === 'settled' || s.status === 'overpaid',
      };
    });

  const names = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const recent = obsRows
    .filter((o) => !o.superseded_by)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, RECENT)
    .map((o) => ({
      id: o.id,
      assetId: o.asset_id,
      name: names.get(o.asset_id) ?? 'Account',
      amount: o.amount * (o.fx_rate ?? 1),
      asOf: o.as_of,
      source: o.source,
    }));
  const planned = settingsFromJson(plan.data?.settings);
  const position = await loadPositionInput(supabase as unknown as SupabaseClient, loaded, {
    config: settings.config,
  });

  const input: HomeInput = {
    today: todayIso,
    range,
    styles,
    portfolio,
    blocks,
    overview,
    currencyOf: Object.fromEntries(assetRows.map((a) => [a.id, a.currency])),
    snapshots: snaps.map((s) => ({
      date: s.taken_on,
      total: Number(s.total),
      byType: s.by_type ?? {},
      byOwner: s.by_owner ?? {},
      source: s.source,
    })),
    inv,
    pace: inv.household.funds > 0 ? fundPace(inv) : null,
    goals,
    config: settings.config,
    cover,
    sources,
    receivables,
    policies: (pols.data ?? []).map((p) => ({
      id: p.id as string,
      insurer: p.insurer as string,
      renewalOn: (p.renewal_on as string | null) ?? null,
      expiresOn: (p.expires_on as string | null) ?? null,
    })),
    tasks: (tasks.data ?? [])
      .filter((t) => t.due_on)
      .map((t) => ({ id: t.id as string, title: t.title as string, dueOn: t.due_on as string })),
    openTasks: (tasks.data ?? []).length,
    inboxReview: inbox.count ?? 0,
    position,
    monthlySpending: planned.monthlySpendingToday,
    recent,
    newestRecorded: obsRows.reduce<string | null>(
      (m, o) => (!m || o.as_of > m ? o.as_of : m),
      null,
    ),
  };
  return buildHome(input);
}
