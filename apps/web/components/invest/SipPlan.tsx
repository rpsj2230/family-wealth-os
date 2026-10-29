'use client';

import { useState, useTransition } from 'react';
import { formatInr } from '@fwos/core';
import {
  removeSipChange,
  scheduleSip,
  setSipAccount,
  type FundActionResult,
} from '@/app/(app)/investments/fund-actions';
import { typed } from '@/lib/fund-edit';
import { niceDate } from '@/lib/dates';
import type { SipPlanView } from '@/lib/sip-plan';

type Mode = 'change' | 'stop' | 'pause';

const SAMPLE: FundActionResult = { ok: true, message: 'This is a sample: nothing is saved.' };
const rupees = (n: number) => formatInr(Math.round(n));

/**
 * The SIP's plan, by date: what it pays now, every change with the day it applies from (past, in force or planned), a form to change,
 * stop or pause it from any date (a pause starts again by itself on its date), and the savings account it is paid from.
 */
export function SipPlan({
  view,
  today,
  demo = false,
}: {
  view: SipPlanView;
  today: string;
  demo?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('change');
  const [from, setFrom] = useState(today);
  const [amount, setAmount] = useState(view.lastAmount ? String(view.lastAmount) : '');
  const [resume, setResume] = useState('');
  const [account, setAccount] = useState(view.payFrom ?? '');
  const [result, setResult] = useState<FundActionResult | null>(null);
  const [pending, run] = useTransition();

  const amt = typed(amount);
  const problems: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) problems.push('the date it applies from');
  if (view.startedOn && from < view.startedOn)
    problems.push(`a date on or after the SIP started (${niceDate(view.startedOn)})`);
  if (mode === 'change' && (amt === null || Number.isNaN(amt) || amt <= 0))
    problems.push('the new amount');
  if (mode === 'pause' && (!/^\d{4}-\d{2}-\d{2}$/.test(resume) || resume <= from))
    problems.push('a restart date after the pause begins');

  const go = (fn: () => Promise<FundActionResult>) =>
    run(async () => setResult(demo ? SAMPLE : await fn()));

  const save = () =>
    go(() =>
      scheduleSip({
        assetId: view.assetId,
        from,
        monthly: mode === 'change' ? (amt as number) : 0,
        resumeOn: mode === 'pause' ? resume : null,
      }),
    );

  const word = (m: number) => (m > 0 ? `${rupees(m)} a month` : 'Stopped');

  return (
    <section className="detailsection sipplan" aria-labelledby="sip-h" data-testid="sip-plan">
      <h2 id="sip-h">SIP plan</h2>
      <p className="sipplan-now" data-testid="sip-now">
        <strong>{view.now > 0 ? `${rupees(view.now)} a month` : 'Not running'}</strong>
        {view.now === 0 && view.lastAmount ? (
          <span className="muted"> (was {rupees(view.lastAmount)} a month)</span>
        ) : null}
        {view.next ? (
          <span className="muted">
            {' '}
            · from {niceDate(view.next.on)}:{' '}
            {view.next.monthly > 0 ? `${rupees(view.next.monthly)} a month` : 'stopped'}
          </span>
        ) : null}
      </p>
      <p className="muted small">
        Each instalment is added on its date until a fund statement shows the real one. Changes
        apply from the date you give; past instalments keep their amount.
      </p>

      {view.rows.length > 0 && (
        <div className="tablewrap">
          <table className="tbl lines small" data-testid="sip-changes">
            <thead>
              <tr>
                <th>From</th>
                <th className="num">Each month</th>
                <th>When</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r) => (
                <tr key={r.on} className={r.when === 'now' ? 'sipplan-current' : undefined}>
                  <td>{niceDate(r.on)}</td>
                  <td className="num">{word(r.monthly)}</td>
                  <td className="muted">
                    {r.when === 'now'
                      ? 'in force now'
                      : r.when === 'planned'
                        ? 'planned'
                        : 'earlier'}
                  </td>
                  <td>
                    {r.removable && (
                      <button
                        type="button"
                        className="btn compact ghost"
                        disabled={pending}
                        onClick={() => {
                          if (window.confirm(`Take back the change of ${niceDate(r.on)}?`))
                            go(() => removeSipChange(view.assetId, r.on));
                        }}
                      >
                        Take back
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="sipplan-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (problems.length === 0 && !pending) save();
        }}
      >
        <fieldset className="sipplan-modes">
          <legend>Change the SIP</legend>
          {(
            [
              ['change', 'Change the amount'],
              ['stop', 'Stop it'],
              ['pause', 'Pause it'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="check">
              <input
                type="radio"
                name="sip-mode"
                checked={mode === k}
                onChange={() => {
                  setResult(null);
                  setMode(k);
                }}
              />{' '}
              {label}
            </label>
          ))}
        </fieldset>
        <div className="sipplan-fields">
          <label>
            {mode === 'pause' ? 'Paused from' : 'Applies from'}
            <input
              type="date"
              value={from}
              {...(view.startedOn ? { min: view.startedOn } : {})}
              onChange={(e) => {
                setResult(null);
                setFrom(e.target.value);
              }}
            />
          </label>
          {mode === 'change' && (
            <label>
              New amount a month (₹)
              <input
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setResult(null);
                  setAmount(e.target.value);
                }}
              />
            </label>
          )}
          {mode === 'pause' && (
            <label>
              Starts again on
              <input
                type="date"
                value={resume}
                min={from}
                onChange={(e) => {
                  setResult(null);
                  setResume(e.target.value);
                }}
              />
            </label>
          )}
          <button className="btn primary" disabled={pending || problems.length > 0}>
            {pending ? 'Saving…' : 'Save the change'}
          </button>
        </div>
        {problems.length > 0 && (from || amount || resume) && (
          <p className="muted small">Still needed: {problems.join(', ')}.</p>
        )}
        {mode === 'pause' && (
          <p className="muted small">
            It starts again by itself on that date, at the amount it had before the pause.
          </p>
        )}
      </form>

      <div className="sipplan-pay">
        <label>
          Paid from
          <select
            value={account}
            onChange={(e) => {
              setResult(null);
              setAccount(e.target.value);
            }}
            data-testid="sip-pay-from"
          >
            <option value="">Not linked to an account</option>
            {view.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn"
          disabled={pending || account === (view.payFrom ?? '')}
          onClick={() => go(() => setSipAccount(view.assetId, account || null))}
        >
          Save account
        </button>
        <p className="muted small">
          With an account linked, each instalment comes out of that account’s estimated balance on
          its date, so the money is not counted twice before you next update the balance.
        </p>
      </div>

      {result && (
        <p role="status" className={result.ok ? 'ok' : 'fail'} data-testid="sip-result">
          {result.message}
        </p>
      )}
    </section>
  );
}
