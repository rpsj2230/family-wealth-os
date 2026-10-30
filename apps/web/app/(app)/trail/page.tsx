import { redirect } from 'next/navigation';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { loadAccess } from '@/lib/data';
import { chainContextOf, loadTrailContext } from '@/lib/trail-data';
import { FlowTab, TRAIL_TABS, type FlowParams } from './FlowTab';
import { FlowTreeTab } from './FlowTreeTab';
import { TrailView } from './TrailView';

export const dynamic = 'force-dynamic';

/**
 * The money trail: where the money in each account and deposit came from, back to Singapore, and whose it was. The details (the
 * default), the same trail as a flow diagram, and as an expandable tree.
 */
export default async function MoneyTrail({
  searchParams,
}: {
  searchParams: Promise<FlowParams & { tab?: string }>;
}) {
  const sp = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const t = await loadTrailContext();
  const { data, labels, names } = t;
  const tab = sp.tab === 'flow' || sp.tab === 'tree' ? sp.tab : 'details';
  const selected = sp.h && data.trails.has(sp.h) ? sp.h : null;
  const chain = chainContextOf(t);
  const c = {
    data,
    labels,
    names,
    banks: t.banks,
    meta: t.meta,
    base: '/trail',
    lineHref: chain.lineHref,
    assetHref: chain.assetHref,
  };
  return (
    <>
      <PageHead
        title="Money trail"
        subtitle="Where the money in each account and deposit came from, back to Singapore, and whose money it was."
      />
      <Tabs
        base="/trail"
        current={tab}
        tabs={TRAIL_TABS}
        {...(sp.h ? { keep: { h: sp.h } } : {})}
      />
      {tab === 'flow' ? (
        <FlowTab c={c} p={sp} />
      ) : tab === 'tree' ? (
        <FlowTreeTab c={c} chain={chain} p={sp} />
      ) : (
        <TrailView data={data} chain={chain} selected={selected} labels={labels} names={names} />
      )}
    </>
  );
}
