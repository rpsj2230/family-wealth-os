'use client';

import { useState, useTransition } from 'react';
import type { PersonStyle } from '@fwos/core';
import type { AddItemInput } from '@/app/(app)/monthly/actions';
import { addProblems, emptyAdd, type AddDraft } from '@/lib/quick-edit';
import { Sheet } from './Sheet';

export interface AddResult {
  ok: boolean;
  message: string;
}
export type AddFn = (input: AddItemInput) => Promise<AddResult>;

/** "Add an account or a deposit": the bank and person first, then only what that kind of line needs; the rare fields wait behind "More details". */
export function AddAccountSheet({
  preset,
  owners,
  institutions,
  styles,
  addItem,
  onClose,
}: {
  preset: Partial<AddDraft>;
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  /** without it the form is a sample and says nothing is saved */
  addItem?: AddFn;
  onClose: () => void;
}) {
  const [d, setDraft] = useState<AddDraft>(() =>
    emptyAdd({
      ownerId: preset.ownerId ?? (owners.length === 1 ? owners[0]!.id : ''),
      institutionId: preset.institutionId ?? '',
    }),
  );
  const [result, setResult] = useState<AddResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const problems = addProblems(d);
  const touched =
    d.principal !== '' ||
    d.ratePct !== '' ||
    d.bookedOn !== '' ||
    d.maturityOn !== '' ||
    d.last4 !== '';
  const set = (patch: Partial<AddDraft>) => {
    setResult(null);
    setDraft((x) => ({ ...x, ...patch }));
  };
  const requestClose = () => (touched && !result?.ok ? setAsking(true) : onClose());
  const fd = d.type === 'fixed_deposit';
  const input = (
    k: keyof AddDraft,
    label: string,
    p: {
      type?: string;
      placeholder?: string;
      inputMode?: 'numeric' | 'decimal';
      maxLength?: number;
    } = {},
  ) => (
    <label className="qe-f">
      <span>{label}</span>
      <input
        value={String(d[k] ?? '')}
        onChange={(e) => set({ [k]: e.target.value } as Partial<AddDraft>)}
        type={p.type ?? 'text'}
        inputMode={p.inputMode}
        placeholder={p.placeholder}
        maxLength={p.maxLength}
        autoComplete="off"
      />
    </label>
  );
  const submit = () =>
    start(async () => {
      if (!addItem) {
        setResult({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      setResult(await addItem({ ...d }));
    });
  return (
    <Sheet labelId="qa-title" onRequestClose={requestClose} onClose={onClose}>
      <form
        className="qe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (problems.length === 0 && !pending) submit();
        }}
      >
        <header className="qe-head">
          <div>
            <p className="qe-kicker">New</p>
            <h2 id="qa-title">Add an account or a deposit</h2>
            <p className="muted small">It is placed where it belongs in your bank order.</p>
          </div>
          <button type="button" className="qe-x" onClick={requestClose} aria-label="Close">
            <span aria-hidden>×</span>
          </button>
        </header>
        <div className="qe-body">
          <div className="qe-seg" role="group" aria-label="What are you adding">
            <button
              type="button"
              className={fd ? 'on' : ''}
              aria-pressed={fd}
              onClick={() => set({ type: 'fixed_deposit' })}
            >
              Fixed deposit
            </button>
            <button
              type="button"
              className={!fd ? 'on' : ''}
              aria-pressed={!fd}
              onClick={() => set({ type: 'bank_account' })}
            >
              Savings account
            </button>
          </div>
          <div className="qe-grid">
            <label className="qe-f">
              <span>Bank</span>
              <select
                value={d.institutionId}
                onChange={(e) => set({ institutionId: e.target.value })}
              >
                <option value="">Choose…</option>
                {institutions.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qe-f">
              <span>Whose</span>
              <select value={d.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                <option value="">Choose…</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {styles[o.id]?.name ?? o.name}
                  </option>
                ))}
              </select>
            </label>
            {fd && (
              <>
                {input('principal', 'Amount invested', { inputMode: 'numeric' })}
                {input('ratePct', 'Interest rate (% a year)', {
                  inputMode: 'decimal',
                  placeholder: '7.25',
                })}
                {input('bookedOn', 'Started on', { type: 'date' })}
                {input('maturityOn', 'Matures on', { type: 'date' })}
              </>
            )}
            <label className="qe-f">
              <span>Type</span>
              <select
                value={d.accountKind}
                onChange={(e) => set({ accountKind: e.target.value as AddDraft['accountKind'] })}
              >
                <option value="NRE">NRE (external)</option>
                <option value="NRO">NRO (ordinary)</option>
                <option value="">Not stated</option>
              </select>
            </label>
            {input('last4', fd ? 'Linked savings account (last four)' : 'Last four digits', {
              placeholder: '0266',
              maxLength: 4,
            })}
          </div>
          <details className="qe-more">
            <summary>More details</summary>
            <div className="qe-grid">
              {fd &&
                input('maturityAmount', 'Amount at maturity', {
                  inputMode: 'numeric',
                  placeholder: 'worked out',
                })}
              {fd &&
                input('refLast4', 'Deposit number', {
                  placeholder: '300017790142-1',
                  maxLength: 40,
                })}
              <label className="check qe-wide">
                <input
                  type="checkbox"
                  checked={d.isJoint}
                  onChange={(e) => set({ isJoint: e.target.checked })}
                />{' '}
                Joint account
              </label>
              <label className="qe-f qe-wide">
                <span>Note</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={d.notes}
                  onChange={(e) => set({ notes: e.target.value })}
                />
              </label>
            </div>
          </details>
          {problems.length > 0 && touched && (
            <ul className="qe-problems" role="alert">
              {problems.map((p) => (
                <li key={p}>Please {p}.</li>
              ))}
            </ul>
          )}
        </div>
        <footer className="qe-foot">
          {asking ? (
            <div className="qe-ask" role="alertdialog" aria-label="Unsaved details">
              <span>What you typed has not been added.</span>
              <button type="button" className="btn compact" onClick={() => setAsking(false)}>
                Keep editing
              </button>
              <button type="button" className="btn compact" onClick={onClose}>
                Close without adding
              </button>
            </div>
          ) : (
            <>
              <span
                className={`qe-msg ${result ? (result.ok ? 'ok' : 'fail') : 'muted'}`}
                role={result && !result.ok ? 'alert' : 'status'}
                aria-live="polite"
              >
                {result ? (result.ok ? `✓ ${result.message}` : result.message) : ''}
              </span>
              <button type="button" className="btn" onClick={requestClose}>
                {result?.ok ? 'Done' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || problems.length > 0 || !!result?.ok}
              >
                {pending ? 'Adding…' : fd ? 'Add the deposit' : 'Add the account'}
              </button>
            </>
          )}
        </footer>
      </form>
    </Sheet>
  );
}
