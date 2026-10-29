import { notFound, redirect } from 'next/navigation';
import { lineDetail } from '@fwos/data';
import { LineView } from '@/components/LineView';
import { loadAccess } from '@/lib/data';
import { chainContextOf, loadTrailContext } from '@/lib/trail-data';

export const dynamic = 'force-dynamic';

/** One bank statement line, with its trail (components/LineView.tsx). */
export default async function StatementLinePage({
  params,
}: {
  params: Promise<{ id: string; lineId: string }>;
}) {
  const { id, lineId } = await params;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const t = await loadTrailContext();
  const { data, labels, names } = t;
  const d = lineDetail(data, lineId);
  if (!d || d.line.assetId !== id) notFound();
  return (
    <LineView
      d={d}
      data={data}
      chain={chainContextOf(t)}
      labels={labels}
      names={names}
      lineHref={(a, l) => `/asset/${a}/line/${l}`}
    />
  );
}
