import Link from 'next/link';
import {
  explainEntry,
  longDate,
  queueOf,
  skipGroup,
  type AccountChoice,
  type AutomationCard,
  type InboxEntry,
  type SkipGroup,
} from '@fwos/core';
import { AutomationCards } from '@/components/AutomationCards';
import { ListingTools } from '@/components/ListingTools';
import { Tabs } from '@/components/Tabs';
import { EntryTools } from './EntryTools';
import { ReviewCard, RestoreButton } from './Parts';
import '@/components/datain.css';

export const INBOX_TABS = ['review', 'recorded', 'skipped', 'automation'] as const;
export type InboxTab = (typeof INBOX_TABS)[number];

const SKIP_LABEL: Record<SkipGroup | 'all', string> = {
  all: 'All skipped',
  notbalance: 'Not a balance email',
  older: 'Older than what you have',
  dismissed: 'Ignored by you',
  problem: 'Reader problems',
};

/** The inbox as a review queue: what waits for you, what was recorded, what was set aside and why, and how the reader is doing. */
export function InboxBoard({
  base,
  tab,
  filter,
  entries,
  accounts,
  automation,
  label,
  aiKeySet,
  demo = false,
}: {
  base: string;
  tab: InboxTab;
  filter: SkipGroup | 'all';
  entries: InboxEntry[];
  accounts: AccountChoice[];
  automation: AutomationCard[];
  label: string;
  aiKeySet: boolean;
  demo?: boolean;
}) {
  const review = entries.filter((m) => queueOf(m) === 'review');
  const recorded = entries.filter((m) => queueOf(m) === 'recorded');
  const skipped = entries.filter((m) => skipGroup(m) !== null);
  const counts: Record<SkipGroup | 'all', number> = {
    all: skipped.length,
    notbalance: 0,
    older: 0,
    dismissed: 0,
    problem: 0,
  };
  for (const m of skipped) counts[skipGroup(m)!]++;
  const shownSkipped = filter === 'all' ? skipped : skipped.filter((m) => skipGroup(m) === filter);

  return (
    <>
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'review', label: 'Needs your review', badge: review.length },
          { key: 'recorded', label: 'Recorded' },
          { key: 'skipped', label: 'Skipped', badge: counts.problem || null },
          { key: 'automation', label: 'Automation' },
        ]}
      />

      {tab === 'review' && (
        <section aria-label="Needs your review">
          {review.length === 0 ? (
            <div className="empty card">
              <p>
                <strong>Nothing is waiting for you.</strong>
              </p>
              <p className="small">
                Balance alerts that come from your bank’s own address and match one account are
                recorded by themselves. Anything uncertain appears here with the reason.
              </p>
              <p>
                <Link className="btn" href={demo ? '/demo/monthly' : '/monthly'}>
                  Go to the Monthly update
                </Link>
              </p>
            </div>
          ) : (
            <>
              <p className="muted small">
                Each message below could not be recorded safely by itself. Apply it to an account,
                or ignore it. Applying counts as this month’s value for that account.
              </p>
              {review.map((m) => (
                <ReviewCard key={m.id} entry={m} accounts={accounts} demo={demo} />
              ))}
            </>
          )}
        </section>
      )}

      {tab === 'recorded' && (
        <section aria-label="Recorded">
          <p className="muted small">
            Balances and statements that were taken in, by the reader or by you.
          </p>
          <MessageList
            entries={recorded}
            demo={demo}
            empty="Nothing has been recorded from email yet."
          />
        </section>
      )}

      {tab === 'skipped' && (
        <section aria-label="Skipped">
          <p className="muted small">
            Nothing was recorded from these. Each line says why, so you can tell a harmless skip
            from something to fix.
          </p>
          <nav className="outcomebar" aria-label="Filter by reason">
            {(Object.keys(SKIP_LABEL) as (SkipGroup | 'all')[]).map((k) => (
              <Link
                key={k}
                href={`${base}?tab=skipped${k === 'all' ? '' : `&f=${k}`}`}
                className={`fchip ${filter === k ? 'on' : ''}`}
                aria-current={filter === k ? 'true' : undefined}
                scroll={false}
              >
                {SKIP_LABEL[k]} <span className="muted small">{counts[k]}</span>
              </Link>
            ))}
          </nav>
          <MessageList entries={shownSkipped} demo={demo} empty="Nothing here." />
        </section>
      )}

      {tab === 'automation' && (
        <section aria-label="Automation">
          <AutomationCards cards={automation} />
          <div className="card">
            <h2>How emails get in</h2>
            <ol className="howto small">
              <li>
                In Gmail, make a filter for your banks’ alert addresses (and the fund registrars)
                that applies the label <strong>{label}</strong>.
              </li>
              <li>
                The reader opens that label every 3 hours. A balance from the bank’s own address
                that matches exactly one account is recorded at once.
              </li>
              <li>
                Anything else waits under <Link href={`${base}?tab=review`}>Needs your review</Link>{' '}
                with the reason.
              </li>
              <li>
                Fund statements (CAS) and Form 26AS or AIS files sent to the same label are imported
                by themselves; see <Link href="/import">Import</Link>.
              </li>
            </ol>
            {!aiKeySet && (
              <p className="small">
                PDF bank statements need an AI key: add a free one in{' '}
                <Link href="/settings#email">Settings, Email and AI</Link>.
              </p>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function MessageList({
  entries,
  demo,
  empty,
}: {
  entries: InboxEntry[];
  demo: boolean;
  empty: string;
}) {
  if (entries.length === 0) return <p className="empty card">{empty}</p>;
  return (
    <ListingTools
      name="inbox"
      listCols={[
        { key: 'date', label: 'Date' },
        { key: 'from', label: 'From' },
        { key: 'outcome', label: 'Result' },
      ]}
    >
      <ul className="list nobullet" style={{ margin: 0 }}>
        {entries.map((m) => {
          const e = explainEntry(m);
          const q = queueOf(m);
          return (
            <li
              key={m.id}
              data-item
              data-f-date={m.receivedOn ?? ''}
              data-f-from={m.fromDomain ?? ''}
              data-f-outcome={e.headline}
              className={`inbox-card ${q}`}
            >
              <h3>{m.subject || '(no subject)'}</h3>
              <p className="muted small meta">
                From {m.fromDomain || 'unknown sender'}
                {m.receivedOn ? ` · ${longDate(m.receivedOn)}` : ''}
              </p>
              <p>
                <strong>{e.headline}</strong>
              </p>
              <p className="why small">{e.why}</p>
              {q === 'dismissed' && <RestoreButton id={m.id} demo={demo} />}
              {q === 'problem' && <p className="next small">{e.next}</p>}
              <EntryTools entry={m} demo={demo} />
            </li>
          );
        })}
      </ul>
    </ListingTools>
  );
}
