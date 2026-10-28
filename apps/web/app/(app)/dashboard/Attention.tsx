import { formatInrCompact } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { CardHead, MaybeLink, homeLink } from './parts';

/** How many lines of each list Home shows; the rest are one click away on the page named in the link. */
const NEEDS_SHOWN = 6;

const TONE_WORD = { bad: 'Late', warn: 'Soon', info: 'Note' } as const;
const KIND_WORD: Record<string, string> = {
  deposit: 'Deposit',
  policy: 'Policy',
  task: 'Task',
  receivable: 'Repayment',
  tax: 'Tax',
  other: 'Other',
};

/** Everything that needs a person, most urgent first, each line with its count and the page where it is dealt with. */
export function Needs({ m, sample }: { m: HomeModel; sample: boolean }) {
  const items = m.attention;
  const shown = items.slice(0, NEEDS_SHOWN);
  return (
    <section className="card hm-card" aria-labelledby="hm-needs">
      <CardHead
        title="Needs you"
        id="hm-needs"
        href={homeLink('/tasks', sample)}
        linkLabel="All tasks"
        aside={items.length > 0 ? <span className="hm-tag warn">{items.length}</span> : null}
      />
      {items.length === 0 ? (
        <p className="notice ok" role="status">
          Nothing needs you today. Everything that could be updated automatically has been.
        </p>
      ) : (
        <ul className="hm-needs">
          {shown.map((a) => {
            const href = homeLink(a.href, sample);
            return (
              <li key={a.key} className={`hm-need ${a.tone}`}>
                <span className={`hm-tag ${a.tone}`}>{TONE_WORD[a.tone]}</span>
                <MaybeLink href={href} className="hm-need-text">
                  {a.text}
                </MaybeLink>
                {href && (
                  <span className="hm-go" aria-hidden="true">
                    →
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {items.length > NEEDS_SHOWN && (
        <p className="muted small">
          and {items.length - NEEDS_SHOWN} more:{' '}
          <MaybeLink href={homeLink('/monthly', sample)}>Monthly update</MaybeLink> and{' '}
          <MaybeLink href={homeLink('/tasks', sample)}>Tasks</MaybeLink>.
        </p>
      )}
    </section>
  );
}

/** Dated things in the next few months on one compact timeline: deposits, policies, tasks, repayments and the end of the year. */
export function ComingUp({ m, sample }: { m: HomeModel; sample: boolean }) {
  return (
    <section className="card hm-card" aria-labelledby="hm-coming">
      <CardHead title="Coming up" id="hm-coming" />
      {m.events.length === 0 ? (
        <p className="muted small">Nothing dated in the next {m.eventDays} days.</p>
      ) : (
        <ol className="hm-timeline">
          {m.events.map((e, i) => {
            const late = e.daysLeft < 0;
            const when = late
              ? `${-e.daysLeft}d late`
              : e.daysLeft === 0
                ? 'today'
                : `in ${e.daysLeft}d`;
            return (
              <li key={`${e.date}-${i}`} className={late ? 'late' : e.daysLeft <= 14 ? 'soon' : ''}>
                <span className="hm-when">
                  <strong>{when}</strong>
                  <span className="muted small">{niceDate(e.date)}</span>
                </span>
                <span className="hm-what">
                  <MaybeLink href={homeLink(e.href, sample)}>{e.title}</MaybeLink>
                  <span className="muted small">
                    {KIND_WORD[e.kind] ?? 'Other'}
                    {e.amount ? ` · ${formatInrCompact(e.amount)}` : ''}
                    {late ? ' · overdue' : ''}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
