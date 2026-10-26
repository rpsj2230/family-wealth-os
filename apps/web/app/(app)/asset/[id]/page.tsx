import Link from 'next/link';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader, type Crumb } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { HistoryLine } from '@/components/HistoryLine';
import { loadAssetDetail } from '@/lib/detail-data';

export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadAssetDetail(id);
  const isFund = d.type === 'mutual_fund' || d.type === 'stock';
  const isBankLike =
    d.type === 'bank_account' || d.type === 'fixed_deposit' || d.type === 'third_party_held';
  const crumbs: Crumb[] = isFund
    ? [{ label: 'Investments', href: '/investments' }]
    : isBankLike
      ? [
          { label: 'Accounts', href: '/accounts' },
          ...(d.bank ? [{ label: d.bank.name, href: `/bank/${d.bank.id}` }] : []),
        ]
      : [{ label: 'Lent, policies, property', href: '/others' }];
  crumbs.push({ label: d.view.title });
  return (
    <>
      <DetailHeader
        crumbs={crumbs}
        title={d.view.title}
        subtitle={d.view.subtitle}
        {...(d.person ? { person: d.person } : {})}
        {...(d.view.headline ? { headline: d.view.headline } : {})}
        {...(d.view.headlineNote ? { headlineNote: d.view.headlineNote } : {})}
        actions={
          <>
            {isBankLike && (
              <Link className="btn compact" href="/accounts/edit">
                Edit details
              </Link>
            )}
            <Link className="btn compact" href="/monthly">
              Update balance
            </Link>
          </>
        }
      />
      <AssetFacts facts={d.view.facts} />
      {d.view.charts.map((c) => (
        <section className="detailsection" key={c.title} aria-label={c.title}>
          <h2>{c.title}</h2>
          <HistoryLine points={c.points} label={c.label} money={c.money} />
        </section>
      ))}
      <DetailTables tables={d.view.tables} />
      <ActivityLog items={d.activity} />
    </>
  );
}
