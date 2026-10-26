import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { loadTaskDetail } from '@/lib/detail-data';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadTaskDetail(id);
  return (
    <>
      <DetailHeader
        crumbs={[{ label: 'Plan and tasks', href: '/tasks' }, { label: 'Task' }]}
        title={d.title}
      />
      <AssetFacts facts={d.facts} />
      <ActivityLog items={d.activity} />
    </>
  );
}
