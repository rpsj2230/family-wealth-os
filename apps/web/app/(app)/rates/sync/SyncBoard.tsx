'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { BusyNote, ResultNote } from '@/components/BusyNote';
import { DOC_KIND_LABEL, DOC_KINDS, type DocKind } from '@fwos/core';
import type { DocLine } from '@fwos/ingest';
import { ageTag, progressText, thirdPartyNotice, type SyncRowView } from '@/lib/rates-sync-view';
import { slugify } from '@/lib/slug';
import './sync.css';

export interface BankSyncResult {
  bank: string;
  status: 'synced' | 'unchanged' | 'cannot' | 'no_key' | 'error';
  message: string;
  docs: DocLine[];
}
export interface PlainResult {
  ok: boolean;
  message: string;
}

/** What the board can do. The signed-in page passes the real server actions; the public sample passes ones that only act it out. */
export interface SyncActions {
  syncBank: (bank: string) => Promise<BankSyncResult>;
  pastePage: (bank: string, text: string, kind: DocKind) => Promise<PlainResult>;
  addPage: (bank: string, url: string, kind: DocKind) => Promise<PlainResult>;
  removeThirdParty: () => Promise<PlainResult & { removed: number }>;
}

const TIMEOUT_MESSAGE =
  'The request did not finish (a bank can be slow). Nothing was lost: try this bank again.';

const kindOptions = DOC_KINDS.map((k) => (
  <option key={k} value={k}>
    {DOC_KIND_LABEL[k]}
  </option>
));

const mark = (state: 'ok' | 'bad' | 'planned') =>
  state === 'ok' ? '✓' : state === 'bad' ? '✗' : '·';

