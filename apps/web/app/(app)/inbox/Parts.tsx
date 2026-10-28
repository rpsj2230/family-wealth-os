'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  explainEntry,
  inboxProposal,
  longDate,
  rankAccounts,
  certainAccount,
  type AccountChoice,
  type InboxEntry,
} from '@fwos/core';
import { applyReading, dismissMessage, restoreMessage, type InboxResult } from './actions';
import { EntryTools } from './EntryTools';
import '@/components/datain.css';

const demoNote: InboxResult = {
  ok: false,
  message: 'This is a sample with invented messages. Sign in to apply or ignore real ones.',
};

/** One message that waits for you, with what was found, why it waits, what happens next and one-click apply or ignore. */
export function ReviewCard({
  entry,
  accounts,
  demo = false,
}: {
  entry: InboxEntry;
  accounts: AccountChoice[];
  demo?: boolean;
}) {
  const [applied, applyAction, applying] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : applyReading,
    null,
  );
  const [dismissed, dismissAction, dismissing] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : dismissMessage,
    null,
  );
  const [restored, restoreAction, restoring] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : restoreMessage,
    null,
  );
  const e = explainEntry(entry);
  const r = entry.reading;
  const ranked = r ? rankAccounts(r, entry.assetId, accounts) : [];
  const sure = r ? certainAccount(r, entry.assetId, accounts) : null;
  const prop = inboxProposal(entry, accounts);
  const suggestedId = prop?.accountId ?? sure?.id ?? '';
  const busy = applying || dismissing || restoring;

  if (applied?.ok)
    return (
      <article className="inbox-card recorded" aria-live="polite">
        <h3>{entry.subject || '(no subject)'}</h3>
        <p role="status" className="ok">
          {applied.message}
        </p>
        <p className="small">
          <Link href="/monthly">See it in the Monthly update</Link>
        </p>
      </article>
    );
  if (dismissed?.ok && !restored?.ok)
    return (
      <article className="inbox-card" aria-live="polite">
        <h3>{entry.subject || '(no subject)'}</h3>
        <p role="status" className="muted">
          {dismissed.message}
        </p>
        <form action={restoreAction}>
          <input type="hidden" name="id" value={entry.id} />
          <button className="btn compact" disabled={busy}>
            Undo
          </button>
        </form>
      </article>
    );

  const note = [applied, dismissed, restored].find((x) => x && !x.ok);
  return (
    <article className="inbox-card review">
      <h3>{entry.subject || '(no subject)'}</h3>
      <p className="muted small meta">
        From {entry.fromDomain || 'unknown sender'}
        {entry.receivedOn ? ` · received ${longDate(entry.receivedOn)}` : ''}
      </p>
      <p>
        <strong>{e.headline}</strong>
      </p>
      <p className="why small">{e.why}</p>
      {prop ? (
        <div
          className="inbox-ask"
          role="group"
          aria-label={`Suggestion for ${entry.subject || 'this message'}`}
        >
          <p className="small">
            <span className="ask-lead">What I suggest</span> {prop.proposal.suggest}{' '}
            <span className="muted">{prop.proposal.why}</span>
          </p>
          {prop.accountId && prop.proposal.approve && (
            <form action={applyAction} className="inbox-actions">
              <input type="hidden" name="id" value={entry.id} />
              <input type="hidden" name="asset" value={prop.accountId} />
              <input type="hidden" name="amount" value={r?.amount ?? ''} />
              <button className="btn primary inbox-approve" disabled={busy}>
                {applying ? 'Recording…' : prop.proposal.approve}
              </button>
            </form>
          )}
          <p className="muted small">
            {prop.accountId
              ? 'Or choose another account, correct the amount, or ignore it:'
              : 'Choose the account below (and correct the amount if it is wrong), or ignore it:'}
          </p>
        </div>
      ) : (
        <p className="next small">{e.next}</p>
      )}
      <form action={applyAction} className="inbox-actions">
        <input type="hidden" name="id" value={entry.id} />
        {r && (
          <>
            <select
              name="asset"
              aria-label={`Record the balance of ${entry.subject || 'this message'} on`}
              defaultValue={suggestedId}
              required
            >
              <option value="" disabled>
                Choose the account…
              </option>
              {ranked.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <input
              name="amount"
              inputMode="decimal"
              defaultValue={r.amount}
              aria-label="Balance read from this message (change it if it is wrong)"
              className="numinput"
              style={{ width: '9.5rem', textAlign: 'right' }}
            />
            <button className={`btn${suggestedId ? '' : ' primary'}`} disabled={busy}>
              {applying ? 'Recording…' : suggestedId ? 'Apply to the chosen account' : 'Apply'}
            </button>
          </>
        )}
        {!r && (
          <>
            <select
              name="asset"
              aria-label={`Account of ${entry.subject || 'this message'}`}
              defaultValue=""
              required
            >
              <option value="" disabled>
                Choose the account…
              </option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            <input
              name="amount"
              inputMode="decimal"
              placeholder="Balance"
              required
              aria-label="Balance in this email (type it in)"
              className="numinput"
              style={{ width: '9.5rem', textAlign: 'right' }}
            />
            <input
              type="date"
              name="on"
              defaultValue={entry.receivedOn ?? ''}
              max={new Date().toISOString().slice(0, 10)}
              required
              aria-label="Date of the balance"
            />
            <button className="btn primary" disabled={busy}>
              {applying ? 'Recording…' : 'Record this balance'}
            </button>
          </>
        )}
        <button className="btn ghost" formAction={dismissAction} formNoValidate disabled={busy}>
          Ignore
        </button>
      </form>
      <EntryTools entry={entry} demo={demo} />
      {r && ranked.length === 0 && (
        <p className="small fail">
          You have no account in {r.currency}. Add one in the Monthly update first.
        </p>
      )}
      {note && (
        <p className="small fail" role="alert">
          {note.message}
        </p>
      )}
    </article>
  );
}

/** Puts an ignored message back in the review queue. */
export function RestoreButton({ id, demo = false }: { id: string; demo?: boolean }) {
  const [res, act, pending] = useActionState<InboxResult | null, FormData>(
    demo ? async () => demoNote : restoreMessage,
    null,
  );
  return (
    <form action={act} className="inbox-actions">
      <input type="hidden" name="id" value={id} />
      <button className="btn compact" disabled={pending || res?.ok === true}>
        Put back in the queue
      </button>
      {res && (
        <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
          {res.message}
        </span>
      )}
    </form>
  );
}
