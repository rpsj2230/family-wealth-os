import type { Metadata } from 'next';
import Link from 'next/link';
import { filterBlocksByOwner, formatInr, formatInrCompact } from '@fwos/core';
import { BankTable } from '@/components/BankTable';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PersonFilter } from '@/components/Person';
import { demoModel } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample accounts',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

export default async function DemoAccounts({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { blocks, styles, portfolio } = demoModel();
  const who = p && styles[p] ? p : null;
  const shown = who ? filterBlocksByOwner(blocks, who) : blocks;
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );
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
            Sample with invented names and amounts. <Link href="/login">Sign in</Link> to see your
            own.
          </p>
          <h1>Accounts</h1>
          <p className="muted">
            Banks in your sheet&apos;s order; each person&apos;s savings and deposits with rate,
            dates, amount at maturity and today&apos;s value. {formatInr(portfolio.netWorth.total)}{' '}
            across {shown.length} banks.
          </p>
          <PersonFilter
            people={Object.values(styles)}
            basePath="/demo/accounts"
            current={who}
            totals={totals}
          />
          <BankTable blocks={shown} styles={styles} updateBase="/demo/bank" />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
