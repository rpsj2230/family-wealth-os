'use client';

import { useActionState } from 'react';
import { REQUEST_PAGES, type RequestRegistrar } from '@fwos/ingest';
import {
  addStatementPassword,
  cancelRequest,
  clearStatementPasswords,
  markRequested,
  requestScan,
  setGmailEnabled,
  type GmailResult,
} from './gmail-actions';

/** The saved-state sentence under a button: polite when it worked, assertive when it did not. */
function Result({ r, pending }: { r: GmailResult | null; pending: boolean }) {
  if (pending) return <p className="muted small gm-result">Working…</p>;
  if (!r) return null;
  return (
    <p className={`small gm-result ${r.ok ? 'ok' : 'fail'}`} role={r.ok ? 'status' : 'alert'}>
      {r.message}
    </p>
  );
}

/** Scan now: leaves a request for the job and says when it will be read. */
export function ScanNow({ disabled }: { disabled: boolean }) {
  const [res, act, pending] = useActionState(requestScan, null);
  return (
    <form action={act} className="gm-inline">
      <button className="btn primary" disabled={disabled || pending}>
        {pending ? 'Asking…' : 'Scan now'}
      </button>
      <Result r={res} pending={false} />
    </form>
  );
}

/** Switch off / Switch on: the first tick of Settings > Gmail statements. */
export function SwitchButton({ enabled, disabled }: { enabled: boolean; disabled?: boolean }) {
  const [res, act, pending] = useActionState(setGmailEnabled, null);
  return (
    <form action={act} className="gm-inline">
      <input type="hidden" name="enabled" value={enabled ? '0' : '1'} />
      <button className="btn" disabled={disabled || pending}>
        {enabled ? 'Switch off' : 'Switch on'}
      </button>
      <Result r={res} pending={false} />
    </form>
  );
}

/**
 * The guided request: choose the person, open the registrar’s own page in a new tab (the app never submits anything there), then
 * press “I have asked” so the app can say when the statement arrives.
 */
export function RequestStatement({
  people,
  disabled,
}: {
  people: { id: string; name: string }[];
  disabled: boolean;
}) {
  const [res, act, pending] = useActionState(markRequested, null);
  const ways: RequestRegistrar[] = ['cams', 'kfintech', 'mfcentral'];
  return (
    <form action={act} className="gm-request" aria-busy={pending}>
      <label className="gm-pick">
        Whose statement
        <select name="owner" defaultValue={people[0]?.id ?? ''} disabled={disabled}>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <ul className="gm-ways">
        {ways.map((w) => (
          <li key={w}>
            <a
              className="btn"
              href={REQUEST_PAGES[w].url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open the ${REQUEST_PAGES[w].name} request page (opens in a new tab)`}
            >
              Open {REQUEST_PAGES[w].name} ↗
            </a>
            <button
              className="btn ghost"
              name="registrar"
              value={w}
              disabled={disabled || pending || people.length === 0}
            >
              I have asked {REQUEST_PAGES[w].name}
            </button>
          </li>
        ))}
      </ul>
      <Result r={res} pending={pending} />
    </form>
  );
}

export function CancelRequest({ id }: { id: string }) {
  const [res, act, pending] = useActionState(cancelRequest, null);
  return (
    <form action={act} className="gm-inline">
      <input type="hidden" name="id" value={id} />
      <button className="btn ghost compact" disabled={pending}>
        Remove
      </button>
      <Result r={res} pending={false} />
    </form>
  );
}

/**
 * “I used a different password”: write-only. The box is cleared after saving, the saved ones are never shown, only how many there
 * are; Remove deletes all of a person’s.
 */
export function StatementPasswords({
  people,
  disabled,
}: {
  people: { id: string; name: string; passwords: number }[];
  disabled: boolean;
}) {
  const [res, act, pending] = useActionState(addStatementPassword, null);
  const [clearRes, clearAct, clearing] = useActionState(clearStatementPasswords, null);
  return (
    <div className="gm-pw">
      <form action={act} aria-busy={pending}>
        <div className="gm-pwrow">
          <label className="gm-pick">
            For
            <select name="owner" defaultValue={people[0]?.id ?? ''} disabled={disabled}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="gm-pick grow">
            The password you chose for that statement
            <input
              type="password"
              name="statementPassword"
              autoComplete="off"
              maxLength={64}
              spellCheck={false}
              disabled={disabled}
              required
            />
          </label>
          <button className="btn" disabled={disabled || pending}>
            {pending ? 'Saving…' : 'Save password'}
          </button>
        </div>
        <Result r={res} pending={false} />
      </form>
      <ul className="gm-saved small">
        {people.map((p) => (
          <li key={p.id}>
            <span>
              {p.name}: {p.passwords === 0 ? 'none saved' : `${p.passwords} saved`}
            </span>
            {p.passwords > 0 && (
              <form action={clearAct}>
                <input type="hidden" name="owner" value={p.id} />
                <button className="btn ghost compact" disabled={disabled || clearing}>
                  Remove
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <Result r={clearRes} pending={false} />
    </div>
  );
}
