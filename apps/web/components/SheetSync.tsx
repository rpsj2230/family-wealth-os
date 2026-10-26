'use client';

import Link from 'next/link';
import { useState, useTransition, type ReactNode } from 'react';
import type { RowPlan, SyncResult, SyncView } from '@fwos/ingest';
import { applySheetSync, previewSheetSync } from '@/app/(app)/gsheet/actions';
import { niceDate } from '@/lib/dates';
import { lastSyncText, type SheetSyncInfo } from '@/lib/sheet-sync-status';
import { Sheet } from './Sheet';
import './sheetsync.css';

const TAG: Record<RowPlan['status'], string> = {
  update: 'Change',
  added: 'New row',
  closed: 'Closed in the app',
  unmatched: 'Not matched',
  same: 'Already right',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One row of the sheet and what would change in it: old, then new. */
function RowItem({ r }: { r: RowPlan }) {
  return (
    <li className="ss-row">
      <div className="ss-rowhead">
        <strong>
          Row {r.row} · {r.label || r.asset}
        </strong>
        <span className="muted small">{r.group}</span>
        <span className="ss-tag">{TAG[r.status]}</span>
      </div>
      {r.changes.length > 0 && (
        <ul className="ss-changes">
          {r.changes.map((c) => (
            <li key={c.cell}>
              <span className="ss-col">{c.column}</span>{' '}
              {c.old !== '' && (
                <>
                  <span className="ss-old">
                    <span className="sr-only">was </span>
                    {c.old}
                  </span>{' '}
                  <span aria-hidden="true">→</span>{' '}
                </>
              )}
              <strong>
                <span className="sr-only">now </span>
                {c.next}
              </strong>
              <span className="muted small"> ({c.cell})</span>
            </li>
          ))}
        </ul>
      )}
      {r.note && <p className="small muted ss-note">{r.note}</p>}
      {r.keptFormulas.length > 0 && (
        <p className="small muted ss-note">Formula kept as it is: {r.keptFormulas.join(', ')}.</p>
      )}
    </li>
  );
}

function Group({
  title,
  count,
  open,
  children,
}: {
  title: string;
  count: number;
  open?: boolean;
  children: ReactNode;
}) {
  if (count === 0) return null;
  return (
    <details className="ss-group" open={open}>
      <summary>
        {title} <span className="muted">({count})</span>
      </summary>
      {children}
    </details>
  );
}

/** What a sync would do (or did): where it goes, the numbers, then each row. Written for reading, not for colour: every row carries a word. */
export function SyncPreview({ view }: { view: SyncView }) {
  const changed = view.rows.filter((r) => r.status === 'update');
  const added = view.rows.filter((r) => r.status === 'added');
  const closed = view.rows.filter((r) => r.status === 'closed');
  const unmatched = view.rows.filter((r) => r.status === 'unmatched');
  const t = view.target;
  const applied = view.stage === 'applied';
  return (
    <div className="ss-preview">
      <p className="ss-target">
        <strong>
          {applied ? 'Written to' : 'Will go to'} the tab “{t.title}”.
        </strong>{' '}
        {t.existed ? (
          <>
            It {applied ? 'was' : 'is'} already in the sheet, so its figures are replaced
            {view.backup && (
              <>
                {applied ? '; the tab as it was is kept' : ' after the tab as it is now is kept'} in
                a hidden tab called “{view.backup.title}”
                {view.backup.replaces ? ' (replacing the one from the last sync)' : ''}
              </>
            )}
            .
          </>
        ) : (
          <>
            It {applied ? 'was' : 'does not exist yet; it will be'} created as a copy of “
            {t.copiedFrom}”, to its {t.position}, so the layout and formulas stay.
          </>
        )}
      </p>
      <ul className="ss-counts" aria-label="Summary">
        <li>
          <strong>{view.counts.updated}</strong> {view.counts.updated === 1 ? 'row' : 'rows'} to
          change
        </li>
        <li>
          <strong>{view.counts.added}</strong> new {view.counts.added === 1 ? 'row' : 'rows'}
        </li>
        <li>
          <strong>{view.counts.unchanged}</strong> already right
        </li>
        <li>
          <strong>{view.counts.closed}</strong> closed in the app
        </li>
        <li>
          <strong>{view.counts.unmatched + view.placeByHand.length}</strong> to look at
        </li>
      </ul>
      <p className="small muted">
        {plural(view.counts.cells, 'cell')} {applied ? 'written' : 'to write'}.{' '}
        {view.counts.formulasKept > 0 &&
          `${plural(view.counts.formulasKept, 'formula cell')} left as ${view.counts.formulasKept === 1 ? 'it is' : 'they are'}. `}
        Only the cells the sheet uses are written; formulas and everything else are never touched.
      </p>
      <Group title="Rows that change" count={changed.length} open>
        <ul className="ss-rows">
          {changed.map((r) => (
            <RowItem key={`${r.row}-${r.label}`} r={r} />
          ))}
        </ul>
      </Group>
      <Group title="New rows added under their group" count={added.length} open>
        <ul className="ss-rows">
          {added.map((r) => (
            <RowItem key={`${r.row}-${r.label}`} r={r} />
          ))}
        </ul>
      </Group>
      <Group title="Closed in the app, still in the sheet (left as they are)" count={closed.length}>
        <ul className="ss-rows">
          {closed.map((r) => (
            <RowItem key={`${r.row}-${r.label}`} r={r} />
          ))}
        </ul>
      </Group>
      <Group title="In the sheet, not in the app (left as they are)" count={unmatched.length}>
        <ul className="ss-rows">
          {unmatched.map((r) => (
            <RowItem key={`${r.row}-${r.label}`} r={r} />
          ))}
        </ul>
      </Group>
      <Group title="In the app, to place in the sheet by hand" count={view.placeByHand.length} open>
        <ul className="ss-rows">
          {view.placeByHand.map((p) => (
            <li key={p.asset} className="ss-row">
              <div className="ss-rowhead">
                <strong>{p.asset}</strong>
                <span className="ss-tag">By hand</span>
              </div>
              <p className="small muted ss-note">{p.reason}</p>
            </li>
          ))}
        </ul>
      </Group>
    </div>
  );
}

type Shown =
  | { kind: 'preview'; view: SyncView }
  | { kind: 'done'; view: SyncView }
  | { kind: 'sample' }
  | { kind: 'error'; message: string };

/**
 * Sync with Google Sheet: first a preview (nothing is changed), then a button that really writes. Used on the Import page and in the
 * Monthly update panel. On the public sample pages `demoView` stands in for Google: the preview is shown, nothing is sent anywhere.
 */
export function SheetSyncPanel({
  info,
  demoView,
  bare = false,
}: {
  info: SheetSyncInfo;
  demoView?: SyncView;
  bare?: boolean;
}) {
  const [shown, setShown] = useState<Shown | null>(null);
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const demo = !!demoView;
  const run = (kind: 'preview' | 'apply') => {
    setBusy(kind);
    start(async () => {
      let r: SyncResult;
      if (demoView) r = { ok: true, view: demoView };
      else r = kind === 'preview' ? await previewSheetSync() : await applySheetSync();
      setBusy(null);
      if (!r.ok) setShown({ kind: 'error', message: r.message });
      else if (demo && kind === 'apply') setShown({ kind: 'sample' });
      else setShown({ kind: kind === 'preview' ? 'preview' : 'done', view: r.view });
    });
  };
  const last = lastSyncText(info.last, niceDate);
  const body = (
    <>
      <p className="small muted ss-intro">
        Writes the app’s figures into this month’s tab of your Google Sheet, in the sheet’s own
        format. Press <strong>Preview</strong> first: it shows every cell that would change, and
        nothing is written until you confirm.
      </p>
      {!info.connected && !demo ? (
        <p className="notice warn small" role="status">
          <strong>Not connected yet.</strong> Add the sheet’s link and the service-account key in{' '}
          <Link href="/settings?tab=connections#google-sheet">Settings &gt; Connections</Link>, test
          it there, then come back.
        </p>
      ) : (
        <>
          {last && (
            <p className={`small ${info.last?.ok ? 'muted' : 'fail'}`}>
              {info.last?.ok ? '' : <strong>Problem: </strong>}
              {last}
            </p>
          )}
          <div className="ss-actions">
            <button
              type="button"
              className="btn"
              disabled={pending}
              aria-busy={busy === 'preview'}
              onClick={() => run('preview')}
            >
              {busy === 'preview' ? 'Reading the sheet…' : 'Preview sync'}
            </button>
            {shown?.kind === 'preview' && (
              <>
                <button
                  type="button"
                  className="btn primary"
                  disabled={pending}
                  aria-busy={busy === 'apply'}
                  onClick={() => run('apply')}
                >
                  {busy === 'apply' ? 'Writing to the sheet…' : 'Confirm and write to Google Sheet'}
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  disabled={pending}
                  onClick={() => setShown(null)}
                >
                  Discard preview
                </button>
              </>
            )}
          </div>
          {pending && (
            <p className="small muted" role="status">
              {busy === 'apply'
                ? 'Writing… this can take up to a minute. Do not close the page.'
                : 'Reading your sheet… up to half a minute.'}
            </p>
          )}
        </>
      )}
      <div aria-live="polite">
        {shown?.kind === 'error' && (
          <p className="notice warn" role="alert">
            <strong>Not done.</strong> {shown.message}
          </p>
        )}
        {shown?.kind === 'sample' && (
          <p className="notice ok small" role="status">
            This is a sample: nothing is written anywhere. In your own portal this button writes the
            tab shown above.
          </p>
        )}
        {shown?.kind === 'done' && (
          <p className="notice ok" role="status">
            <strong>Done.</strong> The sheet now holds the app’s figures for{' '}
            {shown.view.target.title}. {shown.view.summary}.{' '}
            {info.sheetUrl && (
              <a href={info.sheetUrl} target="_blank" rel="noreferrer">
                Open the Google Sheet
              </a>
            )}
          </p>
        )}
        {(shown?.kind === 'preview' || shown?.kind === 'done') && <SyncPreview view={shown.view} />}
        {shown?.kind === 'sample' && demoView && <SyncPreview view={demoView} />}
      </div>
    </>
  );
  if (bare) return <div className="ss">{body}</div>;
  return (
    <section className="card ss" id="google-sheet" aria-labelledby="ss-h">
      <div className="sectionhead">
        <h3 id="ss-h">Sync with Google Sheet</h3>
        {info.connected || demo ? (
          <span className="pill ok">Connected</span>
        ) : (
          <span className="pill warn">Not connected</span>
        )}
      </div>
      {body}
    </section>
  );
}

/** The Monthly update header's button: opens the same panel in a side sheet. */
export function SheetSyncButton({ info, demoView }: { info: SheetSyncInfo; demoView?: SyncView }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Sync with Google Sheet
      </button>
      {open && (
        <Sheet
          labelId="ss-title"
          onRequestClose={() => setOpen(false)}
          onClose={() => setOpen(false)}
        >
          <header className="qe-head">
            <div>
              <p className="qe-kicker">Google Sheet</p>
              <h2 id="ss-title">Sync with Google Sheet</h2>
            </div>
            <button
              type="button"
              className="qe-x"
              onClick={() => setOpen(false)}
              aria-label="Close"
            >
              <span aria-hidden>×</span>
            </button>
          </header>
          <div className="qe-body ss-dialog">
            <SheetSyncPanel info={info} {...(demoView ? { demoView } : {})} bare />
          </div>
        </Sheet>
      )}
    </>
  );
}
