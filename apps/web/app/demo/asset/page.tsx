import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  depositRates,
  heldValueOf,
  parseRange,
  personStyles,
  type NavPoint,
} from '@fwos/core';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { daysBetweenIso } from '@/lib/dates';
import { FundDetailPanel } from '@/components/FundDetailPanel';
import { HistoryLine } from '@/components/HistoryLine';
import { DepositHeadlinePanel, SavingsHeadlinePanel } from '@/components/HoldingHeadline';
import {
  DEMO_FUND_IDS,
  DEMO_HOLDING_MONTHS,
  DEMO_TODAY,
  demoBenchmark,
  demoFund,
  demoView,
} from '@/lib/demo-funds';
import { fundEditRows } from '@/lib/invest-ledger';
import { FundEditProvider } from '@/components/invest/FundEdit';
import { FundPage, parseFundTab, parseReturnScope } from '@/components/invest/FundPage';
import { SipPlan } from '@/components/invest/SipPlan';
import { sipPlanView } from '@/lib/sip-plan';
import type { ReplacedRow } from '@/components/invest/ReplacedLines';
import { buildFundDetail, NAV_POINTS } from '@/lib/fund-detail-model';
import { buildFundTax } from '@/lib/fund-tax';
import type { FundRow } from '@/lib/investments';
import {
  buildActivity,
  buildAssetView,
  VALUE_TABLE,
  type AssetViewInput,
  type AuditIn,
} from '@/lib/detail-view';

