import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CONFIG, parseRange, personStyles, type NavPoint } from '@fwos/core';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { FundDetailPanel } from '@/components/FundDetailPanel';
import { HistoryLine } from '@/components/HistoryLine';
import { DEMO_HOLDING_MONTHS, DEMO_TODAY, demoFund } from '@/lib/demo-funds';
import { buildFundDetail, NAV_POINTS } from '@/lib/fund-detail-model';
import type { FundRow } from '@/lib/investments';
import {
  buildActivity,
  buildAssetView,
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

function fdInput(): AssetViewInput {
  return {
    ...common,
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
    current: { amount: 1_043_800, basis: 'calculated', ageDays: 0, asOf: TODAY },
    observations: [],
    fd: {
      principal: 1_000_000,
      rate: 0.0725,
      booked_on: '2025-10-26',
      maturity_on: '2027-10-26',
      compounding: 'quarterly',
      bank_maturity_amount: null,
      fd_ref_last4: '5076',
    },
    linked: { id: 's1', label: 'Sample Equity Bank Cash-NRE-1100' },
  };
}

function fundInput(f: FundRow, navs: NavPoint[]): AssetViewInput {
  return {
    ...common,
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

export default async function DemoAsset({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; range?: string }>;
}) {
  const { kind, range: rangeParam } = await searchParams;
  const fund = kind === 'fund';
  const range = parseRange(rangeParam);
  const sample = demoFund('f1', range);
  const detail = buildFundDetail({
    fund: sample.row,
    navs: sample.navs,
    today: DEMO_TODAY,
    range,
    holdingMonths: DEMO_HOLDING_MONTHS,
    config: DEFAULT_CONFIG.funds,
    maxPoints: NAV_POINTS,
  });
  const view = buildAssetView(fund ? fundInput(sample.row, sample.navs) : fdInput());
  const activity = buildActivity({
    viewerId: 'me',
    audit: audit.filter((a) =>
      fund ? a.table_name !== 'fixed_deposits' : a.table_name !== 'mf_positions',
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
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented data. See another sample: <Link href="/demo/asset">Fixed deposit</Link> ·{' '}
        <Link href="/demo/asset?kind=fund">Mutual fund</Link>
      </p>
      <DetailHeader
        crumbs={[{ label: fund ? 'Investments' : 'Accounts' }, { label: view.title }]}
        title={view.title}
        subtitle={view.subtitle}
        person={PEOPLE.p1!}
        {...(view.headline ? { headline: view.headline } : {})}
        {...(view.headlineNote ? { headlineNote: view.headlineNote } : {})}
      />
      <AssetFacts facts={view.facts} />
      {view.charts
        .filter((c) => !(fund && c.label === 'NAV'))
        .map((c) => (
          <section className="detailsection" key={c.title} aria-label={c.title}>
            <h2>{c.title}</h2>
            <HistoryLine points={c.points} label={c.label} money={c.money} />
          </section>
        ))}
      {fund && (
        <FundDetailPanel
          fund={sample.row}
          detail={detail}
          base="/demo/asset?kind=fund"
          links={{ update: '/demo/investments?tab=update', match: '/demo/investments?tab=match' }}
          holdingMonths={DEMO_HOLDING_MONTHS}
          colour={PEOPLE.p1!.colour}
        />
      )}
      <DetailTables tables={view.tables} />
      <ActivityLog items={activity} />
    </main>
  );
}
