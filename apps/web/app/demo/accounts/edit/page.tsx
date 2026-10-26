import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { AccountEditGrid } from '@/components/AccountEditGrid';
import { gridBanks } from '@/lib/account-edit';
import { demoModel } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample: edit many accounts',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

export default function DemoEditAccounts() {
  const { blocks, styles, people, assets, fds, institutionNames } = demoModel();
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
            Sample with invented names. Nothing is saved here. <Link href="/login">Sign in</Link> to
            correct your own accounts.
          </p>
          <h1>Edit many accounts at once</h1>
          <p className="muted">
            Tick rows to change many at once, or suggest types for the empty ones. Press Edit on a
            line under Accounts to change just one.
          </p>
          <AccountEditGrid
            banks={gridBanks(blocks, assets, fds)}
            owners={people}
            institutions={Object.entries(institutionNames).map(([id, name]) => ({ id, name }))}
            styles={styles}
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
