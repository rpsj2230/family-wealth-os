/**
 * The public sample of Home: the same invented household as /demo/accounts and /demo/deposits (banks, deposits, four people), the
 * invented funds of /demo/investments, and a few shares, flats, a pension account and a loan, valued together by the same functions
 * the signed-in page uses. Nothing here is real. Everything is deterministic, so the sample looks the same on every visit.
 */
import {
  DEFAULT_SETTINGS,
  DEFAULT_CONFIG,
  buildPortfolio,
  positionInputFrom,
  buildSources,
  projectGoal,
  queueOf,
  type AssetRow,
  type FundForRaise,
  type HomeRange,
  type ObservationRow,
} from '@fwos/core';
import { buildDeposits, type DepositAsset } from './deposits';
import { demoInbox } from './demo-datain';
import { DEMO_PORTFOLIO_DEFAULTS, DEMO_TODAY as DEMO_DATE, demoModel } from './demo-fixture';
import { demoView } from './demo-funds';
import { DEFAULT_INFLATION, returnFor, type GoalSummary } from './goals-view';
import type { HomeInput, HomeSnapshot } from './home';
import { posFundOfRow } from './fund-holdings';
import { fundPace } from './investments';

const TODAY = DEMO_DATE.toISOString().slice(0, 10);
const DAY = 86_400_000;

/** Holdings that are not in a bank or a fund: [id, owner, type, name, amount, recorded on, days it stays fresh]. */
const OTHER: [string, string, AssetRow['type'], string, number, string, number][] = [
  ['st-1', 'p2', 'stock', 'Sample Shares', 640_000, '2026-10-22', 35],
  ['pr-1', 'p1', 'property', 'Sample Flat', 8_500_000, '2026-06-30', 400],
  ['pr-2', 'p2', 'property', 'Sample Plot', 3_200_000, '2026-06-30', 400],
  ['rc-1', 'p3', 'receivable', 'Loan to a relative', 200_000, '2026-04-02', 400],
  ['nps-1', 'p1', 'nps', 'Sample pension account', 1_150_000, '2026-10-02', 35],
  ['nps-2', 'p2', 'nps', 'Sample pension account', 880_000, '2026-08-02', 35],
];

/** The shape of net worth `days` ago, as a multiple of today's: about 11% growth a year, with the funds swinging more. */
function snapshotsFor(byType: Record<string, number>, byOwner: Record<string, number>) {
  const out: HomeSnapshot[] = [];
  const total = Object.values(byType).reduce((a, b) => a + b, 0);
  // weekly for the last 13 weeks, month ends before that, back to 14 months
  const back: number[] = [];
  for (let d = 7; d <= 91; d += 7) back.push(d);
  for (let m = 4; m <= 14; m++) back.push(Math.round(m * 30.4));
  for (const days of back.sort((a, b) => b - a)) {
    const date = new Date(DEMO_DATE.getTime() - days * DAY).toISOString().slice(0, 10);
    const base = 1 - 0.11 * (days / 365);
    const split = Object.fromEntries(
      Object.entries(byType).map(([k, v]) => {
        const swing = k === 'mutual_fund' ? 0.05 * Math.sin(days / 23) - 0.04 * (days / 365) : 0;
        const steady = k === 'fixed_deposit' ? 0.015 * (days / 365) : 0;
        return [k, Math.round(v * (base + swing + steady))];
      }),
    );
    const sum = Object.values(split).reduce((a, b) => a + b, 0);
    out.push({
      date,
      // the older points are shown as rebuilt from history, as they would be after Import > History
      source: days > 91 ? 'rebuilt' : 'daily',
      total: sum,
      byType: split,
      byOwner: Object.fromEntries(
        Object.entries(byOwner).map(([k, v]) => [k, Math.round((v / total) * sum)]),
      ),
    });
  }
  return out;
}

