import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { demoTrail } from '@/lib/demo-trail';
import { TrailView } from '@/app/(app)/trail/TrailView';

export const metadata: Metadata = {
  title: 'Sample: money trail',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of the money trail on the invented sample household. */
export default async function DemoTrail({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const { h } = await searchParams;
  const { data, labels, names, accounts } = demoTrail();
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
            Sample with invented figures. <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Money trail"
            subtitle="Where the money in each account and deposit came from, back to Singapore, and whose money it was."
          />
          <TrailView
            data={data}
            selected={h && data.trails.has(h) ? h : accounts.dep}
            labels={labels}
            names={names}
            base="/demo/trail"
            sample
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
