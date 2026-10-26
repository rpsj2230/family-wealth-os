import { loadContext } from '@/lib/data';
import { addTask, setTaskStatus } from './actions';
import { BulkTasks } from './BulkTasks';
import type { TaskModel } from './Parts';
import { TasksView, parseTaskTab } from './TasksView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Tasks' };

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [tasks, inst, assets] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, due_on, institution_id, asset_id, created_at, done_at')
      .order('due_on', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase.from('institutions').select('id, name').order('name'),
    supabase.from('assets').select('id, nickname, label'),
  ]);
  const institutions = (inst.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
  }));
  const models: TaskModel[] = (tasks.data ?? []).map((t) => ({
    id: t.id as string,
    title: t.title as string,
    status: t.status as TaskModel['status'],
    dueOn: (t.due_on as string | null) ?? null,
    doneAt: (t.done_at as string | null) ?? null,
    assetId: (t.asset_id as string | null) ?? null,
    institutionId: (t.institution_id as string | null) ?? null,
  }));
  return (
    <TasksView
      tasks={models}
      today={new Date().toISOString().slice(0, 10)}
      names={{
        asset: new Map(
          (assets.data ?? []).map((a) => [
            a.id as string,
            ((a.label as string | null) ?? (a.nickname as string)) as string,
          ]),
        ),
        institution: new Map(institutions.map((i) => [i.id, i.name])),
      }}
      banks={institutions}
      tab={parseTaskTab(tab)}
      base="/tasks"
      addTask={addTask}
      setStatus={setTaskStatus}
      bulk={<BulkTasks />}
    />
  );
}