export function demoHomeInput(range: HomeRange): HomeInput {
  const m = demoModel();
  const inv = demoView(null, 'all');
  const funds = inv.groups.flatMap((g) => g.funds);
  const assets: AssetRow[] = [...m.assets];
  const observations: ObservationRow[] = [...m.observations];
  let n = 0;
  const add = (
    id: string,
    owner: string,
    type: AssetRow['type'],
    nickname: string,
    amount: number,
    asOf: string,
    fresh: number,
    source: string,
  ) => {
    assets.push({
      id,
      owner_id: owner,
      type,
      status: 'active',
      nickname,
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: fresh,
    });
    observations.push({
      id: `ox${++n}`,
      asset_id: id,
      kind: 'balance',
      amount,
      currency: 'INR',
      fx_rate: null,
      as_of: asOf,
      confidence: 'manual_confirmed',
      source,
      created_at: `${asOf}T00:00:00Z`,
      superseded_by: null,
    });
  };
  for (const f of funds)
    add(f.assetId, f.ownerId, 'mutual_fund', f.name, f.value, '2026-10-24', 35, 'cas');
  for (const [id, owner, type, name, amount, asOf, fresh] of OTHER)
    add(id, owner, type, name, amount, asOf, fresh, 'manual');

  // earlier balances for most rupee savings accounts, so their interest is worked from what was recorded then (money paid in or taken
  // out shows as a change of balance, never as profit); every fourth account has a single record, as if opened recently
  let savingsSeen = 0;
  for (const o of m.observations) {
    const a = assets.find((x) => x.id === o.asset_id);
    if (!a || a.type !== 'bank_account' || a.currency !== 'INR' || !a.institution_id) continue;
    if (savingsSeen++ % 4 === 3) continue;
    for (const [asOf, k] of [
      ['2026-03-18', 0.8],
      ['2026-06-27', 1.15],
    ] as const)
      observations.push({
        ...o,
        id: `oh${++n}`,
        amount: Math.round(o.amount * k),
        as_of: asOf,
        created_at: `${asOf}T00:00:00Z`,
      });
  }

  const portfolio = buildPortfolio(assets, observations, m.fds, DEMO_DATE, DEMO_PORTFOLIO_DEFAULTS);
  const nw = portfolio.netWorth;
  const config = DEFAULT_CONFIG;

  const depositAssets: DepositAsset[] = assets.map((a) => ({
    id: a.id,
    ownerId: a.owner_id,
    institutionId: a.institution_id ?? null,
    type: a.type,
    status: a.status,
    nickname: a.nickname,
    accountKind: a.account_kind,
    isJoint: !!a.is_joint,
    jointHolderId: null,
  }));
  const cover = buildDeposits(
    depositAssets,
    portfolio.valued,
    m.fds,
    new Map(Object.entries(m.institutionNames)),
    new Map(m.people.map((x) => [x.id, x.name])),
    DEMO_DATE,
    config.deposits.insuranceLimit,
  ).cover;

  const forRaise: FundForRaise[] = funds.map((f) => ({
    assetId: f.assetId,
    invested: f.invested,
    startedOn: f.startedOn,
    sipActive: !!f.sipMonthly && !f.sipStopped,
  }));
  const sources = buildSources({
    valued: portfolio.valued,
    assetRows: assets,
    fds: m.fds,
    funds: forRaise,
    today: TODAY,
    institutionNames: m.institutionNames,
    config: config.liquidity,
    nri: config.harvest.nri,
  });

  const overview: HomeInput['overview'] = {
    today: DEMO_DATE,
    soonDays: config.reminders.maturitySoonDays,
    defaultSavingsRate: config.estimates.savingsRate,
    tdsRate: config.estimates.interestTdsRate,
    insuranceLimit: config.deposits.insuranceLimit,
    fx: m.fx,
  };

  const goal = (
    id: string,
    name: string,
    kind: string,
    targetToday: number,
    targetDate: string,
    allocated: number,
    monthly: number,
  ): GoalSummary => {
    const years = (Date.parse(targetDate) - Date.parse(TODAY)) / (365.25 * DAY);
    const plan = {
      targetToday,
      targetDate,
      inflation: DEFAULT_INFLATION[kind] ?? 0.055,
      allocatedNow: allocated,
      monthlyContribution: monthly,
      annualReturn: returnFor(years),
      today: TODAY,
    };
    const proj = projectGoal(plan);
    return {
      id,
      name,
      kind,
      targetDate,
      allocated,
      monthly,
      futureCost: proj.futureCost,
      proj,
      targetToday,
      plan,
    };
  };
  const goals = [
    goal('g1', 'Education fund', 'education', 4_000_000, '2033-06-01', 2_100_000, 40_000),
    goal('g2', 'Retirement', 'retirement', 60_000_000, '2046-04-01', 21_000_000, 60_000),
    goal('g3', 'Second flat', 'property', 9_000_000, '2029-03-01', 1_500_000, 10_000),
  ];

  const instOf = new Map(assets.map((a) => [a.id, a.institution_id ?? null]));
  const nameOf = new Map(assets.map((a) => [a.id, a.nickname]));
  const recent = [...observations]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
    .slice(0, 6)
    .map((o) => {
      const inst = instOf.get(o.asset_id);
      return {
        id: o.id,
        assetId: o.asset_id,
        name: `${inst ? (m.institutionNames[inst] ?? '') + ' ' : ''}${nameOf.get(o.asset_id) ?? 'Account'}`,
        amount: o.amount,
        asOf: o.as_of,
        source: o.source,
      };
    });

  return {
    today: TODAY,
    range,
    styles: m.styles,
    portfolio,
    blocks: m.blocks,
    overview,
    currencyOf: Object.fromEntries(assets.map((a) => [a.id, a.currency])),
    snapshots: snapshotsFor(nw.byType as Record<string, number>, nw.byOwner),
    inv,
    pace: fundPace(inv),
    goals,
    config,
    cover,
    sources,
    receivables: [
      {
        id: 'rc-1',
        name: 'A relative',
        outstanding: 200_000,
        daysOverdue: 26,
        expectedOn: '2026-09-30',
        settled: false,
      },
    ],
    policies: [
      { id: 'pol1', insurer: 'Sample Life', renewalOn: '2026-11-18', expiresOn: null },
      { id: 'pol2', insurer: 'Sample Health', renewalOn: '2027-01-09', expiresOn: null },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Collect the new deposit advice from Sample Jan Bank',
        dueOn: '2026-10-22',
      },
      { id: 't2', title: 'Pay the annual premium for the term plan', dueOn: '2026-10-31' },
      { id: 't3', title: '[Harvest Beena] Sell and buy back equity funds', dueOn: '2027-03-15' },
    ],
    openTasks: 4,
    inboxReview: demoInbox().filter((x) => queueOf(x) === 'review').length,
    fundsNoPrice: 3,
    position: positionInputFrom({
      assets,
      observations,
      fds: m.fds,
      funds: Object.fromEntries(funds.map((f) => [f.assetId, posFundOfRow(f)])),
      config,
      today: TODAY,
      portfolio,
    }),
    monthlySpending: 180_000,
    inflation: DEFAULT_SETTINGS.assumptions.inflation,
    recent,
    newestRecorded: observations.reduce<string | null>(
      (best, o) => (!best || o.as_of > best ? o.as_of : best),
      null,
    ),
  };
}