export const metadata: Metadata = {
  title: 'Sample: account detail',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';
const PEOPLE = personStyles([
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
]);

const common = {
  today: TODAY,
  ownerName: 'Anil',
  bankName: 'Sample Equity Bank',
  navs: [],
  txns: [],
  receivable: null,
  payments: [],
  goalNames: [],
  position: null,
  fd: null,
  linked: null,
  code: null,
};

/** Invented: one NRE deposit and the NRE savings account it is linked to, both Anil's at the same bank. */
const SAMPLE_FD = {
  principal: 500_000,
  rate: 0.0725,
  booked_on: '2025-03-12',
  maturity_on: '2028-03-12',
  compounding: 'quarterly' as const,
  bank_maturity_amount: null,
  fd_ref_last4: '5076',
};
const SAMPLE_SAVINGS = {
  rate: 0.07,
  balance: { date: '2026-10-15', amount: 410_000 },
};
/** The deposit's current value by the valuation engine's rule (its terms, at the rate gap in Settings): one value everywhere. */
const fdNow = () => heldValueOf(SAMPLE_FD, TODAY, DEFAULT_CONFIG.estimates.observedRateGap);
/** The savings account's current value: the bank's last balance and the interest since, not yet credited (quarterly credit). */
const savingsAccrued = () =>
  Math.round(
    (SAMPLE_SAVINGS.balance.amount *
      SAMPLE_SAVINGS.rate *
      daysBetweenIso(SAMPLE_SAVINGS.balance.date, TODAY)) /
      365,
  );
const savingsNow = () => SAMPLE_SAVINGS.balance.amount + savingsAccrued();

/** The headline inputs of the samples: Settings at their defaults, the cover of Anil's name at the bank (the deposit and the savings). */
const sampleHeadline = (): NonNullable<AssetViewInput['headline']> => ({
  nroTaxRate: DEFAULT_CONFIG.rates.nroTaxRate,
  rateGap: DEFAULT_CONFIG.estimates.observedRateGap,
  tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
  savingsRate: DEFAULT_CONFIG.estimates.savingsRate,
  cover: { limit: DEFAULT_CONFIG.deposits.insuranceLimit, total: fdNow() + savingsNow() },
  depositRate: depositRates(
    [{ principal: SAMPLE_FD.principal, rate: SAMPLE_FD.rate, kind: 'NRE' }],
    DEFAULT_CONFIG.rates.nroTaxRate,
  ).all,
});

function fdInput(): AssetViewInput {
  return {
    ...common,
    headline: sampleHeadline(),
    asset: {
      id: 'fd1',
      type: 'fixed_deposit',
      nickname: 'FD',
      label: null,
      status: 'active',
      currency: 'INR',
      account_kind: 'NRE',
      is_joint: false,
      identifier_last4: null,
      linked_last4: '1100',
      notes: 'Renew for one year',
      holder_name: null,
    },
    code: 'FD-NRE-5076',
    current: { amount: fdNow(), basis: 'calculated', ageDays: 0, asOf: TODAY },
    observations: [],
    fd: SAMPLE_FD,
    linked: { id: 's1', label: 'Sample Equity Bank Cash-NRE-1100' },
  };
}

/** Invented balances of the sample savings account, oldest first. */
const SAVINGS_BALANCES: [string, number][] = [
  ['2026-03-31', 386_500],
  ['2026-06-30', 396_200],
  ['2026-09-30', 404_800],
  [SAMPLE_SAVINGS.balance.date, SAMPLE_SAVINGS.balance.amount],
];

function savingsInput(): AssetViewInput {
  return {
    ...common,
    headline: sampleHeadline(),
    asset: {
      id: 's1',
      type: 'bank_account',
      nickname: 'Cash-NRE-1100',
      label: null,
      status: 'active',
      currency: 'INR',
      account_kind: 'NRE',
      is_joint: false,
      identifier_last4: '1100',
      linked_last4: null,
      notes: null,
      holder_name: null,
    },
    code: 'Cash-NRE-1100',
    current: {
      amount: savingsNow(),
      basis: 'estimated',
      ageDays: daysBetweenIso(SAMPLE_SAVINGS.balance.date, TODAY),
      asOf: SAMPLE_SAVINGS.balance.date,
    },
    observations: SAVINGS_BALANCES.map(([as_of, amount], k) => ({
      id: `b${k}`,
      amount,
      currency: 'INR',
      fx_rate: null,
      as_of,
      confidence: 'verified',
      source: 'email',
      note: null,
      created_at: `${as_of}T09:00:00Z`,
      superseded_by: null,
    })),
    rateInfo: { rate: SAMPLE_SAVINGS.rate, tag: 'own', note: 'the rate set for this account' },
    breakdown: {
      savings: {
        baseline: SAMPLE_SAVINGS.balance,
        interest: savingsAccrued(),
        credited: 0,
        accrued: savingsAccrued(),
        moved: 0,
      },
      fund: null,
      navStaleDays: null,
    },
  };
}

/** Invented: two SIP instalments since the last statement, kept apart as projected; the rest confirmed by the statement. */
function demoFundSplit(value: number, navs: NavPoint[]) {
  const last = navs[navs.length - 1] ?? { date: DEMO_TODAY, nav: 100 };
  const projectedInvested = 20_000;
  const projectedUnits = Math.round((projectedInvested / last.nav) * 1000) / 1000;
  const projectedValue = projectedUnits * last.nav;
  const confirmedValue = value - projectedValue;
  return {
    confirmedUnits: Math.round((confirmedValue / last.nav) * 1000) / 1000,
    projectedUnits,
    confirmedValue,
    projectedValue,
    projectedInvested,
    projectedCount: 2,
    nav: { date: last.date, nav: last.nav },
  };
}

function fundInput(f: FundRow, navs: NavPoint[]): AssetViewInput {
  return {
    ...common,
    breakdown: { savings: null, fund: demoFundSplit(f.value, navs), navStaleDays: 4 },
    asset: {
      id: 'mf1',
      type: 'mutual_fund',
      nickname: 'Sample Flexi Cap Fund',
      label: null,
      status: 'active',
      currency: 'INR',
      account_kind: null,
      is_joint: false,
      identifier_last4: null,
      linked_last4: null,
      notes: null,
      holder_name: null,
    },
    bankName: null,
    current: { amount: f.value, basis: 'estimated', ageDays: 3, asOf: '2026-10-23' },
    observations: [
      {
        id: 'o1',
        amount: 598_000,
        currency: 'INR',
        fx_rate: null,
        as_of: '2026-09-30',
        confidence: 'verified',
        source: 'cas',
        note: 'Units times NAV',
        created_at: '2026-10-01T04:00:00Z',
        superseded_by: null,
      },
      {
        id: 'o2',
        amount: 560_000,
        currency: 'INR',
        fx_rate: null,
        as_of: '2026-08-31',
        confidence: 'manual_confirmed',
        source: 'manual',
        note: null,
        created_at: '2026-09-01T04:00:00Z',
        superseded_by: null,
      },
      {
        id: 'o3',
        amount: 545_000,
        currency: 'INR',
        fx_rate: null,
        as_of: '2026-07-31',
        confidence: 'imported_unverified',
        source: 'workbook',
        note: null,
        created_at: '2026-08-01T04:00:00Z',
        superseded_by: 'o2',
      },
    ],
    position: {
      fund_name: 'Sample Flexi Cap Fund - Direct Plan - Growth',
      invested: f.invested,
      started_on: f.startedOn,
      sip_monthly: f.sipMonthly,
      sip_stopped: f.sipStopped,
      folio_last4: f.folioLast4,
      isin: 'INF000A01AB1',
      amfi_code: '120503',
      plan_type: 'direct',
    },
    txns: f.txns.map((t) => ({
      txn_on: t.date,
      kind: t.kind,
      amount: t.amount,
      units: t.units,
      nav: t.nav ?? null,
      balance_units: t.balance ?? null,
      description: null,
    })),
    navs: navs.filter((n) => n.date >= '2025-10-26').map((n) => ({ nav_date: n.date, nav: n.nav })),
    goalNames: ['Education fund'],
  };
}

const audit: AuditIn[] = [
  {
    actor: 'me',
    table_name: 'assets',
    row_id: 'x',
    action: 'UPDATE',
    before: { account_kind: null, is_joint: false },
    after: { account_kind: 'NRE', is_joint: false },
    at: '2026-10-20T08:12:00Z',
  },
  {
    actor: null,
    table_name: 'observations',
    row_id: 'o',
    action: 'INSERT',
    before: null,
    after: { amount: 598000, currency: 'INR', as_of: '2026-09-30', source: 'cas' },
    at: '2026-10-01T04:00:00Z',
  },
  {
    actor: 'me',
    table_name: 'fixed_deposits',
    row_id: 'x',
    action: 'UPDATE',
    before: { rate: 0.07, maturity_on: '2027-10-26' },
    after: { rate: 0.0725, maturity_on: '2027-10-26' },
    at: '2026-09-02T10:30:00Z',
  },
  {
    actor: 'other',
    table_name: 'mf_positions',
    row_id: 'x',
    action: 'UPDATE',
    before: { sip_monthly: 5000 },
    after: { sip_monthly: 10000 },
    at: '2026-06-15T09:00:00Z',
  },
];

/** Invented lines a fund statement replaced, to show the collapsed list on the Transactions tab. */
const DEMO_REPLACED: ReplacedRow[] = [
  {
    id: 'r1',
    date: '2026-04-20',
    kind: 'purchase',
    amount: 5000,
    units: 50,
    source: 'csv',
    statementOn: '2026-10-25',
    replacedOn: '2026-10-26T04:00:00Z',
  },
  {
    id: 'r2',
    date: '2026-06-05',
    kind: 'sip',
    amount: 10000,
    units: 100,
    source: 'estimate',
    statementOn: '2026-10-25',
    replacedOn: '2026-10-26T04:00:00Z',
  },
];

export default async function DemoAsset({
  searchParams,
}: {
  searchParams: Promise<{
    kind?: string;
    range?: string;
    id?: string;
    tab?: string;
    heat?: string;
    scope?: string;
    edit?: string;
  }>;
}) {
  const sp = await searchParams;
  const fund = sp.kind === 'fund';
  const savings = sp.kind === 'savings';
  const range = parseRange(sp.range);
  const fundId = sp.id && DEMO_FUND_IDS.includes(sp.id) ? sp.id : 'f1';
  const sample = demoFund(fundId, range);
  const bench = demoBenchmark();
  const detail = buildFundDetail({
    fund: sample.row,
    navs: sample.navs,
    today: DEMO_TODAY,
    range,
    holdingMonths: DEMO_HOLDING_MONTHS,
    config: DEFAULT_CONFIG.funds,
    maxPoints: NAV_POINTS,
    benchmark: bench,
  });
  const view = buildAssetView(
    fund ? fundInput(sample.row, sample.navs) : savings ? savingsInput() : fdInput(),
  );
  const activity = buildActivity({
    viewerId: 'me',
    audit: audit.filter((a) =>
      fund
        ? a.table_name !== 'fixed_deposits'
        : a.table_name !== 'mf_positions' && !(savings && a.table_name === 'fixed_deposits'),
    ),
    inbox: fund
      ? []
      : [
          {
            received_on: '2026-10-25',
            created_at: '2026-10-25T09:00:00Z',
            from_domain: 'example.test',
            subject: 'Balance alert',
            outcome: 'applied',
            reason: null,
          },
        ],
  });
  const notice = (
    <>
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented data. See another sample: <Link href="/demo/asset">Fixed deposit</Link> ·{' '}
        <Link href="/demo/asset?kind=savings">Savings account</Link> ·{' '}
        <Link href="/demo/asset?kind=fund">Mutual fund</Link>
      </p>
    </>
  );
  if (fund) {
    const all = demoView(null, 'all');
    const owner = PEOPLE[sample.row.ownerId]!;
    const base = '/demo/asset';
    const keep = { kind: 'fund', id: fundId };
    const sipView = sipPlanView({
      assetId: fundId,
      startedOn: sample.row.startedOn ?? '2024-07-05',
      sipMonthly: sample.row.sipMonthly || 5000,
      sipStopped: false,
      changes: [
        { on: sample.row.startedOn ?? '2024-07-05', monthly: 5000 },
        { on: '2026-04-05', monthly: sample.row.sipMonthly || 8000 },
      ],
      payFrom: 'demo-acc-1',
      accounts: [
        { id: 'demo-acc-1', label: 'Sample Equity Bank · Cash-NRO-1111' },
        { id: 'demo-acc-2', label: 'Sample Bank · Cash-NRE-2222' },
      ],
      today: DEMO_TODAY,
    });
    return (
      <main className="content">
        {notice}
        <FundEditProvider
          rows={fundEditRows(all)}
          owners={all.groups.map((g) => ({ id: g.ownerId, name: g.name }))}
          goals={all.goals}
          styles={PEOPLE}
          today={DEMO_TODAY}
          linkBase={{ match: '/demo/investments?tab=match', demo: true }}
          initialOpen={sp.edit ?? null}
        >
          <DetailHeader
            crumbs={[{ label: 'Investments', href: '/demo/investments' }, { label: view.title }]}
            title={sample.row.name}
            subtitle={`Mutual fund · held by ${owner.name}`}
            person={owner}
          />
          <FundPage
            fund={sample.row}
            detail={detail}
            tab={parseFundTab(sp.tab)}
            heat={sp.heat === 'calendar' ? 'calendar' : 'financial'}
            scope={parseReturnScope(sp.scope)}
            base={base}
            keep={keep}
            today={DEMO_TODAY}
            demo
            holdingMonths={DEMO_HOLDING_MONTHS}
            config={DEFAULT_CONFIG.funds}
            colour={owner.colour}
            tax={buildFundTax(all, sample.row)}
            taxHref="/demo/tax-harvest"
            replaced={DEMO_REPLACED}
            overview={(ex) => (
              <FundDetailPanel
                ex={ex}
                fund={sample.row}
                detail={detail}
                base={`/demo/asset?kind=fund&id=${fundId}`}
                links={{
                  update: '/demo/investments?tab=update',
                  match: '/demo/investments?tab=match',
                }}
                holdingMonths={DEMO_HOLDING_MONTHS}
                colour={owner.colour}
              />
            )}
            sipNow={{ now: sipView.now, next: sipView.next }}
            sipPlan={<SipPlan demo today={DEMO_TODAY} view={sipView} />}
            records={
              <>
                <AssetFacts facts={view.facts} />
                <DetailTables
                  tables={[
                    ...view.tables.filter((t) => t.title === VALUE_TABLE),
                    ...view.tables.filter((t) => t.title === 'Recorded values'),
                  ]}
                />
                <ActivityLog items={activity} />
              </>
            }
          />
        </FundEditProvider>
      </main>
    );
  }
  return (
    <main className="content">
      {notice}
      <DetailHeader
        crumbs={[{ label: 'Accounts' }, { label: view.title }]}
        title={view.title}
        subtitle={view.subtitle}
        person={PEOPLE.p1!}
      />
      {view.deposit && (
        <DepositHeadlinePanel
          h={view.deposit}
          bank={common.bankName}
          bankMaturityAmount={view.context.bankMaturityAmount}
          sample
        />
      )}
      {view.savings && (
        <SavingsHeadlinePanel
          h={view.savings}
          rateNote={view.context.rateNote}
          rateAssumed={view.context.rateAssumed}
          tdsRate={view.context.tdsRate}
          balances={view.context.balances}
          sample
        />
      )}
      {view.kpis.length > 0 && (
        <section className="kpis assetkpis" aria-label="Key figures">
          {view.kpis.map((k) => (
            <article key={k.label} className="kpi">
              <div className="kpi-label">{k.label}</div>
              <div className={`kpi-value ${k.tone ?? ''}`}>{k.value}</div>
              {k.note && <div className="kpi-sub muted">{k.note}</div>}
            </article>
          ))}
        </section>
      )}
      <AssetFacts facts={view.facts} />
      {view.charts.map((c) => (
        <section className="detailsection" key={c.title} aria-label={c.title}>
          <h2>{c.title}</h2>
          <HistoryLine points={c.points} label={c.label} money={c.money} />
        </section>
      ))}
      <DetailTables tables={view.tables} />
      <ActivityLog items={activity} />
    </main>
  );
}
