import {
  assess,
  compareHoldings,
  buildPlan,
  earliestRetirementAge,
  holdingsFromAssets,
  maturityAlerts,
  overdueMaturities,
  receivableStatus,
  settingsFromJson,
  withPeople,
  type DigestInput,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { loadSettings } from './settings';
import { loadRatesContext } from './rates';

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
  const { assetRows, obsRows, fdRows, ownerName, portfolio, marketDates, sipMonthly } =
    await loadPortfolioData(db, {
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

  const cfg = (await loadSettings(db, opts.householdId)).config;
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
    appUrl: opts.appUrl,
  };
}
