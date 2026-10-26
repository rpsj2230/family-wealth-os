import type { ReactNode } from 'react';
import { daysUntil, groupOpenTasks } from '@fwos/core';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { ClosedTaskRow, OpenTaskRow, type TaskModel, type TaskNames } from './Parts';
import './tasks.css';

export const TASK_TABS = ['todo', 'done'] as const;
export type TaskTab = (typeof TASK_TABS)[number];
export const parseTaskTab = (s: string | undefined): TaskTab =>
  (TASK_TABS as readonly string[]).includes(s ?? '') ? (s as TaskTab) : 'todo';

/**
 * Tasks grouped by when they are due: overdue, this week, later, no date; and, on their own tab, what is finished. Used by the
 * signed-in page and the public sample (which passes no actions).
 */
export function TasksView({
  tasks,
  today,
  names,
  banks,
  tab,
  base,
  addTask,
  setStatus,
  bulk,
  title = 'Tasks',
  linked = true,
}: {
  tasks: TaskModel[];
  today: string;
  names: TaskNames;
  banks: { id: string; name: string }[];
  tab: TaskTab;
  base: string;
  addTask?: ((f: FormData) => Promise<void>) | undefined;
  setStatus?: ((f: FormData) => Promise<void>) | undefined;
  bulk?: ReactNode;
  title?: string;
  linked?: boolean;
}) {
  const groups = groupOpenTasks(tasks, today);
  const open = tasks.filter((t) => t.status === 'open');
  const closed = tasks
    .filter((t) => t.status !== 'open')
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  const overdue = groups.find((g) => g.key === 'overdue')!.tasks.length;
  const week = groups.find((g) => g.key === 'week')!.tasks.length;
  const next = open
    .filter((t) => t.dueOn !== null && (daysUntil(t.dueOn, today) ?? -1) >= 0)
    .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!))[0];

  return (
    <>
      <PageHead
        title={title}
        subtitle="Things to do: admin items from your old sheet, reminders made by other pages (for example a plan from I need money or the tax harvest) and anything you add. Tick the circle when it is done."
        pills={[
          { label: `${open.length} to do`, tone: 'info' },
          ...(overdue > 0 ? [{ label: `${overdue} overdue`, tone: 'bad' as const }] : []),
          ...(week > 0 ? [{ label: `${week} due this week`, tone: 'warn' as const }] : []),
        ]}
        actions={
          addTask ? (
            <a className="btn primary" href="#add">
              Add a task
            </a>
          ) : undefined
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'todo', label: 'To do', badge: open.length || null },
          { key: 'done', label: 'Done or dropped', badge: closed.length || null },
        ]}
      />

      {tab === 'todo' && (
        <ListingTools
          name="tasks"
          listCols={[
            { key: 'title', label: 'Task' },
            { key: 'due', label: 'Due' },
            { key: 'status', label: 'Status' },
          ]}
        >
          {addTask && (
            <section className="card" id="add" aria-labelledby="add-h">
              <h2 id="add-h" className="sr-only">
                Add a task
              </h2>
              <form action={addTask} className="tk-add">
                <label>
                  New task
                  <input
                    name="title"
                    placeholder="For example: Update address at Yes Bank"
                    required
                    autoComplete="off"
                  />
                </label>
                <label>
                  Due (optional)
                  <input name="due" type="date" />
                </label>
                <label>
                  About (optional)
                  <select name="institution" defaultValue="">
                    <option value="">No bank in particular</option>
                    {banks.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn primary">Add</button>
              </form>
            </section>
          )}
          {open.length === 0 && (
            <p className="empty">
              Nothing to do. When a plan from I need money or the tax harvest makes reminders, they
              appear here.
            </p>
          )}
          {next && overdue === 0 && week === 0 && (
            <p className="muted small">
              Next due: {next.title} ({next.dueOn}).
            </p>
          )}
          {groups
            .filter((g) => g.tasks.length > 0)
            .map((g) => (
              <section
                key={g.key}
                className={`card tk-group ${g.key}`}
                aria-labelledby={`tk-${g.key}`}
              >
                <h2 id={`tk-${g.key}`}>
                  {g.label} <span className="n">{g.tasks.length}</span>
                </h2>
                <ul className="tk-list">
                  {g.tasks.map((t) => (
                    <OpenTaskRow
                      key={t.id}
                      t={t}
                      today={today}
                      names={names}
                      setStatus={setStatus}
                      linked={linked}
                    />
                  ))}
                </ul>
              </section>
            ))}
          {bulk}
        </ListingTools>
      )}

      {tab === 'done' && (
        <ListingTools
          name="tasks-done"
          listCols={[
            { key: 'title', label: 'Task' },
            { key: 'due', label: 'Due' },
            { key: 'status', label: 'Status' },
          ]}
        >
          {closed.length === 0 ? (
            <p className="empty">
              Nothing finished yet. Tasks you tick off or drop are kept here, with a way back.
            </p>
          ) : (
            <section className="card">
              <ul className="tk-list">
                {closed.map((t) => (
                  <ClosedTaskRow
                    key={t.id}
                    t={t}
                    names={names}
                    setStatus={setStatus}
                    linked={linked}
                  />
                ))}
              </ul>
            </section>
          )}
        </ListingTools>
      )}
    </>
  );
}
