import type { Metadata } from 'next';
import Link from 'next/link';
import { standings, summarizeStandings } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { AutomationStrip } from '@/components/AutomationCards';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { UpdateGrid } from '@/components/UpdateGrid';
import { demoModel } from '@/lib/demo-fixture';
import { demoAutomation } from '@/lib/demo-datain';
import type { GridRow } from '@/lib/monthly';
import { MonthlyGrid } from '@/app/(app)/monthly/MonthlyGrid';

export const metadata: Metadata = {
  title: 'Sample monthly update',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const OTHER: GridRow[] = [
  {
    id: 'o1',
    name: 'Sample Flat',
    owner: 'Anil',
    type: 'property',
    group: 'Property',
    currency: 'INR',
    mode: 'value',
    latestAmount: 8_500_000,
    latestAsOf: '2026-03-31',
    freshness: 'stale',
    estimatedToday: 8_500_000,
    fxRate: null,
    interestRate: null,
    tdsRate: null,
    status: 'active',
    origin: { label: 'You, 31 Mar', kind: 'manual' },
  },
  {
    id: 'o2',
    name: 'Sample Pension Plan',
    owner: 'Beena',
    type: 'ulip',
    group: 'ULIP / pension',
    currency: 'INR',
    mode: 'value',
    latestAmount: 640_000,
    latestAsOf: '2026-10-05',
    freshness: 'current',
    estimatedToday: 640_000,
    fxRate: null,
    interestRate: null,
    tdsRate: null,
    status: 'active',
    origin: { label: 'Imported sheet, 5 Oct', kind: 'import' },
  },
];

/** Public preview of the Monthly update with invented banks: typing works, saving needs a sign-in. */
export default async function DemoMonthly({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = sp.tab === 'other' ? 'other' : 'banks';
  const { blocks, styles } = demoModel();
  const shown = blocks.slice(0, 6);
  const sum = summarizeStandings(standings(shown, '2026-10-26'));
  const waiting = sum.waiting + sum.attention;
  const tabs = [
    { key: 'banks', label: 'Banks and deposits', badge: waiting },
    { key: 'other', label: 'Property, loans and other' },
  ];
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            Sample with invented names and amounts: typing works, saving needs a sign-in.{' '}
            <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Monthly update"
            subtitle="Keep every balance current for October 2026. Type a new balance, or mark a bank as unchanged; deposits and funds look after themselves."
            pills={[
              {
                label: `${sum.current} of ${sum.banks} banks up to date`,
                tone: waiting === 0 ? 'ok' : 'warn',
              },
            ]}
          />
          <Tabs base="/demo/monthly" current={tab} tabs={tabs} />
          {tab === 'other' ? (
            <MonthlyGrid rows={OTHER} today="2026-10-26" />
          ) : (
            <>
              <AutomationStrip
                cards={demoAutomation().filter((c) => c.key !== 'digest' && c.key !== 'rates')}
              />
              <UpdateGrid
                blocks={shown}
                styles={styles}
                today="2026-10-26"
                fxHint={{}}
                institutions={false}
              />
            </>
          )}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
