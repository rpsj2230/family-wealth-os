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
  /** switched off as not needed */
  off?: boolean;
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
  switchOff,
}: {
  items: SetupChecklistItem[];
  compact?: boolean;
  max?: number;
  title?: string;
  /** switches an item off as not needed, or back on (a server action); without it there are no switches (the sample) */
  switchOff?: (f: FormData) => Promise<void>;
}) {
  // an item switched off as not needed is neither done nor to do: it is left out of the count
  const counted = items.filter((i) => !i.off);
  const done = counted.filter((i) => i.done).length;
  const todo = counted.filter((i) => !i.done);
  const shown = compact ? todo.slice(0, max) : counted;
  const offItems = compact ? [] : items.filter((i) => i.off);
  const total = counted.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const toggle = (i: SetupChecklistItem, off: boolean) =>
    switchOff ? (
      <form action={switchOff} className="setupcl-off">
        <input type="hidden" name="key" value={i.key} />
        {off && <input type="hidden" name="off" value="on" />}
        <button type="submit" className="linkbtn small">
          {off ? 'Not needed' : 'Turn back on'}
        </button>
      </form>
    ) : null;
  return (
    <section className={`setupcl ${compact ? 'compact' : ''}`} aria-label={title}>
      <header className="setupcl-head">
        <h2>{title}</h2>
        <span className="setupcl-count">
          {done} of {total} done
        </span>
      </header>
      <div
        className="setupcl-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-label={`${done} of ${total} set up`}
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
                <span className="setupcl-actions">
                  <Link href={i.href} className="setupcl-go" aria-label={`Open: ${i.label}`}>
                    Open
                  </Link>
                  {toggle(i, true)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {offItems.length > 0 && (
        <details className="setupcl-offlist">
          <summary className="small muted">{offItems.length} switched off as not needed</summary>
          <ul className="setupcl-list">
            {offItems.map((i) => (
              <li key={i.key} className="is-off">
                <span className="setupcl-icon" aria-hidden />
                <div className="setupcl-body">
                  <span className="setupcl-label">{i.label}</span>
                </div>
                {toggle(i, false)}
              </li>
            ))}
          </ul>
        </details>
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
