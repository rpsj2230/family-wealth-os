import type { Metadata } from 'next';
import Link from 'next/link';
import type { SkipGroup } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { DEMO_ACCOUNTS, demoAutomation, demoInbox } from '@/lib/demo-datain';
import { INBOX_TABS, InboxBoard, type InboxTab } from '@/app/(app)/inbox/Board';

export const metadata: Metadata = {
  title: 'Sample bank emails',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const FILTERS = ['all', 'notbalance', 'older', 'dismissed', 'problem'] as const;

/** Public preview of the bank-email inbox with invented messages: nothing is read or saved. */
export default async function DemoInbox({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; f?: string }>;
}) {
  const sp = await searchParams;
  const tab: InboxTab = (INBOX_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as InboxTab)
    : 'review';
  const filter = ((FILTERS as readonly string[]).includes(sp.f ?? '') ? sp.f : 'all') as
    SkipGroup | 'all';
  const cards = demoAutomation();
  const entries = demoInbox();
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
            Sample with invented messages: nothing here is read from a real mailbox.{' '}
            <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Bank emails"
            subtitle="Forward bank alerts and statements to your Gmail label. Safe ones are recorded by themselves; anything uncertain waits here for you."
            pills={[
              { label: '3 to review', tone: 'warn' },
              { label: 'Reader: Some emails failed', tone: 'warn' },
            ]}
          />
          <InboxBoard
            base="/demo/inbox"
            tab={tab}
            filter={filter}
            entries={entries}
            accounts={DEMO_ACCOUNTS}
            automation={cards}
            label="FWOS/Inbox"
            aiKeySet={false}
            demo
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
