import Link from 'next/link';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { loadReadingDetail } from '@/lib/record-data';

export const dynamic = 'force-dynamic';

export default async function ReadingPage({
  params,
}: {
  params: Promise<{ id: string; obsId: string }>;
}) {
  const { id, obsId } = await params;
  const d = await loadReadingDetail(id, obsId);
  return (
    <>
      <DetailHeader
        crumbs={[
          {
            label: d.kind === 'reading' ? 'Accounts' : 'Investments',
            href: d.kind === 'reading' ? '/accounts' : '/investments',
          },
          { label: d.assetTitle, href: `/asset/${id}` },
          { label: d.title },
        ]}
        title={d.title}
        {...(d.person ? { person: d.person } : {})}
        subtitle={`A recorded value for ${d.assetTitle}`}
        headline={d.headline}
        headlineNote={d.headlineNote}
        actions={
          <Link className="btn compact" href={`/asset/${id}`}>
            Back to {d.assetTitle}
          </Link>
        }
      />
      <AssetFacts facts={d.facts} />
      {d.neighbours.length > 0 && (
        <section className="detailsection" aria-label="Neighbouring records">
          <h2>Before and after</h2>
          <ul className="related">
            {d.neighbours.map((n) => (
              <li key={n.href}>
                <span className="muted">{n.label}</span>
                <Link href={n.href}>{n.text}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <ActivityLog items={d.activity} />
    </>
  );
}
