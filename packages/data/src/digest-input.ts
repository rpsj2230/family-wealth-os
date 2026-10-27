import {
  assembleDigest,
  bankOverview,
  buildBankBlocks,
  compareHoldings,
  depositCover,
  formatInr,
  harvestPlanSummary,
  holdingsFromAssets,
  isEstimateLine,
  moveAmount,
  planHarvest,
  receivableStatus,
  rateOfferFromRow,
  savingsRatesOf,
  settingsFromJson,
  summariseGoals,
  withPeople,
  type DigestInput,
  type DigestSources,
  type RateOffer,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';
import { loadRatesContext } from './rates';
import { loadHarvestPositions } from './harvest';

/**
 * Everything the daily summary needs for one household, from whichever Supabase client is supplied: the rows are read here and put
 * together by `assembleDigest` (core), which uses the functions Home, Goals and "Can I retire now?" use, so the e-mail agrees with
 * the portal. Reads only. `includeGoals` and `includeRetirement` are the two switches in Settings > Notifications.
 */
export async function buildDigestInput(
  db: SupabaseClient,
  opts: {
    householdId?: string;
    date: string;
    householdName: string;
    appUrl: string;
    includeRetirement?: boolean;
    includeGoals?: boolean;
  },
): Promise<DigestInput> {
  const today = new Date(opts.date + 'T00:00:00Z');
  const scoped = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  const l = await loadPortfolioData(db, {
    ...(opts.householdId ? { householdId: opts.householdId } : {}),
    today,
  });
  const { assetRows, obsRows, fdRows, ownerName, portfolio, marketDates, fundDay } = l;
  const st = await loadSettings(db, opts.householdId);
  const cfg = st.config;
  const [
    snaps,
    recv,
    pays,
    plan,
    pols,
    taskRows,
    insts,
    offerRows,
    jointRows,
    positions,
    txns,
    goalRows,
    allocRows,
    people,
    inbox,
  ] = await Promise.all([
    pageAll<{
      taken_on: string;
      total: number;
      by_type: Record<string, number> | null;
      by_owner: Record<string, number> | null;
    }>((from, to) =>
      scoped('snapshots', 'taken_on, total, by_type, by_owner')
        .order('taken_on', { ascending: true })
        .range(from, to),
    ),
    scoped('receivables', 'asset_id, counterparty, lent, expected_on'),
    scoped('receivable_payments', 'asset_id, amount'),
    scoped('plan_settings', 'settings').maybeSingle(),
    scoped('policies', 'insurer, renewal_on, expires_on'),
    scoped('tasks', 'title, due_on').eq('status', 'open').not('due_on', 'is', null),
    scoped('institutions', 'id, name, deposit_insured'),
    scoped(
      'rate_offers',
      'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to, tenure_days, source_note, source_url',
    ),
    scoped('assets', 'id, joint_holder_id').not('joint_holder_id', 'is', null),
    scoped('mf_positions', 'asset_id, invested, sip_monthly, sip_stopped'),
    pageAll<{ asset_id: string; source: string | null; description: string | null }>((from, to) =>
      scoped('mf_transactions', 'asset_id, source, description').order('id').range(from, to),
    ),
    scoped('goals', 'id, name, kind, target_amount, target_date, inflation_rate').order('name'),
    scoped('goal_allocations', 'goal_id, asset_id, method, value'),
    scoped('owners', 'dob, plan_role'),
    (async () => {
      const q = db
        .from('inbox_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outcome', 'needs_review')
        .is('resolved_at', null);
      return opts.householdId ? q.eq('household_id', opts.householdId) : q;
    })(),
  ]);

  const value = new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]));
  const instRows = (insts.data ?? []) as unknown as {
    id: string;
    name: string;
    deposit_insured: boolean | null;
  }[];
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: Object.fromEntries(instRows.map((i) => [i.id, i.name])),
    today,
  });
  const offers: RateOffer[] = ((offerRows.data ?? []) as unknown as Record<string, unknown>[]).map(
    rateOfferFromRow,
  );
  // the same rate each savings account earns on Accounts: its own, the bank's listed slab, else the assumed rate
  const rates = savingsRatesOf(
    blocks.flatMap((b) => b.sections.flatMap((s) => s.rows.map((r) => ({ ...r, bank: b.name })))),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    cfg.estimates.savingsRate,
  );
  const overview = bankOverview(blocks, {
    today,
    soonDays: cfg.reminders.maturitySoonDays,
    savingsRates: Object.fromEntries(Object.entries(rates).map(([id, c]) => [id, c.rate])),
    defaultSavingsRate: cfg.estimates.savingsRate,
    tdsRate: cfg.estimates.interestTdsRate,
  });
  const cover = depositCover({
    assets: assetRows,
    valued: portfolio.valued,
    jointHolders: Object.fromEntries(
      ((jointRows.data ?? []) as unknown as { id: string; joint_holder_id: string }[]).map((j) => [
        j.id,
        j.joint_holder_id,
      ]),
    ),
    outside: new Set(instRows.filter((i) => i.deposit_insured === false).map((i) => i.id)),
    limit: cfg.deposits.insuranceLimit,
  });

  // the funds as Investments counts them: value, the amount entered as invested, and the move over the last two prices
  const owned = new Set(assetRows.map((a) => a.id));
  const pos = (
    (positions.data ?? []) as unknown as {
      asset_id: string;
      invested: number | null;
      sip_monthly: number | null;
      sip_stopped: boolean;
    }[]
  ).filter((p) => owned.has(p.asset_id));
  const withStatement = new Set(txns.filter((t) => !isEstimateLine(t)).map((t) => t.asset_id));
  const fundValue = pos.reduce((a, p) => a + (value.get(p.asset_id) ?? 0), 0);
  const fundsToday = pos.reduce((a, p) => {
    const v = value.get(p.asset_id) ?? 0;
    const move = fundDay[p.asset_id];
    return move && v > 0 ? a + moveAmount(v, move.pct) : a;
  }, 0);
  const funds: DigestSources['funds'] =
    pos.length > 0
      ? {
          count: pos.length,
          invested: pos.reduce((a, p) => a + Number(p.invested ?? 0), 0),
          value: fundValue,
          today: fundsToday,
          withoutStatement: pos.filter((p) => !withStatement.has(p.asset_id)).length,
        }
      : null;
  const sipMonthly = pos
    .filter((p) => !p.sip_stopped)
    .reduce((a, p) => a + Number(p.sip_monthly ?? 0), 0);

  // goals (the same arithmetic as the Goals page)
  const sips = new Map(
    pos.map((p) => [p.asset_id, p.sip_stopped ? 0 : Number(p.sip_monthly ?? 0)]),
  );
  const goals =
    opts.includeGoals === false
      ? null
      : summariseGoals({
          goals: ((goalRows.data ?? []) as unknown as Record<string, unknown>[]).map((g) => ({
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
          allocations: ((allocRows.data ?? []) as unknown as Record<string, unknown>[]).map(
            (a) => ({
              goalId: a.goal_id as string,
              assetId: a.asset_id as string,
              method: a.method as 'percent' | 'amount',
              value: Number(a.value),
            }),
          ),
          values: value,
          sips,
          today: opts.date,
        });

  // retirement: the saved plan, when there is one and the person left the view on
  let retirement: DigestSources['retirement'] = null;
  if (opts.includeRetirement !== false && plan.data) {
    retirement = {
      settings: withPeople(
        settingsFromJson((plan.data as unknown as { settings: unknown }).settings),
        (people.data ?? []) as unknown as { dob: string | null; plan_role: string | null }[],
      ),
      holdings: holdingsFromAssets(portfolio.valued),
      sipMonthly,
    };
  }

  // what needs the person
  const status = new Map(assetRows.map((a) => [a.id, a.status]));
  const paid = new Map<string, number>();
  for (const p of (pays.data ?? []) as unknown as { asset_id: string; amount: number }[])
    paid.set(p.asset_id, (paid.get(p.asset_id) ?? 0) + Number(p.amount));
  const overdueLoans = (
    (recv.data ?? []) as unknown as {
      asset_id: string;
      counterparty: string;
      lent: number;
      expected_on: string | null;
    }[]
  )
    .filter((r) => status.get(r.asset_id) !== 'gifted')
    .map((r) => ({
      name: r.counterparty,
      s: receivableStatus(
        {
          id: r.asset_id,
          lent: Number(r.lent),
          repayments: paid.has(r.asset_id) ? [{ amount: paid.get(r.asset_id)!, on: today }] : [],
          expectedOn: r.expected_on ? new Date(r.expected_on + 'T00:00:00Z') : null,
        },
        today,
      ),
    }))
    .filter((x) => x.s.status === 'overdue')
    .map((x) => ({ name: x.name, outstanding: x.s.outstanding, daysOverdue: x.s.daysOverdue }));
  const policies = (
    (pols.data ?? []) as unknown as {
      insurer: string;
      renewal_on: string | null;
      expires_on: string | null;
    }[]
  ).flatMap((p) => [
    ...(p.renewal_on ? [{ insurer: p.insurer, kind: 'renewal' as const, on: p.renewal_on }] : []),
    ...(p.expires_on ? [{ insurer: p.insurer, kind: 'ends' as const, on: p.expires_on }] : []),
  ]);
  const tasks = ((taskRows.data ?? []) as unknown as { title: string; due_on: string }[]).map(
    (t) => ({ title: t.title, dueOn: t.due_on }),
  );

  const bankDates = obsRows
    .filter((o) => assetRows.find((a) => a.id === o.asset_id)?.type === 'bank_account')
    .map((o) => o.as_of);
  const lastBank = bankDates.length ? bankDates.reduce((m, d) => (d > m ? d : m)) : null;

  // tax: the harvest deadline and what is still to be claimed back
  let taxIdeas: string[] = [];
  try {
    const hv = await loadHarvestPositions(db, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      today,
    });
    const hp = planHarvest(hv.positions, opts.date, {
      rules: st.rules,
      config: cfg.harvest,
      ytdRealised: hv.ytdRealised,
    });
    taxIdeas = harvestPlanSummary(hp, opts.date, hv.ownerName);
    const rf = await scoped(
      'tds_refunds',
      'owner_id, fy, kind, expected_refund, refund_received, status',
    );
    const open = (
      (rf.data ?? []) as unknown as {
        expected_refund: number;
        refund_received: number | null;
        status: string;
      }[]
    ).filter((r) => r.status !== 'received');
    const sum = open.reduce((a, r) => a + Number(r.expected_refund), 0);
    if (sum > 0)
      taxIdeas.push(
        `Tax refunds still to claim or receive: about ${formatInr(Math.round(sum))} (see Tax in the app).`,
      );
  } catch {
    // tax lines are optional; the summary goes out without them
  }

  // better rates elsewhere, and how many banks' rates are old
  let rateIdeas: string[] = [];
  let staleRates = 0;
  try {
    const rc = await loadRatesContext(db, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      today,
    });
    rateIdeas = compareHoldings(
      rc.holdings,
      rc.offers,
      rc.config.rates,
      opts.date,
      rc.config.deposits.insuranceLimit,
    )
      .filter((x) => x.offerAgeDays <= rc.config.rates.staleDays)
      .map((x) => x.text);
    const old = new Set(
      rc.offers
        .filter(
          (o) =>
            (Date.parse(opts.date) - Date.parse(o.checkedOn)) / 86_400_000 >
            rc.config.rates.staleDays,
        )
        .map((o) => o.bank),
    );
    staleRates = old.size;
  } catch {
    // rates are optional; the summary goes out without them
  }

  // on the first of a month: how the month went
  let monthly: DigestInput['monthly'] = null;
  if (opts.date.slice(8) === '01') {
    const d = new Date(`${opts.date}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const since = d.toISOString().slice(0, 10);
    const old = [...snaps].filter((s) => s.taken_on <= since).pop();
    if (old)
      monthly = {
        since: old.taken_on,
        change: Math.round(portfolio.netWorth.total - Number(old.total)),
        byPerson: Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => ({
          name: ownerName.get(id) ?? 'Unknown',
          change: Math.round(v - Number(old.by_owner?.[id] ?? 0)),
        })),
      };
  }

  return assembleDigest({
    date: opts.date,
    householdName: opts.householdName,
    appUrl: opts.appUrl,
    config: cfg,
    portfolio,
    blocks,
    overview,
    cover,
    funds,
    snapshots: snaps
      .filter((s) => s.taken_on < opts.date)
      .map((s) => ({
        date: s.taken_on,
        total: Number(s.total),
        byType: s.by_type ?? {},
        byOwner: s.by_owner ?? {},
      })),
    ownerNames: Object.fromEntries(ownerName),
    newestRecorded: obsRows.reduce<string | null>(
      (m, o) => (!m || o.as_of > m ? o.as_of : m),
      null,
    ),
    lastBankBalanceAsOf: lastBank,
    market:
      marketDates.navLatest || Object.keys(marketDates.fx).length
        ? { navLatest: marketDates.navLatest, fx: marketDates.fx }
        : { navLatest: null, fx: {} },
    goals,
    retirement,
    attention: { overdueLoans, tasks, policies, inboxReview: inbox.count ?? 0 },
    taxIdeas,
    rateIdeas,
    staleRates,
    monthly,
  });
}
