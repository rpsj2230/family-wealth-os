import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { demoAutomation } from '@/lib/demo-datain';
import { IMPORT_TABS, ImportHub, type ImportData, type ImportTab } from '@/app/(app)/import/Hub';

export const metadata: Metadata = {
  title: 'Sample import',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const DATA: ImportData = {
  today: '2026-10-26',
  taxFy: '2025-26',
  owners: [
    { id: 'p1', name: 'Anil', panLast4: '234F', hasDob: true },
    { id: 'p2', name: 'Beena', panLast4: null, hasDob: false },
  ],
  workbook: {
    at: '2026-10-20T08:00:00Z',
    asOf: '2026-10-19',
    source: 'sample-household.xlsx',
    counts: { assets: 34, observations: 34, 'fixed deposits': 12, funds: 9 },
  },
  cas: [
    {
      id: 'c1',
      at: '2026-10-20T04:00:00Z',
      owner: 'Anil',
      schemes: 6,
      transactions: 41,
      outcome: 'imported',
      detail: null,
      fromEmail: true,
    },
    {
      id: 'c2',
      at: '2026-10-12T04:00:00Z',
      owner: 'Beena',
      schemes: 3,
      transactions: 12,
      outcome: 'partial',
      detail: '3 funds updated, 12 new transactions; check: Sample Index Fund',
      fromEmail: false,
    },
    {
      id: 'c3',
      at: '2026-10-03T04:00:00Z',
      owner: null,
      schemes: 0,
      transactions: 0,
      outcome: 'failed',
      detail: 'The PDF is password-protected and none of the saved passwords opened it.',
      fromEmail: true,
    },
  ],
  tax: [
    { owner: 'Anil', fy: '2025-26', kind: '26as', readBy: 'rules', uploadedOn: '2026-10-14' },
    { owner: 'Anil', fy: '2025-26', kind: 'ais', readBy: 'ai', uploadedOn: '2026-10-14' },
  ],
  email: demoAutomation().find((c) => c.key === 'email') ?? null,
};

/** Public preview of the import hub with invented results: the forms are shown but cannot be used. */
export default async function DemoImport({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab: ImportTab = (IMPORT_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as ImportTab)
    : 'start';
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
            Sample with invented results: nothing can be uploaded here.{' '}
            <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Import"
            subtitle="Choose a file and the app works out what it is. Most of this arrives by itself when you forward the email to your Gmail label; use this page when you have the file in hand."
          />
          <ImportHub base="/demo/import" tab={tab} data={DATA} demo />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
