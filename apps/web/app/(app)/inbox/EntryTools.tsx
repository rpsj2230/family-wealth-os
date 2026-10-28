'use client';

import { useActionState } from 'react';
import { canReadAgain, longDate, markAmount, queueOf, type InboxEntry } from '@fwos/core';
import { readAgain, saveNumber, type InboxResult } from './actions';
import './inbox.css';

const demoNote: InboxResult = {
  ok: false,
  message: 'This is a sample with invented messages. Sign in to read or correct real ones.',
};

/** The kept copy of the email, with the number that was read marked like a highlighter, so it can be checked at a glance. */
export function EmailCopy({
  entry,
  amount,
}: {
  entry: InboxEntry;
  /** the number to mark; null marks nothing */
  amount: number | null;
}) {
  if (!entry.bodyText)
    return (
      <p className="small muted">
        This email was logged before the app kept a copy of its text. Press Read again and it will
        be fetched from Gmail at the next mailbox run.
      </p>
    );
  return (
    <figure className="mailcopy" aria-label="The email as received">
      <figcaption>
        <span>
          <b>From</b> {entry.fromDomain || 'unknown sender'}
        </span>
        <span>
          <b>Subject</b> {entry.subject || '(no subject)'}
        </span>
        {entry.receivedOn && (
          <span>
            <b>Received</b> {longDate(entry.receivedOn)}
          </span>
        )}
      </figcaption>
      <pre className="mailbody">
        {markAmount(entry.bodyText, amount).map((p, i) =>
          p.hit ? (
            <mark key={i} data-testid="read-number">
              {p.text}
            </mark>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </pre>
    </figure>
  );
}

/**
 * Under every message: Read again (just this email, by its bank's format or else the AI; the number is recorded at once), the email itself with the
 * number marked, and a box to correct the number if the reading is wrong.
 */
export function EntryTools({ entry, demo = false }: { entry: InboxEntry; demo?: boolean }) {
  const [read, readAction, reading] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : readAgain,
    null,
  );
  const [saved, saveAction, saving] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : saveNumber,
    null,
  );
  const wasRecorded = queueOf(entry) === 'recorded' && !!entry.reading;
  const nowRecorded = saved?.recorded || read?.recorded || wasRecorded;
  const amount = saved?.amount ?? read?.amount ?? entry.reading?.amount ?? null;
  const showRead = canReadAgain(entry) && !(read?.ok && read.recorded);
  const canEdit = nowRecorded && amount !== null && (entry.assetId || read?.recorded);
  const open = !!(read?.ok && read.amount !== undefined) || !!saved?.ok;

  if (!showRead && !entry.bodyText && !canEdit) return null;
  return (
    <div className="entry-tools">
      {showRead && (
        <form action={readAction} className="inbox-actions">
          <input type="hidden" name="id" value={entry.id} />
          <button className="btn compact" disabled={reading}>
            {reading ? 'Reading…' : 'Read again'}
          </button>
          <span className="muted small">
            Reads only this email again: by its bank’s format, or by the AI when no format fits. The
            number is recorded at once.
          </span>
        </form>
      )}
      {read && (
        <p className={read.ok ? 'small ok-note' : 'small fail'} role={read.ok ? 'status' : 'alert'}>
          {read.message}
        </p>
      )}
      {canEdit && (
        <form action={saveAction} className="inbox-actions numberfix">
          <input type="hidden" name="id" value={entry.id} />
          <label className="small">
            Balance read
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={amount ?? ''}
              key={amount ?? 'none'}
              aria-label="Balance read from this email"
              className="numinput"
            />
          </label>
          <button className="btn compact" disabled={saving}>
            {saving ? 'Saving…' : 'Save number'}
          </button>
          <span className="muted small">
            Wrong? Type the right one; it replaces the recorded one.
          </span>
        </form>
      )}
      {saved && (
        <p
          className={saved.ok ? 'small ok-note' : 'small fail'}
          role={saved.ok ? 'status' : 'alert'}
        >
          {saved.message}
        </p>
      )}
      <details open={open} key={open ? 'o' : 'c'}>
        <summary className="small">Show the email</summary>
        <EmailCopy entry={entry} amount={amount} />
      </details>
    </div>
  );
}
