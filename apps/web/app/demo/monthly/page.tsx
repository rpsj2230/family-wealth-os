import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { UpdateGrid } from '@/components/UpdateGrid';
import { demoModel } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample monthly update',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

export default function DemoMonthly() {
  const { blocks, styles } = demoModel();
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
          <h1>Monthly update · October 2026</h1>
          <UpdateGrid
            blocks={blocks.slice(0, 3)}
            styles={styles}
            today="2026-10-26"
            fxHint={{}}
            institutions={false}
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
