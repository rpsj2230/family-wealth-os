import Link from 'next/link';
import { PersonBadge } from '@/components/Person';
import {
  buildBankBlocks,
  changeSince,
  formatInr,
  formatInrCompact,
  freshnessSummary,
  linearPath,
  liquidityLadder,
  maturityAlerts,
  paceFromSeries,
  personStyles,
  receivableStatus,
  sourceTag,
  toShares,
  upcomingEvents,
} from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { loadAccess, loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { InvestHeadline, pct, rupees, tone } from '@/components/InvestHeadline';
import { fundPace, loadInvestmentView } from '@/lib/investments';
import { loadGoalSummaries } from '@/lib/goals-view';
import { SetupChecklist } from '@/components/SetupChecklist';
import { loadSetupStatus } from '@/lib/setup-status';
import { buildDeposits } from '@/lib/deposits';
import { BarList, Donut, Sparkline } from '@/components/charts';
import { FundChart } from '@/components/FundChart';
import { TrendChart } from '@/components/TrendChart';
import { UpdatedCell, fmtDate } from '@/components/BankTable';
import { addMember, createHousehold } from './actions';
import { SnapshotBeacon } from './SnapshotBeacon';
import { WhatsAppButton } from './share/WhatsAppButton';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  bank_account: 'Bank balances',
  fixed_deposit: 'Fixed deposits',
  mutual_fund: 'Mutual funds',
  stock: 'Stocks',
  receivable: 'Money lent',
  property: 'Property',
  ulip: 'ULIP / pension',
  nps: 'NPS',
  third_party_held: 'Held by others',
  other: 'Other',
};
const BASIS_LABEL: Record<string, string> = {
  calculated: 'Calculated from contract terms or units × NAV',
  estimated: 'Estimated (assumed interest rate or NAV change)',
  carried_forward: 'Carried forward from the last recorded value',
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase, householdId, role } = await loadContext();

  if (!householdId) {
    return (
      <section className="card">
        <h1>Set up your household</h1>
        <p className="muted">
          This creates the private space that you and your spouse share. You become its
          administrator.
        </p>
        {problem && (
          <p className="notice warn" role="alert">
            Could not set up the household: {problem}. If you share an account with someone who has
            already set it up, ask them to add you, or sign in with the same email they used.
          </p>
        )}
        <form action={createHousehold} className="form">
          <label>
            Household name
            <input name="name" defaultValue="Our household" required />
          </label>
          <button className="btn primary">Create household</button>
        </form>
      </section>
    );
  }

  const loadedP = loadPortfolio(supabase);
  const [
    { today, assetRows, obsRows, fdRows, ownerName: nameOf, portfolio: p },
    tasks,
    recv,
    pays,
    snaps,
    inv,
  ] = await Promise.all([
    loadedP,
    supabase.from('tasks').select('id, status').eq('status', 'open'),
    supabase.from('receivables').select('asset_id, counterparty, lent, expected_on'),
    supabase.from('receivable_payments').select('asset_id, amount, paid_on'),
    supabase.from('snapshots').select('taken_on, total').order('taken_on', { ascending: true }),
    loadedP.then((l) => loadInvestmentView(supabase, l)),
  ]);

  if (assetRows.length === 0) {
    return (
      <section className="card">
        <h1>Welcome</h1>
        <p>Your household is ready, but nothing has been recorded yet.</p>
        <p>
          <Link className="btn primary" href="/import">
            Import your Excel workbook
          </Link>
        </p>
        {role === 'admin' && <AddMember />}
      </section>
    );
  }

  const nw = p.netWorth;
  const todayIso = today.toISOString().slice(0, 10);
  const styles = personStyles([...nameOf.entries()].map(([id, name]) => ({ id, name })));
  const nickname = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const [settings, insts, pols, openTasks, assetsFull, goalList, setup] = await Promise.all([
    loadSettings(supabase as unknown as SupabaseClient),
    supabase.from('institutions').select('id, name'),
    supabase.from('policies').select('id, insurer, kind, renewal_on, expires_on'),
    supabase
      .from('tasks')
      .select('id, title, due_on')
      .eq('status', 'open')
      .not('due_on', 'is', null),
    supabase
      .from('assets')
      .select(
        'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
      ),
    loadedP.then((l) => loadGoalSummaries(supabase, l)),
    loadSetupStatus(supabase),
  ]);
  const bankNames = Object.fromEntries(
    (insts.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio: p,
    institutionNames: bankNames,
    today,
  });
  const allRows = blocks.flatMap((b) =>
    b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
  );

  // --- headline numbers
  const series = (snaps.data ?? []).map((x) => ({
    date: x.taken_on as string,
    value: Number(x.total),
  }));
  const trend = [...series.filter((x) => x.date < todayIso), { date: todayIso, value: nw.total }];
  const month = changeSince(trend, 30);
  const pace = paceFromSeries(trend);
  const projection =
    pace && pace.months >= 2 && trend.length >= 3
      ? linearPath(trend[trend.length - 1]!, pace.monthlyChange, 2)
      : [];
  const liquid = nw.byLiquidity.liquid;

  // --- allocation
  const palette = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#64748b'];
  const typeShares = toShares(
    Object.fromEntries(Object.entries(nw.byType).map(([k, v]) => [k, v ?? 0])),
    TYPE_LABEL,
    6,
  );
  const personShares = toShares(
    nw.byOwner,
    Object.fromEntries(Object.entries(styles).map(([id, st]) => [id, st.name])),
    6,
  );
  const currencyAmounts: Record<string, number> = {};
  const currencyOf = new Map(assetRows.map((a) => [a.id, a.currency]));
  for (const v of p.valued) {
    const amt = v.estimate?.estimatedAmount;
    if (amt && ['active', 'stopped'].includes(v.status))
      currencyAmounts[currencyOf.get(v.assetId) ?? 'INR'] =
        (currencyAmounts[currencyOf.get(v.assetId) ?? 'INR'] ?? 0) + amt;
  }
  const currencyShares = toShares(currencyAmounts, {}, 4);
  const bankShares = toShares(
    Object.fromEntries(
      blocks.filter((b) => b.key !== '__none').map((b) => [b.key, b.totals.current]),
    ),
    bankNames,
    6,
  );

  // --- liquidity ladder
  const ladder = liquidityLadder({
    today: todayIso,
    cashNow: blocks.reduce((sum, b) => sum + b.totals.cash, 0),
    deposits: allRows
      .filter((r) => r.fd && r.status === 'active')
      .map((r) => ({
        name: `${r.bank} ${r.code}`,
        maturityOn: r.fd!.maturityOn,
        amount: r.fd!.maturityAmount,
      })),
  });
  const ladderTotal = ladder[ladder.length - 1]!.cumulative;

  // --- upcoming
  const paidBy = new Map<string, number>();
  for (const x of pays.data ?? [])
    paidBy.set(x.asset_id as string, (paidBy.get(x.asset_id as string) ?? 0) + Number(x.amount));
  const receivables = (recv.data ?? []).map((r) => ({
    id: r.asset_id as string,
    name: r.counterparty as string,
    s: receivableStatus(
      {
        id: r.asset_id as string,
        lent: Number(r.lent),
        repayments: paidBy.has(r.asset_id as string)
          ? [{ amount: paidBy.get(r.asset_id as string)!, on: today }]
          : [],
        expectedOn: r.expected_on ? new Date((r.expected_on as string) + 'T00:00:00Z') : null,
      },
      today,
    ),
    expectedOn: (r.expected_on as string | null) ?? null,
  }));
  const overdue = receivables.filter((x) => x.s.status === 'overdue');
  const events = upcomingEvents(
    [
      ...allRows
        .filter((r) => r.fd && r.status === 'active')
        .map((r) => ({
          date: r.fd!.maturityOn,
          kind: 'deposit' as const,
          title: `${r.bank} ${r.code} matures`,
          amount: r.fd!.maturityAmount,
          href: `/asset/${r.assetId}`,
        })),
      ...(pols.data ?? []).flatMap((x) =>
        [
          x.renewal_on ? { d: x.renewal_on as string, w: 'renews' } : null,
          x.expires_on ? { d: x.expires_on as string, w: 'expires' } : null,
        ]
          .filter((e): e is { d: string; w: string } => !!e)
          .map((e) => ({
            date: e.d,
            kind: 'policy' as const,
            title: `${x.insurer as string} policy ${e.w}`,
            href: `/policy/${x.id as string}`,
          })),
      ),
      ...(openTasks.data ?? []).map((x) => ({
        date: x.due_on as string,
        kind: 'task' as const,
        title: x.title as string,
        href: `/tasks/${x.id as string}`,
      })),
      ...receivables
        .filter((x) => x.expectedOn && x.s.status !== 'settled')
        .map((x) => ({
          date: x.expectedOn!,
          kind: 'receivable' as const,
          title: `${x.name} to repay`,
          amount: x.s.outstanding,
          href: '/others',
        })),
    ],
    todayIso,
    120,
    8,
  );

  // --- deposit insurance
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
    p.valued,
    fdRows,
    new Map(Object.entries(bankNames)),
    nameOf,
    today,
    settings.config.deposits.insuranceLimit,
  ).cover;
  const uninsuredBanks = Object.entries(cover.byBank)
    .map(([id, b]) => ({ id, name: cover.bankNames[id] ?? 'Unknown', ...b }))
    .filter((b) => b.uninsured > 0)
    .sort((a, b) => b.uninsured - a.uninsured);

  // --- data trust
  const fresh = freshnessSummary(Object.values(p.lines));
  const assumptions = Object.values(p.lines).filter((l) => l.usedAssumption).length;
  const lastVerified = obsRows.reduce<string | null>(
    (m, o) => (!m || o.as_of > m ? o.as_of : m),
    null,
  );
  const recent = [...obsRows]
    .filter((o) => !o.superseded_by)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 6);

  // --- what needs you
  const stale = Object.values(p.lines).filter(
    (l) => l.freshness === 'stale' || l.freshness === 'missing',
  );
  type Action = { tone: 'bad' | 'warn' | 'info'; text: string; href: string };
  const alerts = maturityAlerts(
    fdRows.map((f) => ({
      id: f.asset_id,
      name: nickname.get(f.asset_id) ?? 'FD',
      maturityOn: new Date(f.maturity_on + 'T00:00:00Z'),
      status: assetRows.find((a) => a.id === f.asset_id)?.status ?? 'active',
    })),
    today,
    settings.config.deposits.maturityAlertDays,
  );
  const actions: Action[] = [
    ...nw.excluded
      .filter((e) => e.reason === 'status_not_counted')
      .map((e): Action => ({
        tone: 'bad',
        text: `${e.name} has matured: say where the money went (not counted until then)`,
        href: '/accounts',
      })),
    ...overdue.map((o): Action => ({
      tone: 'bad',
      text: `${o.name} owes ${formatInr(o.s.outstanding)}, ${o.s.daysOverdue} days overdue`,
      href: '/others',
    })),
    ...alerts.map((a): Action => ({
      tone: 'warn',
      text: `${a.name} matures in ${a.daysLeft} days`,
      href: '/accounts',
    })),
    ...(stale.length > 0
      ? [
          {
            tone: 'warn',
            text: `${stale.length} balances are out of date`,
            href: '/monthly',
          } as Action,
        ]
      : []),
    ...nw.excluded
      .filter((e) => e.reason === 'no_valuation')
      .map((e): Action => ({
        tone: 'info',
        text: `${e.name} has no value recorded yet`,
        href: '/monthly',
      })),
  ];

  const goalsOnTrack = goalList.filter((g) => g.proj.status === 'on_track').length;
  const goalsWithTarget = goalList.filter((g) => g.proj.status !== 'no_target').length;
  const mfPace = inv.household.funds > 0 ? fundPace(inv) : null;
  const upDown = (n: number) => (n >= 0 ? 'gain' : 'fail');

  return (
    <>
      <SnapshotBeacon />
      <div className="pagehead">
        <h1>Family wealth</h1>
        <div className="row">
          <Link href="/raise" className="btn primary cta">
            I need money
          </Link>
          <Link href="/retire" className="btn cta">
            Can I retire now?
          </Link>
          <WhatsAppButton />
        </div>
      </div>

      <SetupChecklist items={setup} compact max={4} title="Finish setting up" />

      <section className="kpis" aria-label="Key figures">
        <article className="kpi main">
          <div className="kpi-label">Net worth today</div>
          <div className="kpi-value" aria-label={formatInr(nw.total)}>
            {formatInrCompact(nw.total)}
          </div>
          <div className="kpi-sub">
            {month ? (
              <span className={upDown(month.amount)}>
                {rupees(month.amount)}
                {month.pct !== null ? ` (${pct(month.pct, 1)})` : ''} in 30 days
              </span>
            ) : (
              <span className="muted">change shows after a month of history</span>
            )}
          </div>
          <div className="kpi-spark">
            <Sparkline
              points={trend.slice(-24).map((x) => x.value)}
              label="Net worth"
              width={160}
              height={34}
            />
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Cash and deposits</div>
          <div className="kpi-value">{formatInrCompact(liquid)}</div>
          <div className="kpi-sub muted">
            {nw.total > 0 ? Math.round((liquid / nw.total) * 100) : 0}% of net worth ·{' '}
            <Link href="/raise">what can I raise?</Link>
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Mutual funds</div>
          <div className="kpi-value">{formatInrCompact(inv.household.value)}</div>
          <div className="kpi-sub">
            {inv.household.dayPct === null ? (
              <span className="muted">no price change yet</span>
            ) : (
              <span className={tone(inv.household.dayAmount)}>
                {rupees(inv.household.dayAmount)} ({pct(inv.household.dayPct)}) today
              </span>
            )}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Fund returns</div>
          <div className={`kpi-value ${tone(inv.household.gain)}`}>
            {rupees(inv.household.gain)}
          </div>
          <div className="kpi-sub muted">
            {inv.household.xirr === null
              ? 'XIRR not available'
              : `XIRR ${pct(inv.household.xirr, 1)} a year${inv.household.xirrEstimated ? ' (est.)' : ''}`}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Goals on track</div>
          <div className="kpi-value">
            {goalsOnTrack}
            <span className="muted"> / {goalsWithTarget}</span>
          </div>
          <div className="kpi-sub muted">
            <Link href="/goals">see each goal</Link>
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Needs you</div>
          <div className={`kpi-value ${actions.some((a) => a.tone === 'bad') ? 'fail' : ''}`}>
            {actions.length}
          </div>
          <div className="kpi-sub muted">{(tasks.data ?? []).length} open tasks</div>
        </article>
      </section>

      <section className="dashgrid">
        <div className="card span2">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h2 style={{ marginRight: 'auto' }}>Net worth over time</h2>
            <span className="muted small">snapshots are taken daily</span>
          </div>
          <TrendChart
            series={[
              {
                name: 'Net worth',
                colour: 'var(--primary, #4f46e5)',
                area: true,
                points: trend,
              },
              ...(projection.length > 0
                ? [
                    {
                      name: 'If the pace holds',
                      colour: 'var(--ok, #15803d)',
                      dashed: true,
                      points: [trend[trend.length - 1]!, ...projection].map((x) => ({
                        date: x.date,
                        value: x.value,
                      })),
                    },
                  ]
                : []),
            ]}
            caption="Household net worth over time"
            today={todayIso}
            height={240}
            defaultRange="all"
          />
          {pace && projection.length > 0 && (
            <p className="muted small">
              Dotted line: if the last {pace.months} month{pace.months === 1 ? '' : 's'}&apos; pace
              ({rupees(pace.monthlyChange)} a month) simply continues. It reaches{' '}
              {formatInrCompact(projection[0]!.value)} in a year and{' '}
              {formatInrCompact(projection[projection.length - 1]!.value)} in two years. This is a
              straight extension, not a forecast.
            </p>
          )}
        </div>

        <div className="card">
          <h2>Where the money is</h2>
          <Donut
            caption="Net worth by kind of asset"
            slices={typeShares.map((x, i) => ({
              label: x.label,
              value: x.value,
              colour: palette[i % palette.length]!,
            }))}
            centre={{ top: formatInrCompact(nw.total), bottom: 'total' }}
          />
        </div>

        <div className="card">
          <h2>Whose money</h2>
          <Donut
            caption="Net worth by person"
            slices={personShares.map((x, i) => ({
              label: x.label,
              value: x.value,
              colour: styles[x.key]?.colour ?? palette[i % palette.length]!,
              href: `/accounts?p=${x.key}`,
            }))}
          />
          {currencyShares.length > 1 && (
            <>
              <h3 className="small">Currency</h3>
              <BarList
                caption="By currency"
                items={currencyShares.map((x) => ({
                  label: x.label,
                  value: x.value,
                  sub: `${Math.round(x.share * 100)}%`,
                }))}
              />
            </>
          )}
        </div>

        {inv.household.funds > 0 && (
          <div className="card span2">
            <div className="row" style={{ alignItems: 'baseline' }}>
              <h2 style={{ marginRight: 'auto' }}>Mutual funds</h2>
              <Link href="/investments?tab=update">Update funds</Link>
              <Link href="/investments">All funds and goals</Link>
            </div>
            <InvestHeadline t={inv.household} big />
            <FundChart
              history={inv.series}
              {...(mfPace ? { projection: mfPace.path } : {})}
              today={todayIso}
              caption="Value of all mutual funds against the money put in"
              height={200}
            />
            {mfPace && (
              <p className="muted small">
                At today&apos;s SIPs of {formatInr(Math.round(inv.household.sipMonthly))} a month
                and {(mfPace.rate * 100).toFixed(1)}% a year{mfPace.assumed ? ' (assumed)' : ''}:{' '}
                {mfPace.projections
                  .map((x) => `${formatInrCompact(x.expected)} in ${x.years}y`)
                  .join(' · ')}
                .
              </p>
            )}
            <table className="tbl lines responsive" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Value</th>
                  <th className="num">Today</th>
                  <th className="num">Total gain</th>
                  <th className="num">XIRR</th>
                </tr>
              </thead>
              <tbody>
                {inv.groups.map((g) => (
                  <tr key={g.ownerId}>
                    <td data-label="Person">
                      <PersonBadge p={styles[g.ownerId]} name size={18} />
                      {g.panLast4 && <span className="muted small"> PAN ••••{g.panLast4}</span>}
                    </td>
                    <td className="num" data-label="Value">
                      {formatInr(Math.round(g.totals.value))}
                    </td>
                    <td
                      className={`num ${tone(g.totals.dayPct === null ? null : g.totals.dayAmount)}`}
                      data-label="Today"
                    >
                      {g.totals.dayPct === null ? '–' : rupees(g.totals.dayAmount)}
                      {g.totals.dayPct !== null && (
                        <div className="small">{pct(g.totals.dayPct)}</div>
                      )}
                    </td>
                    <td className={`num ${tone(g.totals.gain)}`} data-label="Total gain">
                      {rupees(g.totals.gain)}
                    </td>
                    <td className={`num ${tone(g.totals.xirr)}`} data-label="XIRR">
                      {g.totals.xirr === null ? '–' : pct(g.totals.xirr, 1)}
                      {g.totals.xirr !== null && g.totals.xirrEstimated && (
                        <span className="muted"> ~</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h2 style={{ marginRight: 'auto' }}>Goals</h2>
            <Link href="/goals" className="small">
              All goals
            </Link>
          </div>
          {goalList.length === 0 ? (
            <p className="muted small">No goals yet. Add one to see whether it is funded.</p>
          ) : (
            <ul className="goalbars">
              {goalList.map((g) => {
                const funded = g.proj.fundedPct;
                return (
                  <li key={g.id}>
                    <div className="barhead">
                      <Link href="/goals">{g.name}</Link>
                      <span
                        className={
                          g.proj.status === 'shortfall'
                            ? 'fail'
                            : g.proj.status === 'on_track'
                              ? 'gain'
                              : 'muted'
                        }
                      >
                        {g.proj.status === 'no_target'
                          ? 'no target set'
                          : g.proj.status === 'past_due'
                            ? 'date passed'
                            : funded !== null
                              ? `${Math.round(funded * 100)}% funded`
                              : ''}
                      </span>
                    </div>
                    <div className="bartrack" role="presentation">
                      <div
                        className="barfill"
                        style={{
                          width: `${Math.min(100, Math.round((funded ?? 0) * 100))}%`,
                          background:
                            g.proj.status === 'shortfall'
                              ? 'var(--bad, #b91c1c)'
                              : 'var(--ok, #15803d)',
                        }}
                      />
                    </div>
                    <div className="small muted">
                      {formatInrCompact(g.allocated)} earmarked
                      {g.futureCost ? ` · needs ${formatInrCompact(g.futureCost)}` : ''}
                      {g.targetDate ? ` by ${g.targetDate.slice(0, 7)}` : ''}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="card">
          <h2>When can I get at it?</h2>
          <p className="muted small">
            What reaches your accounts, with nothing sold. Total {formatInrCompact(ladderTotal)}.
          </p>
          <BarList
            caption="Money available over time"
            items={ladder
              .filter((s) => s.amount > 0 || s.key === 'now')
              .map((s, i) => ({
                label: s.label,
                value: s.amount,
                ...(s.items.length > 0
                  ? { sub: `${s.items.length} deposit${s.items.length === 1 ? '' : 's'}` }
                  : {}),
                colour: palette[i % palette.length]!,
              }))}
          />
        </div>

        <div className="card">
          <h2>Coming up</h2>
          {events.length === 0 ? (
            <p className="muted small">Nothing dated in the next four months.</p>
          ) : (
            <ul className="timeline">
              {events.map((e, i) => (
                <li key={i} className={e.daysLeft < 0 ? 'late' : e.daysLeft <= 14 ? 'soon' : ''}>
                  <span className="when">
                    {e.daysLeft < 0
                      ? `${-e.daysLeft}d late`
                      : e.daysLeft === 0
                        ? 'today'
                        : `in ${e.daysLeft}d`}
                  </span>
                  <Link href={e.href}>{e.title}</Link>
                  {e.amount ? (
                    <span className="num small"> {formatInrCompact(e.amount)}</span>
                  ) : null}
                  <span className="muted small"> · {fmtDate(e.date)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h2 style={{ marginRight: 'auto' }}>Banks</h2>
            <Link href="/deposits" className="small">
              Deposit insurance
            </Link>
          </div>
          <BarList
            caption="Money by bank"
            items={bankShares.map((x, i) => ({
              label:
                x.key === '__other' ? (
                  'Other banks'
                ) : (
                  <Link href={`/bank/${x.key}`}>{x.label}</Link>
                ),
              value: x.value,
              sub: `${Math.round(x.share * 100)}% of bank money`,
              colour: palette[i % palette.length]!,
            }))}
          />
          {uninsuredBanks.length > 0 ? (
            <p className="notice warn small">
              Above the {formatInrCompact(cover.limit)} insurance limit per name:{' '}
              {uninsuredBanks
                .slice(0, 3)
                .map((b) => `${b.name} ${formatInrCompact(b.uninsured)}`)
                .join(', ')}
              {uninsuredBanks.length > 3 ? ` and ${uninsuredBanks.length - 3} more` : ''}.
            </p>
          ) : (
            <p className="small gain">All bank deposits are within the insurance limit.</p>
          )}
        </div>

        <div className="card">
          <div className="row" style={{ alignItems: 'baseline' }}>
            <h2 id="attn" style={{ marginRight: 'auto' }}>
              Needs you
            </h2>
            <Link href="/monthly" className="small">
              Monthly update →
            </Link>
          </div>
          {actions.length === 0 ? (
            <p className="notice ok" role="status">
              Nothing needs you today. Everything that could be updated automatically has been.
            </p>
          ) : (
            <ul className="list nobullet actions">
              {actions.slice(0, 6).map((x, i) => (
                <li key={i} className={`action ${x.tone}`}>
                  <Link href={x.href}>
                    <span className="dot" aria-hidden />
                    <span>{x.text}</span>
                    <span className="go" aria-hidden>
                      →
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {actions.length > 6 && (
            <p className="muted small">
              and {actions.length - 6} more in Tasks and Monthly update.
            </p>
          )}
        </div>

        <div className="card">
          <h2>How reliable are these numbers?</h2>
          <div
            className="fresh"
            role="img"
            aria-label={`${Math.round(fresh.freshShare * 100)}% of balances are up to date`}
          >
            <span className="f-ok" style={{ flex: fresh.fresh }} />
            <span className="f-aging" style={{ flex: fresh.aging }} />
            <span className="f-stale" style={{ flex: fresh.stale + fresh.missing }} />
          </div>
          <p className="small">
            <b>{Math.round(fresh.freshShare * 100)}%</b> of {fresh.total} balances are up to date
            {fresh.aging + fresh.stale + fresh.missing > 0
              ? `; ${fresh.aging} getting old, ${fresh.stale + fresh.missing} out of date or missing`
              : ''}
            . Last recorded value dated {lastVerified ? fmtDate(lastVerified) : '—'}.
            {assumptions > 0
              ? ` ${assumptions} accounts use an assumed savings rate until you set the real one.`
              : ''}
          </p>
          <table className="tbl">
            <tbody>
              {(Object.keys(BASIS_LABEL) as (keyof typeof BASIS_LABEL)[]).map((b) => (
                <tr key={b}>
                  <th scope="row">{BASIS_LABEL[b]}</th>
                  <td className="num">
                    {formatInrCompact(nw.estimateTotals.byBasis[b as 'calculated'])}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small">
            Insurance cover is never counted as wealth. Matured or unconfirmed deposits are excluded
            until confirmed.
          </p>
        </div>

        <div className="card">
          <h2>Latest updates</h2>
          <ul className="timeline">
            {recent.map((o) => (
              <li key={o.id}>
                <Link href={`/asset/${o.asset_id}`}>{nickname.get(o.asset_id) ?? 'Account'}</Link>{' '}
                <span className="num small">{formatInrCompact(o.amount * (o.fx_rate ?? 1))}</span>
                <div className="small muted">
                  <UpdatedCell asOf={o.as_of} source={sourceTag(o.source, o.as_of, false)} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {role === 'admin' && <AddMember />}
    </>
  );
}

function AddMember() {
  return (
    <section className="card">
      <h2>Add your spouse</h2>
      <p className="muted small">
        Create their login in Supabase first, then enter the same email here. They will see
        everything you see.
      </p>
      <form action={addMember} className="form row">
        <input
          name="email"
          type="email"
          placeholder="spouse@example.com"
          required
          aria-label="Spouse email"
        />
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
