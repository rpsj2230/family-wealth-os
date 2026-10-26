import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { loadPolicyDetail } from '@/lib/detail-data';

export const dynamic = 'force-dynamic';

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPolicyDetail(id);
  return (
    <>
      <DetailHeader
        crumbs={[{ label: 'Lent, policies, property', href: '/others' }, { label: 'Policy' }]}
        title={d.title}
      />
      <AssetFacts facts={d.facts} />
      <ActivityLog items={d.activity} />
    </>
  );
}
