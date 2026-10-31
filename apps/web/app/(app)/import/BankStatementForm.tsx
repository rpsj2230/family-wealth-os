'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import { formatInr } from '@fwos/core';
import {
  previewStatement,
  saveStatement,
  type StatementState,
} from '@/app/(app)/reconcile/statement-actions';

const idle: StatementState = { stage: 'idle' };
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;

/** The account a file is for, from the last four digits in its name ("Acct Statement_XX1234"), when one matches. */
export function guessAccount(
  name: string,
  accounts: { id: string; last4: string | null }[],
): string {
  const digits = [...name.matchAll(/(\d{4})(?!\d)/g)].map((m) => m[1]);
  return accounts.find((a) => a.last4 && digits.includes(a.last4))?.id ?? '';
}

/**
 * Import > Bank statement: choose the account, add the PDF's password if it has one, see what the file holds and what its lines are,
 * then save. Nothing is saved before Save; the password is used once and never kept.
 */
export function BankStatementForm({
  accounts,
  file,
  defaultAsset,
}: {
  accounts: { id: string; label: string; last4: string | null }[];
  /** the statement file; null to paste rows copied from net banking instead */
  file: File | null;
  /** the account, when the form is opened from it (Monthly update, its own page) */
  defaultAsset?: string;
}) {
  const [asset, setAsset] = useState(
    () => defaultAsset ?? (file ? guessAccount(file.name, accounts) : ''),
  );
  const [password, setPassword] = useState('');
  const [pasted, setPasted] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [preview, previewAct, previewing] = useActionState(previewStatement, idle);
  const [saved, saveAct, saving] = useActionState(saveStatement, idle);
  const busy = previewing || saving;
  const send = (act: (f: FormData) => void) => {
    const fd = new FormData();
    if (file) fd.set('file', file);
    else fd.set('pasted', pasted);
    fd.set('asset', asset);
    fd.set('password', password);
    if (confirm) fd.set('confirmMismatch', 'on');
    startTransition(() => act(fd));
  };
  const isPdf = !!file && /\.pdf$/i.test(file.name);
  const ready = !!asset && (!!file || pasted.trim().length > 0);
  const p = preview.stage === 'previewed' ? preview : null;

  return (
    <div className="form" aria-busy={busy}>
      {file ? (
        <div className="filechip">
          <span className="filechip-name">{file.name}</span>
        </div>
      ) : (
        <label>
          Rows copied from net banking
          <textarea
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Select the rows of the transactions table on the bank’s page (with or without its heading row), copy, and paste here."
            data-testid="bs-paste"
          />
        </label>
      )}
      <div className="formgrid g3">
        <label>
          Which account
          <select value={asset} onChange={(e) => setAsset(e.target.value)} required>
            <option value="" disabled>
              Choose…
            </option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {isPdf && (
          <label>
            PDF password, if it has one (used once, never saved)
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
        )}
      </div>
      <div className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="btn"
          disabled={!ready || busy}
          onClick={() => send(previewAct)}
        >
          {previewing ? 'Reading…' : 'Preview'}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!ready || busy || !p}
          onClick={() => send(saveAct)}
        >
          {saving ? 'Saving…' : file ? 'Save the statement' : 'Save the new rows'}
        </button>
      </div>

      {preview.stage === 'error' && (
        <p className="notice warn" role="alert">
          {preview.message}
        </p>
      )}
      {p && (
        <section className="small" aria-label="What the statement holds" data-testid="bs-preview">
          <p>
            <strong>
              {p.lines} line{p.lines === 1 ? '' : 's'}
            </strong>{' '}
            from {p.from} to {p.to}
            {p.opening !== null && p.opening !== undefined && (
              <>
                , balance {formatInr(p.opening)} before and {formatInr(p.closing ?? 0)} after
              </>
            )}
            .{' '}
            {p.fresh === p.lines
              ? 'All are new.'
              : `${p.fresh} are new; the rest are already saved from another statement.`}
          </p>
          {p.join &&
            (Math.abs(p.join.differs) < 1 ? (
              <p className="notice ok">
                It starts where the account’s lines on file leave off ({formatInr(p.join.onFile)} on{' '}
                {p.join.on}): nothing is missing in between.
              </p>
            ) : (
              <p className="notice warn" data-testid="bs-join">
                The balance before the first row is {signed(p.join.differs)} away from the account’s
                balance on file on {p.join.on} ({formatInr(p.join.onFile)}): about{' '}
                {formatInr(Math.abs(p.join.differs))} went {p.join.differs < 0 ? 'out' : 'in'}{' '}
                between {p.join.on} and {p.from} that is not on file. Paste those rows too, or save
                these and the month’s e-statement fills it in.
              </p>
            ))}
          {p.mismatch && (
            <p className="notice warn">
              The statement is for an account ending {p.mismatch}, which is not the account chosen.
              <label className="rc-choice">
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e) => setConfirm(e.target.checked)}
                />{' '}
                It is the right account
              </label>
            </p>
          )}
          {(p.warnings ?? []).map((w) => (
            <p key={w} className="notice warn">
              {w}
            </p>
          ))}
          {(p.corrected ?? 0) > 0 && (
            <p>
              {p.corrected} recorded balance{p.corrected === 1 ? '' : 's'} on days the statement
              covers differ from it; saving replaces {p.corrected === 1 ? 'it' : 'them'} with the
              bank&apos;s figure (the old one is kept as replaced).
            </p>
          )}
          {(p.classes ?? []).length > 0 && (
            <table className="table">
              <caption className="muted">What the new lines are</caption>
              <thead>
                <tr>
                  <th scope="col">Kind</th>
                  <th scope="col" className="num">
                    Lines
                  </th>
                  <th scope="col" className="num">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {p.classes!.map((c) => (
                  <tr key={c.label}>
                    <td>{c.label}</td>
                    <td className="num">{c.count}</td>
                    <td className="num">{signed(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {saved.stage === 'error' && (
        <p className="notice warn" role="alert">
          {saved.message}
        </p>
      )}
      {saved.stage === 'saved' && saved.saved && (
        <p className="notice ok" role="status" data-testid="bs-saved">
          Saved {saved.saved.lines} new line{saved.saved.lines === 1 ? '' : 's'} and{' '}
          {saved.saved.balances} month-end balance{saved.saved.balances === 1 ? '' : 's'}.{' '}
          {saved.saved.toAnswer > 0 ? (
            <>
              {saved.saved.toAnswer} line{saved.saved.toAnswer === 1 ? '' : 's'} across your
              statements need{saved.saved.toAnswer === 1 ? 's' : ''} an answer on{' '}
              <Link href="/transactions?tab=statements">Transactions &gt; Bank statements</Link>.
            </>
          ) : (
            <>
              Every line is sorted: see{' '}
              <Link href="/transactions?tab=statements">Transactions &gt; Bank statements</Link>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
