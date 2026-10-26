import type { Metadata } from 'next';
import Link from 'next/link';
import { personStyles } from '@fwos/core';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { HistoryLine } from '@/components/HistoryLine';
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

function fundInput(): AssetViewInput {
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2025, 10 + i, 26));
    return d.toISOString().slice(0, 10);
  });
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
    current: { amount: 640_000, basis: 'estimated', ageDays: 3, asOf: '2026-10-23' },
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
      invested: 420_000,
      started_on: '2022-04-01',
      sip_monthly: 10_000,
      sip_stopped: false,
      folio_last4: '4567',
      isin: 'INF000A01AB1',
      amfi_code: '120503',
      plan_type: 'direct',
    },
    txns: [
      {
        txn_on: '2022-04-01',
        kind: 'purchase',
        amount: 200_000,
        units: 2000,
        nav: 100,
        balance_units: 2000,
        description: null,
      },
      {
        txn_on: '2023-04-05',
        kind: 'sip',
        amount: 10_000,
        units: 80,
        nav: 125,
        balance_units: 2080,
        description: null,
      },
      {
        txn_on: '2024-04-05',
        kind: 'sip',
        amount: 10_000,
        units: 66.667,
        nav: 150,
        balance_units: 2146.667,
        description: null,
      },
      {
        txn_on: '2025-12-10',
        kind: 'redeem',
        amount: -60_000,
        units: -350,
        nav: 171.43,
        balance_units: 1796.667,
        description: null,
      },
    ],
    navs: months.map((d, i) => ({ nav_date: d, nav: 150 + i * 3.1 + (i % 3) * 2 })),
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
  searchParams: Promise<{ kind?: string }>;
}) {
  const { kind } = await searchParams;
  const fund = kind === 'fund';
  const view = buildAssetView(fund ? fundInput() : fdInput());
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
