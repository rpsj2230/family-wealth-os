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
}: {
  accounts: { id: string; label: string; last4: string | null }[];
  file: File;
}) {
  const [asset, setAsset] = useState(() => guessAccount(file.name, accounts));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [preview, previewAct, previewing] = useActionState(previewStatement, idle);
  const [saved, saveAct, saving] = useActionState(saveStatement, idle);
  const busy = previewing || saving;
  const send = (act: (f: FormData) => void) => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('asset', asset);
    fd.set('password', password);
    if (confirm) fd.set('confirmMismatch', 'on');
    startTransition(() => act(fd));
  };
  const isPdf = /\.pdf$/i.test(file.name);
  const p = preview.stage === 'previewed' ? preview : null;

  return (
    <div className="form" aria-busy={busy}>
      <div className="filechip">
        <span className="filechip-name">{file.name}</span>
      </div>
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
          disabled={!asset || busy}
          onClick={() => send(previewAct)}
        >
          {previewing ? 'Reading…' : 'Preview'}
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={!asset || busy || !p}
          onClick={() => send(saveAct)}
        >
          {saving ? 'Saving…' : 'Save the statement'}
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
              <Link href="/reconcile?tab=statements">Explain movements &gt; Bank statements</Link>.
            </>
          ) : (
            <>
              Every line is sorted: see{' '}
              <Link href="/reconcile?tab=statements">Explain movements &gt; Bank statements</Link>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
