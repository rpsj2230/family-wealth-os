import Link from 'next/link';
import type { AutomationCard } from '@fwos/core';
import './datain.css';

/** Whether the scheduled jobs (bank-email reader, market data, daily summary, rate pages) are doing their work, with dates. */
export function AutomationCards({
  cards,
  only,
}: {
  cards: AutomationCard[];
  only?: AutomationCard['key'][];
}) {
  const shown = only ? cards.filter((c) => only.includes(c.key)) : cards;
  return (
    <section aria-label="Automatic jobs" className="autogrid">
      {shown.map((c) => (
        <article key={c.key} className={`autocard ${c.tone}`}>
          <h3>
            {c.title}
            <span className={`statuspill ${c.tone}`}>{c.status}</span>
          </h3>
          <p className="muted small sched">{c.schedule}</p>
          {c.lines.map((l) => (
            <p key={l} className="small">
              {l}
            </p>
          ))}
          {c.link && (
            <Link className="small more" href={c.link.href}>
              {c.link.label}
            </Link>
          )}
        </article>
      ))}
    </section>
  );
}

/** One line per job, for pages where the status is background information. */
export function AutomationStrip({ cards }: { cards: AutomationCard[] }) {
  return (
    <p className="autostrip small" aria-label="Automatic jobs">
      <span className="muted">Automatic:</span>
      {cards.map((c) => (
        <span key={c.key}>
          {c.title} <span className={`statuspill ${c.tone}`}>{c.status}</span>
        </span>
      ))}
    </p>
  );
}
