import '@/app/detail.css';

export interface ActivityItem {
  /** ISO time */
  at: string;
  who: string;
  title: string;
  changes: { label: string; before: string | null; after: string | null }[];
  kind: 'change' | 'mail' | 'import';
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Singapore',
  });

/** Everything that happened to this record, newest first, each as a sentence with what changed. */
export function ActivityLog({ items }: { items: ActivityItem[] }) {
  return (
    <section className="detailsection" aria-label="Activity log">
      <h2>Activity log</h2>
      <p className="small muted">
        Every change recorded for this item: who made it (or the automatic job), when, and what it
        changed from and to.
      </p>
      {items.length === 0 ? (
        <p className="detail-empty">Nothing has been recorded yet.</p>
      ) : (
        <ol className="activity">
          {items.map((a, i) => (
            <li key={i} className={a.kind === 'change' ? undefined : a.kind}>
              <div className="when">
                {when(a.at)} · {a.who}
              </div>
              <div className="title">{a.title}</div>
              {a.changes.length > 0 && (
                <ul className="changes">
                  {a.changes.map((c) => (
                    <li key={c.label}>
                      <span className="muted">{c.label}:</span>{' '}
                      {c.before === null ? <em className="muted">empty</em> : <del>{c.before}</del>}
                      <span className="arrow" aria-label="changed to">
                        →
                      </span>
                      {c.after === null ? (
                        <em className="muted">empty</em>
                      ) : (
                        <strong>{c.after}</strong>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
