'use client';

import { startTransition, useActionState, useState } from 'react';
import Link from 'next/link';
import { formatInr } from '@fwos/core';
import {
  commitFundCsv,
  commitImport,
  importCas,
  previewFundCsv,
  previewImport,
  syncLayout,
  type CasState,
  type FundCsvState,
  type ImportState,
} from './actions';

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
    <form className="form" aria-busy={previewing || committing}>
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
    <form className="form" action={action} aria-busy={pending}>
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

export function CasForm({ owners }: { owners: { id: string; name: string }[] }) {
  const [res, act, pending] = useActionState<CasState | null, FormData>(importCas, null);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <label>
        Fund statement (CAS, PDF) from CAMS, KFintech, MF Central or CDSL
        <input name="file" type="file" accept=".pdf" required />
      </label>
      <div className="formgrid g3">
        <label>
          Whose statement
          <select name="owner" required>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          PDF password (the one you chose when you requested it, or your PAN; used once, never
          saved)
          <input name="password" type="password" autoComplete="off" required />
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Reading…' : 'Import statement'}
        </button>
        {res && (
          <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
            {res.message}
          </span>
        )}
      </div>
      {res?.lines && (
        <ul className="list small">
          {res.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </form>
  );
}

const FUND_STATUS = {
  updated: { tone: 'ok', text: 'Updates a fund you have' },
  added: { tone: 'warn', text: 'New fund' },
  review: { tone: 'bad', text: 'Needs a look' },
} as const;
const csvIdle: FundCsvState = { stage: 'idle' };

/** First name in a file name ("Rupash__Advika_-_transactions.csv") against the people's names. */
function guessOwner(file: string, owners: { id: string; name: string }[]): string {
  const first =
    file
      .toLowerCase()
      .split(/[^a-z]+/)
      .find(Boolean) ?? '';
  return owners.find((o) => first && o.name.toLowerCase().startsWith(first))?.id ?? '';
}

/**
 * Fund transactions from an investment app's CSV export. Files and the person chosen for each are held here (not in the form),
 * so the preview and the import both send the same files.
 */
export function FundCsvForm({ owners }: { owners: { id: string; name: string }[] }) {
  const [files, setFiles] = useState<File[]>([]);
  const [who, setWho] = useState<string[]>([]);
  const [preview, previewAct, previewing] = useActionState(previewFundCsv, csvIdle);
  const [commit, commitAct, committing] = useActionState(commitFundCsv, csvIdle);
  const [done, setDone] = useState(false);
  const shown = done && commit.stage !== 'idle' ? commit : preview;
  const busy = previewing || committing;
  const ready = files.length > 0 && who.every(Boolean);

  const send = (act: (f: FormData) => void) => {
    const fd = new FormData();
    files.forEach((f, i) => {
      fd.append('files', f);
      fd.set(`owner_${i}`, who[i] ?? '');
    });
    startTransition(() => act(fd));
  };

  return (
    <div className="form" aria-busy={busy}>
      <label>
        Transaction files (.csv), one per account; several can be chosen together
        <input
          type="file"
          accept=".csv,text/csv"
          multiple
          onChange={(e) => {
            const chosen = Array.from(e.target.files ?? []);
            setFiles(chosen);
            setWho(chosen.map((f) => guessOwner(f.name, owners)));
            setDone(false);
          }}
        />
      </label>
      {files.length > 0 && (
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>File</th>
              <th>Whose</th>
            </tr>
          </thead>
          <tbody>
            {files.map((f, i) => (
              <tr key={`${f.name}-${i}`}>
                <td data-label="File">{f.name}</td>
                <td data-label="Whose">
                  <select
                    aria-label={`Whose is ${f.name}`}
                    value={who[i] ?? ''}
                    onChange={(e) => {
                      setWho(who.map((w, j) => (j === i ? e.target.value : w)));
                      setDone(false);
                    }}
                  >
                    <option value="">Choose…</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={busy || !ready}
          onClick={() => {
            setDone(false);
            send(previewAct);
          }}
        >
          {previewing ? 'Reading…' : 'Preview (nothing is saved)'}
        </button>
      </div>

      {shown.stage === 'error' && (
        <p className="notice warn" role="alert">
          {shown.message}
        </p>
      )}
      {(shown.stage === 'previewed' || shown.stage === 'committed') && (
        <>
          {shown.stage === 'committed' && (
            <div className="notice ok" role="status">
              <p>Imported. Units, amounts invested and values are updated for the funds below.</p>
              <Link className="btn primary" href="/investments">
                See the funds
              </Link>
            </div>
          )}
          {shown.people?.map((p) => {
            const held = p.funds.filter((x) => x.status !== 'review');
            return (
              <section key={p.name} className="csvperson">
                <h3>
                  {p.name}
                  {p.files.length > 0 && (
                    <span className="muted small"> · {p.files.join(', ')}</span>
                  )}
                </h3>
                {p.funds.length > 0 && (
                  <table className="tbl lines responsive">
                    <thead>
                      <tr>
                        <th>Fund</th>
                        <th>What happens</th>
                        <th className="num">Lines (new)</th>
                        <th className="num">Units</th>
                        <th className="num">Invested</th>
                        <th className="num">Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.funds.map((x) => (
                        <tr key={x.name}>
                          <td data-label="Fund">{x.name}</td>
                          <td data-label="What happens">
                            <span className={`pill ${FUND_STATUS[x.status].tone}`}>
                              {FUND_STATUS[x.status].text}
                            </span>
                          </td>
                          <td className="num" data-label="Lines (new)">
                            {x.transactions} ({x.newTransactions})
                          </td>
                          <td className="num" data-label="Units">
                            {x.units === null ? '–' : x.units.toLocaleString('en-IN')}
                          </td>
                          <td className="num" data-label="Invested">
                            {formatInr(x.invested)}
                          </td>
                          <td className="num" data-label="Value">
                            {x.value === null ? '–' : formatInr(x.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <th colSpan={4}>Total ({held.length} funds)</th>
                        <th className="num">
                          {formatInr(held.reduce((a, x) => a + x.invested, 0))}
                        </th>
                        <th className="num">
                          {formatInr(held.reduce((a, x) => a + (x.value ?? 0), 0))}
                        </th>
                      </tr>
                    </tfoot>
                  </table>
                )}
                {p.skipped > 0 && (
                  <p className="muted small">
                    {p.skipped} fund(s) fully sold before this financial year were not added.
                  </p>
                )}
                {p.notes.length > 0 && (
                  <ul className="list small">
                    {p.notes.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
          {shown.stage === 'previewed' && (
            <div className="row">
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => {
                  setDone(true);
                  send(commitAct);
                }}
              >
                {committing ? 'Importing…' : 'Import these funds'}
              </button>
              <span className="muted small">
                Saves the transactions, the units held, the amount invested and today&rsquo;s value.
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
