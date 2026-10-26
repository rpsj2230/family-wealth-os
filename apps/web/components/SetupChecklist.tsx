import Link from 'next/link';
import { Check, Circle } from 'lucide-react';
import './SetupChecklist.css';

export interface SetupChecklistItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
  /** one short sentence: what is missing, or what is set */
  hint?: string;
}

/**
 * What is set up and what still needs the person, each with a direct link. A server component over plain props, so the
 * dashboard can place it anywhere: `<SetupChecklist items={await loadSetupStatus(supabase)} compact />`.
 * Compact shows only what is still to do (at most `max` lines) and a link to the full list; otherwise every line is shown.
 */
export function SetupChecklist({
  items,
  compact = false,
  max = 4,
  title = 'Setup checklist',
}: {
  items: SetupChecklistItem[];
  compact?: boolean;
  max?: number;
  title?: string;
}) {
  const done = items.filter((i) => i.done).length;
  const todo = items.filter((i) => !i.done);
  const shown = compact ? todo.slice(0, max) : items;
  const pct = items.length === 0 ? 0 : Math.round((done / items.length) * 100);
  return (
    <section className={`setupcl ${compact ? 'compact' : ''}`} aria-label={title}>
      <header className="setupcl-head">
        <h2>{title}</h2>
        <span className="setupcl-count">
          {done} of {items.length} done
        </span>
      </header>
      <div
        className="setupcl-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
        aria-label={`${done} of ${items.length} set up`}
      >
        <span style={{ width: `${pct}%` }} />
      </div>
      {shown.length === 0 ? (
        <p className="setupcl-empty">Everything is set up.</p>
      ) : (
        <ul className="setupcl-list">
          {shown.map((i) => (
            <li key={i.key} className={i.done ? 'is-done' : 'is-todo'}>
              <span className="setupcl-icon" aria-hidden>
                {i.done ? <Check size={14} /> : <Circle size={14} />}
              </span>
              <div className="setupcl-body">
                <Link href={i.href} className="setupcl-label">
                  {i.label}
                </Link>
                <span className="setupcl-state">{i.done ? 'Done' : 'To do'}</span>
                {i.hint && <p className="setupcl-hint">{i.hint}</p>}
              </div>
              {!i.done && (
                <Link href={i.href} className="setupcl-go" aria-label={`Open: ${i.label}`}>
                  Open
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
      {compact && todo.length > shown.length && (
        <p className="setupcl-more">
          <Link href="/settings?tab=setup">See all {todo.length} open items</Link>
        </p>
      )}
      {compact && todo.length > 0 && todo.length <= shown.length && (
        <p className="setupcl-more">
          <Link href="/settings?tab=setup">Open the full checklist</Link>
        </p>
      )}
    </section>
  );
}
