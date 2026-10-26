import Link from 'next/link';
import { daysUntil, dueText, taskConcern, type Concern } from '@fwos/core';
import './tasks.css';

export interface TaskModel {
  id: string;
  title: string;
  status: 'open' | 'done' | 'dropped';
  dueOn: string | null;
  doneAt: string | null;
  assetId: string | null;
  institutionId: string | null;
}

export interface TaskNames {
  asset: ReadonlyMap<string, string>;
  institution: ReadonlyMap<string, string>;
}

const niceDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The "what it concerns" chip: a link to the account, the bank or the page that made the task. */
export function ConcernChip({ c, linked = true }: { c: Concern | null; linked?: boolean }) {
  if (!c) return null;
  return linked ? (
    <Link className="chip tiny" href={c.href}>
      {c.label}
    </Link>
  ) : (
    <span className="chip tiny">{c.label}</span>
  );
}

/** One open task: a round tick to finish it, the title, when it is due, what it is about. */
export function OpenTaskRow({
  t,
  today,
  names,
  setStatus,
  linked = true,
}: {
  t: TaskModel;
  today: string;
  names: TaskNames;
  /** server action; absent on the public sample */
  setStatus?: ((f: FormData) => Promise<void>) | undefined;
  linked?: boolean;
}) {
  const d = daysUntil(t.dueOn, today);
  const c = taskConcern(t, names);
  return (
    <li
      data-item
      data-f-title={t.title}
      data-f-due={t.dueOn ?? ''}
      data-f-status="open"
      className="tk-row"
    >
      {setStatus ? (
        <form action={setStatus}>
          <input type="hidden" name="id" value={t.id} />
          <button
            className="tk-done"
            name="status"
            value="done"
            aria-label={`Mark done: ${t.title}`}
            title="Mark done"
          >
            <span aria-hidden="true">✓</span>
          </button>
        </form>
      ) : (
        <span className="tk-done" aria-hidden="true" />
      )}
      <div className="tk-title">
        {linked ? <Link href={`/tasks/${t.id}`}>{t.title}</Link> : <span>{t.title}</span>}
        <div className="tk-meta">
          <span className={d !== null && d < 0 ? 'late' : d !== null && d <= 7 ? 'soon' : ''}>
            {dueText(t.dueOn, today)}
            {t.dueOn && d !== null && d <= 7 ? ` · ${niceDay(t.dueOn)}` : ''}
          </span>
          <ConcernChip c={c} linked={linked} />
        </div>
      </div>
      {setStatus && (
        <form action={setStatus} className="tk-side">
          <input type="hidden" name="id" value={t.id} />
          <button
            className="btn compact ghost"
            name="status"
            value="dropped"
            title="Not needed any more"
            aria-label={`Drop: ${t.title}`}
          >
            Not needed
          </button>
        </form>
      )}
    </li>
  );
}

/** A finished or dropped task, with a way back. */
export function ClosedTaskRow({
  t,
  names,
  setStatus,
  linked = true,
}: {
  t: TaskModel;
  names: TaskNames;
  setStatus?: ((f: FormData) => Promise<void>) | undefined;
  linked?: boolean;
}) {
  const c = taskConcern(t, names);
  return (
    <li
      data-item
      data-f-title={t.title}
      data-f-due={t.dueOn ?? ''}
      data-f-status={t.status}
      className="tk-row"
    >
      <span
        className="tk-done"
        aria-hidden="true"
        style={{ color: 'var(--ok-fg)', borderColor: 'var(--ok-fg)' }}
      >
        {t.status === 'done' ? '✓' : '–'}
      </span>
      <div className="tk-title muted">
        {linked ? <Link href={`/tasks/${t.id}`}>{t.title}</Link> : <span>{t.title}</span>}
        <div className="tk-meta">
          <span>
            {t.status === 'done' ? `Done${t.doneAt ? ` ${niceDay(t.doneAt)}` : ''}` : 'Dropped'}
          </span>
          <ConcernChip c={c} linked={linked} />
        </div>
      </div>
      {setStatus && (
        <form action={setStatus} className="tk-side">
          <input type="hidden" name="id" value={t.id} />
          <button className="btn compact ghost" name="status" value="open">
            Reopen
          </button>
        </form>
      )}
    </li>
  );
}
