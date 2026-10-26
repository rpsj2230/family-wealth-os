import Link from 'next/link';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { loadTaskDetail } from '@/lib/detail-data';
import { setTaskStatus, updateTask } from '../actions';
import '../tasks.css';

export const dynamic = 'force-dynamic';

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadTaskDetail(id);
  const open = d.task.status === 'open';
  return (
    <>
      <DetailHeader
        crumbs={[{ label: 'Tasks', href: '/tasks' }, { label: 'Task' }]}
        title={d.title}
        actions={
          <form action={setTaskStatus} className="row">
            <input type="hidden" name="id" value={d.task.id} />
            {open ? (
              <>
                <button className="btn primary" name="status" value="done">
                  Mark done
                </button>
                <button className="btn" name="status" value="dropped">
                  Not needed
                </button>
              </>
            ) : (
              <button className="btn" name="status" value="open">
                Reopen
              </button>
            )}
          </form>
        }
      />
      <AssetFacts facts={d.facts} />
      <section className="card" aria-labelledby="chg">
        <h2 id="chg">Change this task</h2>
        <form action={updateTask} className="tk-edit">
          <input type="hidden" name="id" value={d.task.id} />
          <label>
            What to do
            <input name="title" defaultValue={d.title} required />
          </label>
          <label>
            Due (clear it for no date)
            <input name="due" type="date" defaultValue={d.task.dueOn ?? ''} />
          </label>
          <button className="btn">Save changes</button>
        </form>
        <p className="muted small" style={{ marginBottom: 0 }}>
          <Link href="/tasks">Back to all tasks</Link>
        </p>
      </section>
      <ActivityLog items={d.activity} />
    </>
  );
}
