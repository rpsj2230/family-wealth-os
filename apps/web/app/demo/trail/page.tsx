import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import type { ChainContext } from '@/components/MoneyChainView';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { demoTrail } from '@/lib/demo-trail';
import { FlowTab, TRAIL_TABS, type FlowParams } from '@/app/(app)/trail/FlowTab';
import { FlowTreeTab } from '@/app/(app)/trail/FlowTreeTab';
import { TrailView } from '@/app/(app)/trail/TrailView';

export const metadata: Metadata = {
  title: 'Sample: money trail',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of the money trail on the invented sample household: details, flow diagram and flow tree. */
export default async function DemoTrail({
  searchParams,
}: {
  searchParams: Promise<FlowParams & { tab?: string }>;
}) {
  const sp = await searchParams;
  const { data, labels, names, accounts, banks, meta } = demoTrail();
  const tab = sp.tab === 'flow' || sp.tab === 'tree' ? sp.tab : 'details';
  const chain: ChainContext = {
    chain: data.chain,
    opts: data.traceOptions,
    labels,
    names,
    remitById: data.remitById,
    lineHref: (a, l) => `/demo/line?a=${a}&l=${l}`,
    assetHref: (a) => `/demo/trail?h=${a}`,
  };
  const c = {
    data,
    labels,
    names,
    banks,
    meta,
    base: '/demo/trail',
    lineHref: chain.lineHref,
    assetHref: chain.assetHref,
  };
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
          <Tabs
            base="/demo/trail"
            current={tab}
            tabs={TRAIL_TABS}
            {...(sp.h ? { keep: { h: sp.h } } : {})}
          />
          {tab === 'flow' ? (
            <FlowTab c={c} p={sp} />
          ) : tab === 'tree' ? (
            <FlowTreeTab c={c} chain={chain} p={sp} />
          ) : (
            <TrailView
              data={data}
              chain={chain}
              selected={sp.h && data.trails.has(sp.h) ? sp.h : accounts.dep}
              labels={labels}
              names={names}
              base="/demo/trail"
              sample
            />
          )}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
