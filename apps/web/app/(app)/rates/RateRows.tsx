'use client';

import { useActionState, useState } from 'react';
import { RATE_REASONS } from '@fwos/core';
import './rates.css';

export interface RateRowModel {
  id: string;
  /** "NRE deposit, 2 yr" or "Savings, ₹1 L to ₹5 L" */
  what: string;
  /** rate in percent, as typed: 7.25 */
  pct: number;
  sourceKind: 'manual' | 'ai';
  /** "Read from janabank.com" or "Pasted notes" */
  note: string;
  url: string | null;
  /** "checked 5 days ago (21 Oct 2026)" */
  checked: string;
  stale: boolean;
  conditions: string | null;
  /** what the reader had read before you corrected it, in percent */
  readPct: number | null;
  readReason: string | null;
  /** what the bank page says now when it differs, in percent */
  pagePct: number | null;
  pageSeen: string | null;
  misread: number;
}

export interface RateRowActions {
  save: (
    prev: { ok: boolean; message: string } | null,
    f: FormData,
  ) => Promise<{ ok: boolean; message: string }>;
  accept: (f: FormData) => Promise<void>;
  remove: (f: FormData) => Promise<void>;
}

const sampleSave = async () => ({
  ok: true,
  message: 'This is a sample page: nothing is saved.',
});

const fmt = (n: number) => String(+n.toFixed(2));
const parse = (s: string) => {
  const n = Number(s.replace(/[%\s,]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : NaN;
};

function Row({ m, actions }: { m: RateRowModel; actions?: RateRowActions | undefined }) {
  const [value, setValue] = useState(fmt(m.pct));
  const [res, act, pending] = useActionState(actions?.save ?? sampleSave, null);
  const n = parse(value);
  const valid = Number.isFinite(n) && n >= 0.5 && n <= 20;
  const changed = Number.isFinite(n) && Math.abs(n - m.pct) > 0.004;
  // a figure the bank page gave: say why you are changing it, so the next refresh can learn
  const asks = changed && m.sourceKind === 'ai';
  const inputId = `rate-${m.id}`;
  return (
    <li>
      <form action={act} className="rt-row" aria-busy={pending}>
        <input type="hidden" name="id" value={m.id} />
        <div className="rt-what">
          <b>{m.what}</b>{' '}
          <span className={`srcchip ${m.sourceKind === 'ai' ? 'auto' : 'manual'}`}>
            {m.sourceKind === 'ai' ? 'Bank page' : 'You'}
          </span>
          <div className="rt-meta">
            {m.url ? (
              <a href={m.url} target="_blank" rel="noreferrer">
                {m.note}
              </a>
            ) : (
              m.note
            )}{' '}
            · <span className={m.stale ? 'warnText' : ''}>{m.checked}</span>
            {m.conditions ? ` · ${m.conditions}` : ''}
          </div>
        </div>
        <div className="rt-edit">
          <label className="rt-input" htmlFor={inputId}>
            <span className="sr-only">Rate in percent for {m.what}</span>
            <input
              id={inputId}
              name="rate"
              inputMode="decimal"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={!valid}
              autoComplete="off"
            />
            <span aria-hidden="true">%</span>
          </label>
          <button className="btn compact primary" disabled={!changed || !valid || pending}>
            {pending ? 'Saving…' : 'Save'}
          </button>
          {actions && (
            <button
              className="btn compact ghost"
              formAction={actions.remove}
              formNoValidate
              aria-label={`Remove the ${m.what} rate`}
              onClick={(e) => {
                if (!window.confirm(`Remove this rate (${m.what})?`)) e.preventDefault();
              }}
            >
              Remove
            </button>
          )}
        </div>

        {asks && (
          <div className="rt-reason rt-wide">
            <label htmlFor={`why-${m.id}`}>
              <b>Why is the page&apos;s figure wrong?</b> Optional, but it lets the next refresh
              learn and read this one correctly.
            </label>
            <select id={`why-${m.id}`} name="reason" defaultValue="">
              <option value="">Not sure: let the refresh work it out</option>
              {RATE_REASONS.filter((r) => r.key !== 'other').map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
            <span className="muted small">
              Your figure is kept. At the next refresh the page is checked again: when it shows your
              figure, the page owns this rate again.
            </span>
          </div>
        )}

        {m.readPct !== null && (
          <p className="rt-meta rt-wide" style={{ margin: 0 }}>
            You corrected this from {fmt(m.readPct)}%
            {m.readReason ? ` (${m.readReason.toLowerCase()})` : ''}.
            {m.misread > 0
              ? ` The refresh has read the old figure again ${m.misread} time${m.misread === 1 ? '' : 's'}; a rule is saved so it stops.`
              : ' The next refresh checks the page against your figure.'}
          </p>
        )}

        {m.pagePct !== null && (
          <div className="rt-pagesays rt-wide" role="status">
            <span>
              The bank page says <b>{fmt(m.pagePct)}%</b>
              {m.pageSeen ? ` (seen ${m.pageSeen})` : ''}; you have {fmt(m.pct)}%.
            </span>
            {actions && (
              <button className="btn compact" formAction={actions.accept} formNoValidate>
                Use the page&apos;s {fmt(m.pagePct)}%
              </button>
            )}
          </div>
        )}

        {res && (
          <p
            className={`${res.ok ? 'ok' : 'fail'} small rt-wide`}
            style={{ margin: 0 }}
            role={res.ok ? 'status' : 'alert'}
          >
            {res.message}
          </p>
        )}
      </form>
    </li>
  );
}

/** A bank's rates as a list of rows: change the figure, press Save. A figure the bank page gave asks why you changed it. */
export function RateRows({
  rows,
  actions,
}: {
  rows: RateRowModel[];
  /** absent on the public sample, where nothing is stored */
  actions?: RateRowActions | undefined;
}) {
  return (
    <ul className="rt-rows">
      {rows.map((m) => (
        <Row key={`${m.id}:${m.pct}:${m.checked}`} m={m} actions={actions} />
      ))}
    </ul>
  );
}
