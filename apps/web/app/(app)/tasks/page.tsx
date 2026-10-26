import Link from 'next/link';
import { ListingTools } from '@/components/ListingTools';
import { loadContext } from '@/lib/data';
import { addTask, setTaskStatus } from './actions';
import { BulkTasks } from './BulkTasks';

export const dynamic = 'force-dynamic';

export default async function TasksPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [tasks, inst] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, title, status, due_on, institution_id, created_at, done_at')
      .order('status', { ascending: true })
      .order('due_on', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true }),
    supabase.from('institutions').select('id, name'),
  ]);
  const name = new Map((inst.data ?? []).map((i) => [i.id as string, i.name as string]));
  const rows = tasks.data ?? [];
  const open = rows.filter((t) => t.status === 'open');
  const closed = rows.filter((t) => t.status !== 'open');
  const grouped = new Map<string, typeof open>();
  for (const t of open) {
    const k = t.institution_id ? (name.get(t.institution_id as string) ?? 'Other') : 'General';
    grouped.set(k, [...(grouped.get(k) ?? []), t]);
  }
  return (
    <>
      <h1>Tasks</h1>
      <ListingTools
        name="tasks"
        listCols={[
          { key: 'title', label: 'Task' },
          { key: 'due', label: 'Due' },
          { key: 'status', label: 'Status' },
        ]}
      >
        <p className="muted">
          Admin items from your old sheet&apos;s &ldquo;Changes Req&rdquo; column (address, KYC,
          maturity instructions) and anything you add.
        </p>
        <form action={addTask} className="card form row">
          <input
            name="title"
            placeholder="New task, for example: Update address at Yes Bank"
            required
            aria-label="Task"
          />
          <input name="due" type="date" aria-label="Due date (optional)" />
          <button className="btn primary">Add</button>
        </form>
        <BulkTasks />
        {open.length === 0 && <p className="muted">No open tasks.</p>}
        {[...grouped.entries()].map(([k, list]) => (
          <section className="card" key={k}>
            <h2>{k}</h2>
            <ul className="list nobullet">
              {list.map((t) => (
                <li
                  key={t.id as string}
                  data-item
                  data-f-title={t.title as string}
                  data-f-due={(t.due_on as string | null) ?? ''}
                  data-f-status="open"
                >
                  <form action={setTaskStatus} className="taskrow">
                    <input type="hidden" name="id" value={t.id as string} />
                    <span>
                      <Link href={`/tasks/${t.id as string}`}>{t.title as string}</Link>
                      {t.due_on ? (
                        <span className="muted small"> · due {t.due_on as string}</span>
                      ) : null}
                    </span>
                    <button className="btn compact" name="status" value="done">
                      Done
                    </button>
                    <button
                      className="btn compact ghost"
                      name="status"
                      value="dropped"
                      title="Not needed"
                    >
                      Drop
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))}
        {closed.length > 0 && (
          <details>
            <summary>Completed or dropped ({closed.length})</summary>
            <ul className="list nobullet">
              {closed.map((t) => (
                <li
                  key={t.id as string}
                  data-item
                  data-f-title={t.title as string}
                  data-f-due={(t.due_on as string | null) ?? ''}
                  data-f-status={t.status as string}
                >
                  <form action={setTaskStatus} className="taskrow">
                    <input type="hidden" name="id" value={t.id as string} />
                    <span className="muted">
                      <Link href={`/tasks/${t.id as string}`}>{t.title as string}</Link> ·{' '}
                      {t.status as string}
                    </span>
                    <button className="btn compact ghost" name="status" value="open">
                      Reopen
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </details>
        )}
      </ListingTools>
    </>
  );
}
