import Link from 'next/link';
import { formatInr } from '@fwos/core';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { HistoryLine } from '@/components/HistoryLine';
import { loadBankDetail } from '@/lib/detail-data';
import { slugify } from '@/lib/slug';

export const dynamic = 'force-dynamic';

export default async function BankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadBankDetail(id);
  return (
    <>
      <DetailHeader
        crumbs={[{ label: 'Accounts', href: '/accounts' }, { label: d.name }]}
        title={d.name}
        subtitle={
          d.note ??
          'Every account and deposit at this bank, its history and everything that changed.'
        }
        headline={formatInr(Math.round(d.block?.totals.current ?? 0))}
        headlineNote="in total today"
        actions={
          <>
            <Link className="btn compact" href={`/monthly/${slugify(d.name)}`}>
              Update this bank
            </Link>
            <Link className="btn compact" href="/accounts/edit">
              Edit details
            </Link>
            <Link className="btn compact" href="/deposits">
              Deposits
            </Link>
          </>
        }
      />
      <AssetFacts facts={d.facts} />
      <section className="detailsection" aria-label="Total over time">
        <h2>All accounts together over time</h2>
        <HistoryLine points={d.history} label="Total" />
      </section>
      <DetailTables tables={d.tables} />
      <ActivityLog items={d.activity} />
    </>
  );
}
