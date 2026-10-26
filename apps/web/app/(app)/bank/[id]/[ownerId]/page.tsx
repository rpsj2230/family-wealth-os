import Link from 'next/link';
import { formatInr } from '@fwos/core';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { HistoryLine } from '@/components/HistoryLine';
import { loadBankDetail } from '@/lib/detail-data';
import { slugify } from '@/lib/slug';

export const dynamic = 'force-dynamic';

/** One person's accounts and deposits at one bank: the page behind the person heading on the Accounts list. */
export default async function BankPersonPage({
  params,
}: {
  params: Promise<{ id: string; ownerId: string }>;
}) {
  const { id, ownerId } = await params;
  const d = await loadBankDetail(id, ownerId);
  const who = d.person?.name ?? '';
  return (
    <>
      <DetailHeader
        crumbs={[
          { label: 'Accounts', href: '/accounts' },
          { label: d.name, href: `/bank/${id}` },
          { label: who },
        ]}
        title={`${who} at ${d.name}`}
        {...(d.person ? { person: d.person } : {})}
        subtitle="Their savings accounts and deposits at this bank, how it has moved, what matures when, how much is insured, and everything that changed."
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
        <h2>
          {who}&apos;s money at {d.name} over time
        </h2>
        <HistoryLine points={d.history} label="Total" />
      </section>
      <DetailTables tables={d.tables} />
      <ActivityLog items={d.activity} />
    </>
  );
}