/** A document line from a sync that just ran, in the shape of the stored ones. */
function liveDocs(docs: DocLine[]): SyncRowView['documents'] {
  return docs.map((d) => {
    let where = d.url;
    try {
      const u = new URL(d.url);
      where = `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
    } catch {
      /* shown as given */
    }
    return {
      url: d.url,
      where,
      host: where.split('/')[0] ?? '',
      kind: d.kind,
      kindLabel: DOC_KIND_LABEL[d.kind],
      state: d.ok ? ('ok' as const) : ('bad' as const),
      note: d.note,
      via: d.via,
      effectiveOn: d.effectiveOn,
    };
  });
}

function RowTone({ status }: { status: BankSyncResult['status'] | undefined }) {
  return (
    <span data-testid="row-status" hidden>
      {status ?? ''}
    </span>
  );
}

function PasteBox({
  bank,
  open,
  disabled,
  actions,
  onDone,
}: {
  bank: string;
  open: boolean;
  disabled: boolean;
  actions: SyncActions;
  onDone: () => void;
}) {
  const [text, setText] = useState('');
  const [kind, setKind] = useState<DocKind>('both');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PlainResult | null>(null);
  return (
    <details className="pastepage sync-extra" open={open || undefined}>
      <summary>Paste the page</summary>
      <p className="small muted">
        Open {bank}&apos;s rate page in your own browser, <b>expand every section</b> (collapsed
        sections are not copied), select all (Ctrl+A, or Cmd+A on a Mac), copy, and paste below. The
        rates are read from the text, marked as pasted by you, and a rate you typed is never
        overwritten.
      </p>
      <label className="fld">
        <span className="fld-label">Which rates are in the text</span>
        <select value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
          {kindOptions}
        </select>
      </label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        aria-label={`Text copied from the ${bank} rate page`}
        placeholder="Paste the whole page here"
      />
      <button
        type="button"
        className="btn compact"
        disabled={busy || disabled || text.trim().length === 0}
        onClick={async () => {
          setBusy(true);
          setRes(null);
          try {
            const r = await actions.pastePage(bank, text, kind);
            setRes(r);
            if (r.ok) {
              setText('');
              onDone();
            }
          } catch {
            setRes({ ok: false, message: TIMEOUT_MESSAGE });
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? 'Reading…' : 'Read the rates'}
      </button>
      <div role="status" aria-live="polite">
        {res && <p className={`small ${res.ok ? 'ok' : 'bad'}`}>{res.message}</p>}
      </div>
    </details>
  );
}

function AddPageBox({
  bank,
  actions,
  onDone,
}: {
  bank: string;
  actions: SyncActions;
  onDone: () => void;
}) {
  const [url, setUrl] = useState('');
  const [kind, setKind] = useState<DocKind>('both');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PlainResult | null>(null);
  return (
    <details className="sync-extra">
      <summary>Add another page for this bank</summary>
      <p className="small muted">
        Some banks publish savings and deposit rates on different pages. Give the bank&apos;s own
        page (or PDF) and say which rates it carries; it is read together with the others.
      </p>
      <div className="sync-add">
        <label className="fld">
          <span className="fld-label">Address of the bank&apos;s own page</span>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            inputMode="url"
            placeholder="https://"
            aria-label={`Address of another ${bank} rate page`}
          />
        </label>
        <label className="fld">
          <span className="fld-label">Which rates are on it</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as DocKind)}>
            {kindOptions}
          </select>
        </label>
        <button
          type="button"
          className="btn compact"
          disabled={busy || url.trim().length === 0}
          onClick={async () => {
            setBusy(true);
            setRes(null);
            try {
              const r = await actions.addPage(bank, url, kind);
              setRes(r);
              if (r.ok) {
                setUrl('');
                onDone();
              }
            } catch {
              setRes({ ok: false, message: 'That could not be saved. Try again.' });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Adding…' : 'Add page'}
        </button>
      </div>
      <div role="status" aria-live="polite">
        {res && <p className={`small ${res.ok ? 'ok' : 'bad'}`}>{res.message}</p>}
      </div>
    </details>
  );
}

function ThirdPartyBox({
  count,
  actions,
  onDone,
}: {
  count: number;
  actions: SyncActions;
  onDone: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<PlainResult | null>(null);
  const text = thirdPartyNotice(count);
  if (!text && !res) return null;
  return (
    <section
      className="notice warn sync-third"
      data-testid="third-party"
      aria-label="Rates from comparison websites"
    >
      {text && <p>{text}</p>}
      {text && !confirming && (
        <button type="button" className="btn compact" onClick={() => setConfirming(true)}>
          Remove rates from comparison websites
        </button>
      )}
      {text && confirming && (
        <div className="sync-confirm" role="group" aria-label="Confirm removal">
          <p className="small">
            Remove the {count} saved rate{count === 1 ? '' : 's'} that came from comparison
            websites? Rates you typed and rates read from a bank&apos;s own page stay.
          </p>
          <button
            type="button"
            className="btn compact primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await actions.removeThirdParty();
                setRes(r);
                setConfirming(false);
                onDone();
              } catch {
                setRes({
                  ok: false,
                  message: 'The rates could not be removed. Nothing was changed.',
                });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Removing…' : 'Yes, remove them'}
          </button>{' '}
          <button
            type="button"
            className="btn compact ghost"
            disabled={busy}
            onClick={() => setConfirming(false)}
          >
            Cancel
          </button>
        </div>
      )}
      <div role="status" aria-live="polite">
        {res && <p className={`small ${res.ok ? 'ok' : 'bad'}`}>{res.message}</p>}
      </div>
    </section>
  );
}

function Row({
  row,
  result,
  busy,
  locked,
  noKey,
  actions,
  onChanged,
  onSync,
}: {
  row: SyncRowView;
  result: BankSyncResult | undefined;
  busy: boolean;
  locked: boolean;
  noKey: boolean;
  actions: SyncActions;
  onChanged: () => void;
  onSync: () => void;
}) {
  const live = result ? liveDocs(result.docs) : null;
  const documents = live && live.length > 0 ? live : row.documents;
  const cannot = result
    ? result.status === 'cannot' || result.status === 'error'
    : row.chip.status === 'cannot';
  const chip =
    result && result.status !== 'error'
      ? result.status === 'synced'
        ? { label: 'Synced today', tone: 'ok' }
        : result.status === 'unchanged'
          ? { label: 'Unchanged', tone: 'ok' }
          : result.status === 'no_key'
            ? { label: 'No AI key', tone: 'warn' }
            : { label: 'Cannot read', tone: 'bad' }
      : result
        ? { label: 'Cannot read', tone: 'bad' }
        : row.chip;
  const rateDoc = live?.find((d) => d.via && d.state === 'ok') ?? null;
  const shownDoc = rateDoc ? { where: rateDoc.where, url: rateDoc.url } : row.rateDoc;
  const effective = live?.find((d) => d.effectiveOn)?.effectiveOn ?? row.effectiveOn;
  const text = result ? `Just now: ${result.message}` : row.lastText;
  return (
    <article
      className="card sync-row"
      id={slugify(row.bank)}
      data-testid="sync-row"
      data-bank={row.bank}
    >
      <div className="sync-head">
        <h2 className="sync-bank">{row.bank}</h2>
        <span className={`pill ${chip.tone}`} data-testid="sync-chip">
          {chip.label}
        </span>
        <button
          type="button"
          className="btn compact sync-one"
          disabled={locked || noKey}
          onClick={onSync}
          aria-label={`Sync ${row.bank}`}
        >
          {busy ? 'Syncing…' : 'Sync'}
        </button>
      </div>
      <p className="small sync-meta">
        {row.rateCount === 0 ? (
          'No rates on file'
        ) : (
          <>
            {row.rateCount} rate{row.rateCount === 1 ? '' : 's'} on file
            {row.newestCheck && (
              <>
                {' '}
                <span className={row.newestCheck.stale ? 'warnText' : 'muted'}>
                  ({ageTag(row.newestCheck.days)}
                  {row.newestCheck.stale ? ', older than it should be' : ''})
                </span>
              </>
            )}
          </>
        )}
        {row.thirdParty > 0 && (
          <span className="pill warn sync-tp">{row.thirdParty} from comparison websites</span>
        )}
      </p>
      <p className={`small sync-result ${cannot ? 'bad' : ''}`} role="status" aria-live="polite">
        {text}
      </p>
      <RowTone status={result?.status} />
      {shownDoc && (
        <p className="small sync-doc" data-testid="rate-doc">
          Rates document:{' '}
          <a href={shownDoc.url} target="_blank" rel="noreferrer">
            {shownDoc.where}
          </a>
          {effective && (
            <span className="muted"> (the bank lists it as effective from {effective})</span>
          )}
        </p>
      )}
      <BusyNote active={busy}>Reading {row.bank}&apos;s own pages and its rates…</BusyNote>
      <ul className="sync-docs">
        {documents.map((d, i) => (
          <li key={`${d.url}-${i}`} data-state={d.state}>
            <span aria-hidden="true" className={`sync-mark ${d.state}`}>
              {mark(d.state)}
            </span>
            <span className="sync-docbody">
              <a href={d.url} target="_blank" rel="noreferrer" className="sync-where">
                {d.where}
              </a>
              <span className="chip tiny sync-kind">{d.kindLabel}</span>
              <span className={`small ${d.state === 'bad' ? 'bad' : 'muted'}`}>
                {d.state === 'planned'
                  ? 'Not read yet'
                  : d.state === 'ok'
                    ? `Read OK, ${d.note.replace(/^read /, '')}`
                    : d.note}
              </span>
            </span>
          </li>
        ))}
      </ul>
      {cannot && (
        <p className="small sync-hint" data-testid="cannot-hint">
          Rates are only read from the bank&apos;s own pages and a refusal is never worked around.
          Open the page in your own browser, expand every section, select all, copy, and use{' '}
          <b>Paste the page</b> below.
        </p>
      )}
      <PasteBox
        bank={row.bank}
        open={cannot}
        disabled={noKey}
        actions={actions}
        onDone={onChanged}
      />
      <AddPageBox bank={row.bank} actions={actions} onDone={onChanged} />
    </article>
  );
}

export function SyncBoard({
  rows,
  hasAiKey,
  thirdParty,
  settingsHref,
  actions,
  demo = false,
}: {
  rows: SyncRowView[];
  hasAiKey: boolean;
  thirdParty: number;
  settingsHref: string;
  actions: SyncActions;
  demo?: boolean;
}) {
  const router = useRouter();
  const refresh = () => {
    if (!demo) router.refresh();
  };
  const stopRef = useRef(false);
  const [results, setResults] = useState<Record<string, BankSyncResult>>({});
  const [progress, setProgress] = useState<{ n: number; of: number; bank: string } | null>(null);
  const [one, setOne] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [summary, setSummary] = useState<{
    tone: 'ok' | 'warn';
    text: string;
  } | null>(null);
  const running = progress !== null || one !== null;

  const run = async (bank: string): Promise<BankSyncResult> => {
    try {
      return await actions.syncBank(bank);
    } catch {
      return { bank, status: 'error', message: TIMEOUT_MESSAGE, docs: [] };
    }
  };

  const syncOne = async (bank: string) => {
    setSummary(null);
    setOne(bank);
    const r = await run(bank);
    setResults((p) => ({ ...p, [bank]: r }));
    setOne(null);
    refresh();
  };

  const syncAll = async () => {
    stopRef.current = false;
    setStopping(false);
    setSummary(null);
    const banks = rows.map((r) => r.bank);
    const tally = { synced: 0, unchanged: 0, cannot: 0, other: 0 };
    let done = 0;
    for (let i = 0; i < banks.length; i++) {
      if (stopRef.current) break;
      const bank = banks[i]!;
      setProgress({ n: i + 1, of: banks.length, bank });
      const r = await run(bank);
      setResults((p) => ({ ...p, [bank]: r }));
      done++;
      if (r.status === 'synced') tally.synced++;
      else if (r.status === 'unchanged') tally.unchanged++;
      else if (r.status === 'cannot' || r.status === 'error') tally.cannot++;
      else tally.other++;
      // with no key every bank would say the same: stop at the first
      if (r.status === 'no_key') break;
    }
    setProgress(null);
    setStopping(false);
    const stoppedEarly = stopRef.current && done < banks.length;
    const parts = [
      tally.synced ? `${tally.synced} synced` : null,
      tally.unchanged ? `${tally.unchanged} unchanged` : null,
      tally.cannot ? `${tally.cannot} cannot be read` : null,
      tally.other ? 'no AI key is switched on' : null,
    ].filter(Boolean);
    setSummary({
      tone: tally.cannot > 0 || tally.other > 0 || stoppedEarly ? 'warn' : 'ok',
      text: `${stoppedEarly ? `Stopped after ${done} of ${banks.length} banks` : `Done: ${done} of ${banks.length} banks`}${parts.length ? `. ${parts.join(', ')}` : ''}.`,
    });
    refresh();
  };

  return (
    <>
      {!hasAiKey && (
        <p className="notice warn" role="alert" data-testid="no-key">
          No AI key is switched on, so rates cannot be read yet. Add one, or switch one on, in{' '}
          <Link href={settingsHref}>Settings &gt; Connections</Link>.
        </p>
      )}
      <ThirdPartyBox count={thirdParty} actions={actions} onDone={refresh} />
      <section className="card sync-all" aria-labelledby="syncall-h">
        <h2 id="syncall-h">Sync all banks</h2>
        <p className="small muted">
          Each bank is read one after the other, from its own pages only. You can stop between
          banks. Rates you typed yourself are never overwritten.
        </p>
        <div className="sync-actions">
          <button
            type="button"
            className="btn primary"
            data-testid="sync-all"
            disabled={running || !hasAiKey || rows.length === 0}
            onClick={syncAll}
          >
            Sync all banks ({rows.length})
          </button>
          {progress && (
            <button
              type="button"
              className="btn"
              data-testid="sync-stop"
              disabled={stopping}
              onClick={() => {
                stopRef.current = true;
                setStopping(true);
              }}
            >
              {stopping ? 'Stopping after this bank…' : 'Stop'}
            </button>
          )}
        </div>
        <BusyNote active={progress !== null}>
          <span data-testid="sync-progress">
            {progress ? progressText(progress.n, progress.of, progress.bank) : ''}
          </span>
        </BusyNote>
        {summary && (
          <ResultNote tone={summary.tone} role="status">
            <span data-testid="sync-summary">{summary.text}</span>
          </ResultNote>
        )}
      </section>

      {rows.length === 0 ? (
        <p className="empty">
          No bank rate pages are listed yet. Add the bank&apos;s own rate page in{' '}
          <Link href="/settings?tab=connections#rates">Settings &gt; Connections</Link>.
        </p>
      ) : (
        <div className="sync-list">
          {rows.map((row) => (
            <Row
              key={row.bank}
              row={row}
              result={results[row.bank]}
              busy={one === row.bank || progress?.bank === row.bank}
              locked={running}
              noKey={!hasAiKey}
              actions={actions}
              onChanged={refresh}
              onSync={() => syncOne(row.bank)}
            />
          ))}
        </div>
      )}
    </>
  );
}
