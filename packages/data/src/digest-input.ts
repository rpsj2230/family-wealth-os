import {
  assess,
  compareHoldings,
  buildPlan,
  earliestRetirementAge,
  holdingsFromAssets,
  formatInr,
  harvestPlanSummary,
  positionAsOf,
  positionGains,
  maturityAlerts,
  planHarvest,
  overdueMaturities,
  receivableStatus,
  settingsFromJson,
  withPeople,
  type DigestInput,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { loadPositionInput } from './position';
import { loadSettings } from './settings';
import { loadRatesContext } from './rates';
import { loadHarvestPositions } from './harvest';

const STATUS_TEXT = {
  meets_plan: 'projected to meet the plan under your assumptions',
  shortfall: 'projected shortfall under your assumptions',
  insufficient_data: 'insufficient data to assess',
} as const;

/** Everything the daily summary needs for one household, from whichever Supabase client is supplied. */
export async function buildDigestInput(
  db: SupabaseClient,
  opts: {
    householdId?: string;
    date: string;
    householdName: string;
    appUrl: string;
    includeRetirement?: boolean;
  },
): Promise<DigestInput> {
  const today = new Date(opts.date + 'T00:00:00Z');
  const scoped = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  const loadedAll = await loadPortfolioData(db, {
    ...(opts.householdId ? { householdId: opts.householdId } : {}),
    today,
  }).then(async (l) => {
    const pos = await scoped('mf_positions', 'sip_monthly, sip_stopped');
    const sips = (
      (pos.data ?? []) as unknown as { sip_monthly: number | null; sip_stopped: boolean }[]
    )
      .filter((x) => !x.sip_stopped)
      .reduce((s, x) => s + Number(x.sip_monthly ?? 0), 0);
    return { ...l, sipMonthly: sips };
  });
  const { assetRows, obsRows, fdRows, ownerName, portfolio, marketDates, sipMonthly } = loadedAll;

  const cfg = (await loadSettings(db, opts.householdId)).config;
  // what the holdings earned, from the same function Home uses; the summary goes out without it if the records cannot be read
  let gains: DigestInput['gains'] = null;
  let position: Awaited<ReturnType<typeof loadPositionInput>> | null = null;
  try {
    position = await loadPositionInput(db, loadedAll, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      config: cfg,
    });
    const g = positionGains({ position, recentDays: cfg.home.changeDays });
    gains = {
      days: cfg.home.changeDays,
      recent: g.tiles.find((t) => t.key === 'recent')!,
      fy: g.tiles.find((t) => t.key === 'fy')!,
    };
  } catch {
    // the records could not be read: no earnings line, and the month review falls back to the saved snapshots
  }
  const [snaps, recv, pays, settings, pols, taskRows] = await Promise.all([
    scoped('snapshots', 'taken_on, total')
      .lt('taken_on', opts.date)
      .order('taken_on', { ascending: false })
      .limit(1),
    scoped('receivables', 'asset_id, counterparty, lent, expected_on'),
    scoped('receivable_payments', 'asset_id, amount'),
    scoped('plan_settings', 'settings').maybeSingle(),
    scoped('policies', 'insurer, renewal_on, expires_on'),
    scoped('tasks', 'title, due_on').eq('status', 'open').not('due_on', 'is', null),
  ]);
  const tasksDue = ((taskRows.data ?? []) as unknown as { title: string; due_on: string }[]).map(
    (t) => ({ title: t.title, dueOn: t.due_on }),
  );

  const name = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const status = new Map(assetRows.map((a) => [a.id, a.status]));
  const fdList = fdRows.map((f) => ({
    id: f.asset_id,
    name: name.get(f.asset_id) ?? 'FD',
    maturityOn: new Date(f.maturity_on + 'T00:00:00Z'),
    status: status.get(f.asset_id) ?? 'active',
  }));
  const valued = new Map(
    portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  const bankMat = new Map(fdRows.map((f) => [f.asset_id, f.bank_maturity_amount]));

  const paid = new Map<string, number>();
  for (const p of (pays.data ?? []) as unknown as { asset_id: string; amount: number }[]) {
    paid.set(p.asset_id, (paid.get(p.asset_id) ?? 0) + Number(p.amount));
  }
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

  const policyDates = (
    (pols.data ?? []) as unknown as {
      insurer: string;
      renewal_on: string | null;
      expires_on: string | null;
    }[]
  ).flatMap((p) => [
    ...(p.renewal_on ? [{ insurer: p.insurer, kind: 'renewal' as const, on: p.renewal_on }] : []),
    ...(p.expires_on ? [{ insurer: p.insurer, kind: 'ends' as const, on: p.expires_on }] : []),
  ]);

  const bankDates = obsRows
    .filter((o) => assetRows.find((a) => a.id === o.asset_id)?.type === 'bank_account')
    .map((o) => o.as_of);
  const lastBank = bankDates.length ? bankDates.reduce((m, d) => (d > m ? d : m)) : null;

  let retirement: DigestInput['retirement'] = null;
  if (opts.includeRetirement !== false && settings.data) {
    const ppl = ((await scoped('owners', 'dob, plan_role')).data ?? []) as unknown as {
      dob: string | null;
      plan_role: string | null;
    }[];
    const s = withPeople(
      settingsFromJson((settings.data as unknown as { settings: unknown }).settings),
      ppl,
    );
    if (s.monthlySpendingToday > 0 && s.primaryDob) {
      const plan = buildPlan(s, holdingsFromAssets(portfolio.valued), sipMonthly, opts.date);
      const r = assess(plan, s.assumptions);
      retirement = {
        statusText: STATUS_TEXT[r.status],
        earliestAge:
          r.status === 'insufficient_data'
            ? null
            : Math.round((earliestRetirementAge(plan, s.assumptions).earliest ?? NaN) * 10) / 10 ||
              null,
      };
    }
  }

  // tax: the harvest deadline and what is still to be claimed back
  let taxIdeas: string[] = [];
  try {
    const st = await loadSettings(db, opts.householdId);
    const hv = await loadHarvestPositions(db, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      today,
    });
    const plan = planHarvest(hv.positions, opts.date, {
      rules: st.rules,
      config: st.config.harvest,
      ytdRealised: hv.ytdRealised,
    });
    taxIdeas = harvestPlanSummary(plan, opts.date, hv.ownerName);
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

  // on the first of the month: how the month went
  let monthly: DigestInput['monthly'] = null;
  if (opts.date.slice(8) === '01') {
    const d = new Date(`${opts.date}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    const since = d.toISOString().slice(0, 10);
    // rebuilt from the records on file when there are any for that day; else from the snapshot saved nearest before it
    const then = position ? positionAsOf(position, since) : null;
    if (then && then.counted > 0)
      monthly = {
        since,
        change: Math.round(portfolio.netWorth.total - then.total),
        byPerson: Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => ({
          name: ownerName.get(id) ?? 'Unknown',
          change: Math.round(v - (then.byOwner[id] ?? 0)),
        })),
      };
    const old = monthly
      ? null
      : ((
          await scoped('snapshots', 'taken_on, total, by_owner')
            .lte('taken_on', since)
            .order('taken_on', { ascending: false })
            .limit(1)
        ).data as unknown as
          { taken_on: string; total: number; by_owner: Record<string, number> }[] | null);
    if (old?.[0] && !monthly)
      monthly = {
        since: old[0].taken_on,
        change: Math.round(portfolio.netWorth.total - Number(old[0].total)),
        byPerson: Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => ({
          name: ownerName.get(id) ?? 'Unknown',
          change: Math.round(v - Number(old[0]!.by_owner?.[id] ?? 0)),
        })),
      };
  }

  let rateIdeas: string[] = [];
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
  } catch {
    // rates are optional; the summary goes out without them
  }
  const prev = ((snaps.data ?? []) as unknown as { taken_on: string; total: number }[])[0];
  return {
    date: opts.date,
    householdName: opts.householdName,
    netWorth: portfolio.netWorth,
    ownerNames: Object.fromEntries(ownerName),
    previous: prev ? { date: prev.taken_on, total: Number(prev.total) } : null,
    lastBankBalanceAsOf: lastBank,
    attention: {
      maturedUnconfirmed: [
        ...new Set([
          ...fdList.filter((f) => f.status === 'matured_unconfirmed').map((f) => f.name),
          ...overdueMaturities(fdList, today).map((f) => f.name),
        ]),
      ],
      maturingSoon: maturityAlerts(fdList, today, cfg.deposits.maturityAlertDays)
        .filter((a) => a.daysLeft <= cfg.reminders.maturitySoonDays)
        .map((a) => ({
          name: a.name,
          daysLeft: a.daysLeft,
          amount: Number(bankMat.get(a.id) ?? valued.get(a.id) ?? 0),
        })),
      overdueLoans,
      policyDates,
      tasksDue,
      staleOrMissing: Object.values(portfolio.lines).filter(
        (l) => l.freshness === 'stale' || l.freshness === 'missing',
      ).length,
    },
    market:
      marketDates.navLatest || Object.keys(marketDates.fx).length
        ? { navLatest: marketDates.navLatest, fx: marketDates.fx }
        : { navLatest: null, fx: {} },
    retirement,
    reminders: { policyDays: cfg.reminders.policyDays, taskDays: cfg.reminders.taskDays },
    rateIdeas,
    taxIdeas,
    monthly,
    gains,
    appUrl: opts.appUrl,
  };
}
