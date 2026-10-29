import { redirect } from 'next/navigation';
import { PageHead } from '@/components/PageHead';
import { loadAccess } from '@/lib/data';
import { chainContextOf, loadTrailContext } from '@/lib/trail-data';
import { TrailView } from './TrailView';

export const dynamic = 'force-dynamic';

/** The money trail: where the money in each account and deposit came from, back to Singapore, and whose it was. */
export default async function MoneyTrail({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const { h } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const t = await loadTrailContext();
  const { data, labels, names } = t;
  const selected = h && data.trails.has(h) ? h : null;
  return (
    <>
      <PageHead
        title="Money trail"
        subtitle="Where the money in each account and deposit came from, back to Singapore, and whose money it was."
      />
      <TrailView
        data={data}
        chain={chainContextOf(t)}
        selected={selected}
        labels={labels}
        names={names}
      />
    </>
  );
}
