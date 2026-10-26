'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import { commitImport, previewImport, syncLayout, type ImportState } from './actions';

const idle: ImportState = { stage: 'idle' };
const SEV: Record<string, string> = {
  needs_input: 'Needs your decision',
  warning: 'Please review',
  info: 'For information',
};

export function ImportForm({ today }: { today: string }) {
  const [preview, previewAction, previewing] = useActionState(previewImport, idle);
  const [commit, commitAction, committing] = useActionState(commitImport, idle);
  const shown = commit.stage === 'idle' ? preview : commit;
  const needs = (shown.exceptions ?? []).filter((e) => e.severity === 'needs_input');
  const allOk = (shown.reconciliation ?? []).every((r) => r.ok);

  return (
    <form className="card form" aria-busy={previewing || committing}>
      <label>
        Workbook (.xlsx)
        <input name="file" type="file" accept=".xlsx" required />
      </label>
      <label>
        The balances in this file are as of
        <input name="asOf" type="date" defaultValue={today} required />
      </label>
      <div className="row">
        <button className="btn" formAction={previewAction} disabled={previewing}>
          {previewing ? 'Reading…' : 'Preview (nothing is saved)'}
        </button>
      </div>

      {shown.stage === 'error' && (
        <p className="notice warn" role="alert">
          {shown.message}
        </p>
      )}

      {shown.stage === 'committed' && (
        <div className="notice ok" role="status">
          <p>
            Imported {shown.committed?.assets} assets and {shown.committed?.observations} values
            from {shown.fileName}.
          </p>
          <Link className="btn primary" href="/">
            Go to the dashboard
          </Link>
        </div>
      )}

      {shown.stage === 'previewed' && (
        <>
          <h2>What will be imported</h2>
          <ul className="chips">
            {Object.entries(shown.counts ?? {}).map(([k, v]) => (
              <li key={k} className="chip">
                {v} {k}
              </li>
            ))}
          </ul>
          <h2>Checks against your own sheet</h2>
          <ul className="list">
            {shown.reconciliation?.map((r) => (
              <li key={r.check} className={r.ok ? 'pass' : 'fail'}>
                <strong>{r.ok ? 'Matches' : 'DIFFERS'}</strong> — {r.check}
              </li>
            ))}
          </ul>
          {(['needs_input', 'warning', 'info'] as const).map((sev) => {
            const list = (shown.exceptions ?? []).filter((e) => e.severity === sev);
            if (!list.length) return null;
            return (
              <div key={sev}>
                <h2>
                  {SEV[sev]} ({list.length})
                </h2>
                <ul className="list">
                  {list.map((e) => (
                    <li key={e.cell + e.code}>
                      {sev === 'needs_input' && (
                        <label className="check">
                          <input type="checkbox" name="ack" value={e.cell} /> I have read this
                        </label>
                      )}
                      <span className="muted small">{e.cell}</span> {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          <p className="muted small">
            Items under &ldquo;Needs your decision&rdquo; are imported as flagged (for example,
            matured deposits are kept out of net worth) until you resolve them in the app. Ticking
            confirms you have seen them.
          </p>
          <button
            className="btn primary"
            formAction={commitAction}
            disabled={committing || !allOk}
            title={allOk ? '' : 'Totals do not match the workbook'}
          >
            {committing
              ? 'Importing…'
              : `Import ${needs.length ? `(${needs.length} items flagged)` : ''}`}
          </button>
        </>
      )}
    </form>
  );
}

export function SyncLayoutForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState(syncLayout, idle);
  return (
    <form className="card form" action={action} aria-busy={pending}>
      <h2>Sync the layout from your sheet</h2>
      <p className="muted small">
        Applies your sheet&apos;s order, labels (NRE, NRO, joint), links between each FD and its
        savings account, FD numbers (last 4 digits) and notes to the records already here. It never
        changes a balance or an FD amount, so it is safe to run whenever you reorder the sheet.
      </p>
      <label>
        Workbook (.xlsx)
        <input name="file" type="file" accept=".xlsx" required />
      </label>
      <input type="hidden" name="asOf" value={today} />
      <div className="row">
        <button className="btn primary" disabled={pending}>
          {pending ? 'Applying…' : 'Apply the sheet layout'}
        </button>
      </div>
      {state.stage === 'error' && (
        <p className="notice warn" role="alert">
          {state.message}
        </p>
      )}
      {state.stage === 'committed' && (
        <p className="notice ok" role="status">
          {state.message}
        </p>
      )}
    </form>
  );
}
