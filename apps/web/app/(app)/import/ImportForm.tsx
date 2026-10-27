'use client';

import { startTransition, useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { BusyNote, ResultNote } from '@/components/BusyNote';
import { FilePicker } from '@/components/FilePicker';
import { AppliedChanges, FundChanges } from '@/components/FundChanges';
import type { CasState, FundCsvState } from '@/lib/fund-import';
import { appendSelection, hasWork, type FundSelection } from '@/lib/fund-import-select';
import { guessOwner, plainCountName } from '@/lib/import-detect';
import { commitImport, previewImport, syncLayout, type ImportState } from './actions';
import { commitFundCsv, importCas, previewCas, previewFundCsv } from './fund-actions';

const idle: ImportState = { stage: 'idle' };
const SEV: Record<string, string> = {
  needs_input: 'Needs your decision',
  warning: 'Please review',
  info: 'For information',
};

export function ImportForm({ today, file }: { today: string; file?: File | null }) {
  const [preview, previewAction, previewing] = useActionState(previewImport, idle);
  const [commit, commitAction, committing] = useActionState(commitImport, idle);
  const shown = commit.stage === 'idle' ? preview : commit;
  const needs = (shown.exceptions ?? []).filter((e) => e.severity === 'needs_input');
  const allOk = (shown.reconciliation ?? []).every((r) => r.ok);

  return (
    <form className="form" aria-busy={previewing || committing}>
      <FilePicker label="Workbook (.xlsx)" accept=".xlsx" file={file} />
      <label>
        The balances in this file are as of
        <input name="asOf" type="date" defaultValue={today} required />
      </label>
      <div className="row">
        <button className="btn" formAction={previewAction} disabled={previewing}>
          {previewing ? 'Reading…' : 'Preview (nothing is saved)'}
        </button>
      </div>
      <BusyNote active={previewing}>
        Reading every sheet and checking the totals against your file. Nothing is saved yet.
      </BusyNote>

      {shown.stage === 'error' && (
        <ResultNote tone="warn" role="alert">
          {shown.message}
        </ResultNote>
      )}

      {shown.stage === 'committed' && (
        <ResultNote tone="ok" role="status">
          <p>
            Imported {shown.committed?.assets} accounts and holdings and{' '}
            {shown.committed?.observations} balances from {shown.fileName}.
          </p>
          <Link className="btn primary" href="/">
            Go to the dashboard
          </Link>
        </ResultNote>
      )}

      {shown.stage === 'previewed' && (
        <>
          <h2>What will be added</h2>
          <ul className="chips">
            {Object.entries(shown.counts ?? {}).map(([k, v]) => (
              <li key={k} className="chip">
                {v} {plainCountName(k)}
              </li>
            ))}
          </ul>
          <h2>Checks against your own sheet</h2>
          <ul className="list">
            {shown.reconciliation?.map((r) => (
              <li key={r.check} className={r.ok ? 'pass' : 'fail'}>
                <strong>{r.ok ? 'Matches' : 'Does not match'}</strong> — {r.check}
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
            title={allOk ? '' : 'The totals do not match your sheet, so nothing can be imported'}
          >
            {committing
              ? 'Importing…'
              : `Import ${needs.length ? `(${needs.length} items flagged)` : ''}`}
          </button>
          <BusyNote active={committing}>
            Importing your accounts, deposits and balances. This can take up to a minute: please
            keep this page open. The result appears here when it is done.
          </BusyNote>
        </>
      )}
    </form>
  );
}

export function SyncLayoutForm({ today, file }: { today: string; file?: File | null }) {
  const [state, action, pending] = useActionState(syncLayout, idle);
  return (
    <form className="form" action={action} aria-busy={pending}>
      <FilePicker label="Workbook (.xlsx)" accept=".xlsx" file={file} />
      <input type="hidden" name="asOf" value={today} />
      <div className="row">
        <button className="btn primary" disabled={pending}>
          {pending ? 'Updating…' : 'Update order, names and links'}
        </button>
      </div>
      <BusyNote active={pending}>
        Updating the order, names and links. Please keep this page open.
      </BusyNote>
      {state.stage === 'error' && (
        <ResultNote tone="warn" role="alert">
          {state.message}
        </ResultNote>
      )}
      {state.stage === 'committed' && (
        <ResultNote tone="ok" role="status">
          {state.message}
        </ResultNote>
      )}
    </form>
  );
}

const casIdle: CasState = { stage: 'idle' };

/** The file and the choices of a fund-statement form: held here (not in a native form), so a preview does not empty them. */
function useSelectionState() {
  const [sel, setSel] = useState<FundSelection>({ seen: [], take: [], choices: [], count: 0 });
  return [sel, setSel] as const;
}

/**
 * A fund statement (CAS) uploaded by hand, in two steps: "Preview changes" reads the statement and shows what it would change
 * compared with what is on file (nothing is written, and the password is used once and never saved), then "Apply the selected
 * changes" writes only the items left ticked.
 */
export function CasForm({
  owners,
  file,
  defaultOwner,
}: {
  owners: { id: string; name: string }[];
  file?: File | null;
  defaultOwner?: string;
}) {
  const [pdf, setPdf] = useState<File | null>(file ?? null);
  const [owner, setOwner] = useState(defaultOwner || owners[0]?.id || '');
  const [password, setPassword] = useState('');
  const [preview, previewAct, previewing] = useActionState(previewCas, casIdle);
  const [apply, applyAct, applying] = useActionState(importCas, casIdle);
  const [done, setDone] = useState(false);
  const [sel, setSel] = useSelectionState();
  const shown = done && apply.stage !== 'idle' ? apply : preview;
  const busy = previewing || applying;
  const people = useMemo(
    () => (shown.stage === 'previewed' && shown.person ? [shown.person] : []),
    [shown],
  );

  const send = (act: (f: FormData) => void, withSelection: boolean) => {
    const fd = new FormData();
    if (pdf) fd.set('file', pdf);
    fd.set('owner', owner);
    fd.set('password', password);
    if (withSelection) appendSelection(fd, sel);
    startTransition(() => act(fd));
  };

  return (
    <div className="form" aria-busy={busy}>
      {file ? (
        <div className="filechip">
          <span className="filechip-name">{file.name}</span>
        </div>
      ) : (
        <label>
          Fund statement (PDF) from CAMS, KFintech, MF Central or CDSL
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => {
              setPdf(e.target.files?.[0] ?? null);
              setDone(false);
            }}
          />
        </label>
      )}
      <div className="formgrid g3">
        <label>
          Whose statement
          <select
            value={owner}
            onChange={(e) => {
              setOwner(e.target.value);
              setDone(false);
            }}
          >
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
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !pdf || !owner}
          onClick={() => {
            setDone(false);
            send(previewAct, false);
          }}
        >
          {previewing ? 'Reading…' : 'Preview changes'}
        </button>
        <span className="muted small">Nothing is saved until you apply the changes.</span>
      </div>
      <BusyNote active={previewing}>
        Reading the file and comparing it with what is on file. Nothing is saved yet.
      </BusyNote>

      {shown.stage === 'error' && (
        <p className="notice warn" role="alert">
          {shown.message}
        </p>
      )}
      {shown.stage === 'applied' && shown.applied && (
        <>
          <AppliedChanges {...shown.applied} />
          <Link className="btn" href="/investments">
            See the funds
          </Link>
        </>
      )}
      {shown.stage === 'previewed' && (
        <>
          <FundChanges people={people} owners={owners} disabled={busy} onSelection={setSel} />
          {shown.warnings && shown.warnings.length > 0 && (
            <ul className="list small">
              {shown.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          {(sel.seen.length > 0 || sel.choices.length > 0) && (
            <>
              <div className="fc-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !hasWork(sel)}
                  onClick={() => {
                    setDone(true);
                    send(applyAct, true);
                  }}
                >
                  {applying
                    ? 'Applying…'
                    : !hasWork(sel)
                      ? 'Nothing selected'
                      : `Apply the selected changes (${sel.count} fund${sel.count === 1 ? '' : 's'})`}
                </button>
                <span className="muted small">
                  Untick anything that is wrong; approve a suggestion or pick another answer where I
                  ask. What you leave unticked or unanswered is left as it is.
                </span>
              </div>
              <BusyNote active={applying}>
                Saving the selected changes. This can take a little while: please keep this page
                open.
              </BusyNote>
            </>
          )}
        </>
      )}
    </div>
  );
}

const csvIdle: FundCsvState = { stage: 'idle' };

/**
 * Fund transactions from an investment app's CSV export. Files and the person chosen for each are held here (not in the form),
 * so the preview and the import both send the same files. The preview shows what the files would change compared with what is on
 * file; only the ticked items are written.
 */
export function FundCsvForm({
  owners,
  initialFiles = [],
}: {
  owners: { id: string; name: string }[];
  /** files already chosen on the Import front page */
  initialFiles?: File[];
}) {
  const [files, setFiles] = useState<File[]>(initialFiles);
  const [who, setWho] = useState<string[]>(() =>
    initialFiles.map((f) => guessOwner(f.name, owners)),
  );
  const [preview, previewAct, previewing] = useActionState(previewFundCsv, csvIdle);
  const [commit, commitAct, committing] = useActionState(commitFundCsv, csvIdle);
  const [done, setDone] = useState(false);
  const [sel, setSel] = useSelectionState();
  const shown = done && commit.stage !== 'idle' ? commit : preview;
  const busy = previewing || committing;
  const ready = files.length > 0 && who.every(Boolean);

  const send = (act: (f: FormData) => void, withSelection: boolean) => {
    const fd = new FormData();
    files.forEach((f, i) => {
      fd.append('files', f);
      fd.set(`owner_${i}`, who[i] ?? '');
    });
    if (withSelection) appendSelection(fd, sel);
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
      <div className="row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="btn primary"
          disabled={busy || !ready}
          onClick={() => {
            setDone(false);
            send(previewAct, false);
          }}
        >
          {previewing ? 'Reading…' : 'Preview changes'}
        </button>
        <span className="muted small">Nothing is saved until you apply the changes.</span>
      </div>
      <BusyNote active={previewing}>
        Reading the file and comparing it with what is on file. Nothing is saved yet.
      </BusyNote>

      {shown.stage === 'error' && (
        <p className="notice warn" role="alert">
          {shown.message}
        </p>
      )}
      {shown.stage === 'committed' && (
        <>
          {shown.people?.map(
            (p) => p.applied && <AppliedChanges key={p.ownerId} name={p.name} {...p.applied} />,
          )}
          <Link className="btn" href="/investments">
            See the funds
          </Link>
        </>
      )}
      {shown.stage === 'previewed' && shown.people && (
        <>
          <FundChanges people={shown.people} owners={owners} disabled={busy} onSelection={setSel} />
          {shown.notes && shown.notes.length > 0 && (
            <ul className="list small">
              {shown.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {(sel.seen.length > 0 || sel.choices.length > 0) && (
            <>
              <div className="fc-actions">
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy || !hasWork(sel)}
                  onClick={() => {
                    setDone(true);
                    send(commitAct, true);
                  }}
                >
                  {committing
                    ? 'Applying…'
                    : !hasWork(sel)
                      ? 'Nothing selected'
                      : `Apply the selected changes (${sel.count} fund${sel.count === 1 ? '' : 's'})`}
                </button>
                <span className="muted small">
                  Untick anything that is wrong; approve a suggestion or pick another answer where I
                  ask. What you leave unticked or unanswered is left as it is.
                </span>
              </div>
              <BusyNote active={committing}>
                Saving the selected changes. This can take a little while: please keep this page
                open.
              </BusyNote>
            </>
          )}
        </>
      )}
    </div>
  );
}
