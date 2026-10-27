'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { monthLabel } from '@fwos/core';
import type { ConflictChoice, MonthResult } from '@fwos/ingest';
import { demoHistoryView } from '@/lib/demo-history';
import {
  asOfText,
  checkText,
  conflictsOf,
  conflictText,
  dateChoices,
  defaultSelection,
  headline,
  historicalText,
  importOrder,
  resultText,
  type HistoryView,
  type Pins,
} from '@/lib/history-view';
import { finishHistory, importHistoryMonth, previewHistory } from './history-actions';
import { HistoryIdentities } from './HistoryIdentities';
import './history.css';

type Stage = 'idle' | 'reading' | 'ready' | 'importing' | 'done';

interface Outcome {
  tab: string;
  ok: boolean;
  message: string;
  result: MonthResult | null;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Import > Excel workbook > History from all monthly tabs. Choose the file, read every tab (nothing is saved), look at one line per
 * month, answer the conflicts, then import the selected months one at a time with a progress bar. In the public sample nothing is
 * uploaded: the invented preview is shown and the import is only acted out.
 */
export function HistoryForm({ file, demo = false }: { file: File; demo?: boolean }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<HistoryView | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [choices, setChoices] = useState<Record<string, ConflictChoice>>({});
  const [pins, setPins] = useState<Pins>({});
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const stop = useRef(false);

  const form = (extra: Record<string, string> = {}, ov = overrides, pn = pins) => {
    const fd = new FormData();
    fd.set('file', file);
    fd.set('overrides', JSON.stringify(ov));
    fd.set('pins', JSON.stringify(pn));
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  };

  async function read(ov: Record<string, string>, changed?: string, pn: Pins = pins) {
    setStage('reading');
    setError(null);
    let next: HistoryView;
    if (demo) {
      await wait(350);
      next = demoHistoryView(ov, pn);
    } else {
      const r = await previewHistory(form({}, ov, pn));
      if (!r.ok || !r.view) {
        setError(r.message ?? 'The file could not be read.');
        setStage(view ? 'ready' : 'idle');
        return;
      }
      next = r.view;
    }
    setView(next);
    setSelected((prev) => {
      if (!view) return new Set(defaultSelection(next));
      const keep = new Set([...prev].filter((t) => next.months.some((m) => m.tab === t)));
      if (changed) {
        const m = next.months.find((x) => x.tab === changed);
        if (m?.defaultSelected) keep.add(changed);
        else keep.delete(changed);
      }
      return keep;
    });
    setStage('ready');
  }

  function chooseMonth(tab: string, ym: string) {
    const next = { ...overrides };
    if (ym) next[tab] = ym;
    else delete next[tab];
    setOverrides(next);
    void read(next, tab);
  }

  /** The person chose an account (or took the choice back): the plan is made again with it, so counts and writes follow. */
  function choosePins(next: Pins) {
    setPins(next);
    void read(overrides, undefined, next);
  }

  async function runImport() {
    if (!view) return;
    const order = importOrder(view, selected);
    stop.current = false;
    setStage('importing');
    setOutcomes([]);
    setProgress({ done: 0, total: order.length, current: '' });
    const out: Outcome[] = [];
    for (const [i, tab] of order.entries()) {
      if (stop.current) break;
      setProgress({ done: i, total: order.length, current: tab });
      if (demo) {
        await wait(200);
        out.push({ tab, ok: true, message: '', result: null });
        continue;
      }
      const mine: Record<string, ConflictChoice> = {};
      for (const c of view.conflicts) if (c.tab === tab) mine[c.id] = choices[c.id] ?? 'keep';
      try {
        const r = await importHistoryMonth(form({ tab, choices: JSON.stringify(mine) }));
        if (r.ok && r.result)
          out.push({
            tab,
            ok: r.result.ok,
            message: r.result.errors.join(' '),
            result: r.result,
          });
        else
          out.push({
            tab,
            ok: false,
            message: r.message ?? 'Not imported.',
            result: r.result ?? null,
          });
      } catch {
        out.push({
          tab,
          ok: false,
          message: 'The connection stopped. Run it again to continue.',
          result: null,
        });
      }
    }
    setProgress({ done: out.length, total: order.length, current: '' });
    setOutcomes(out);
    setStage('done');
    if (!demo) {
      try {
        await finishHistory();
      } catch {
        // the figures refresh on the next visit
      }
      router.refresh();
    }
  }

  const picked = view ? conflictsOf(view, selected) : [];
  const sum = (f: (r: MonthResult) => number) =>
    outcomes.reduce((s, o) => s + (o.result ? f(o.result) : 0), 0);
  const failed = outcomes.filter((o) => !o.ok);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const busy = stage === 'reading' || stage === 'importing';

  return (
    <div className="hist" aria-busy={busy}>
      <p className="muted small">
        Reads every tab named like a month, in any order, and shows what importing each would do.
        Nothing is saved until you press <strong>Import the selected months</strong>. Values are
        only ever added, never changed; the file is read in memory and not kept.
      </p>
      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => void read(overrides)}
          data-testid="hist-read"
        >
          {stage === 'reading'
            ? 'Reading every tab…'
            : view
              ? 'Read the tabs again'
              : 'Read every tab (nothing is saved)'}
        </button>
      </div>

      {error && (
        <p className="notice warn" role="alert">
          {error}
        </p>
      )}

      {view && (
        <>
          <p className="hist-headline" role="status" data-testid="hist-headline">
            {headline(view.summary)}
          </p>

          <table className="tbl lines responsive hist-table" data-testid="hist-months">
            <thead>
              <tr>
                <th>
                  <span className="sr-only">Import</span>
                </th>
                <th>Tab</th>
                <th>As of</th>
                <th className="num">Rows read</th>
                <th className="num">On file</th>
                <th className="num">To add</th>
                <th className="num">Not matched</th>
                <th>Check against the tab&rsquo;s own total</th>
              </tr>
            </thead>
            <tbody>
              {view.months.map((m) => {
                const chk = checkText(m);
                const when = asOfText(m);
                const choices_ = dateChoices(m);
                const on = selected.has(m.tab);
                return (
                  <tr key={m.tab} className={`hist-row ${on ? 'on' : ''}`}>
                    <td data-label="Import">
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={busy || !!m.doubt}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const n = new Set(prev);
                            if (e.target.checked) n.add(m.tab);
                            else n.delete(m.tab);
                            return n;
                          })
                        }
                        aria-label={`Import ${m.tab}`}
                      />
                    </td>
                    <td data-label="Tab">
                      <strong>{m.tab}</strong>
                      {m.copyOf && <span className="hist-tag">Copy of {m.copyOf}</span>}
                      {m.overridden && (
                        <span className="hist-tag">Month chosen: {monthLabel(m.month)}</span>
                      )}
                      {(m.doubt || m.overridden) && (
                        <div className={m.doubt ? 'hist-doubt' : 'hist-fine'}>
                          {m.doubt && <p className="small">{m.doubt.text}</p>}
                          {m.likeTab && m.doubt && (
                            <p className="small muted">Its deposits match {m.likeTab}.</p>
                          )}
                          <label className="small">
                            Which month is this tab really?
                            <select
                              value={overrides[m.tab] ?? ''}
                              disabled={busy}
                              onChange={(e) => chooseMonth(m.tab, e.target.value)}
                            >
                              {choices_.map((c) => (
                                <option key={c.value} value={c.value}>
                                  {c.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      {m.warnings.length > 0 && !m.doubt && (
                        <details className="hist-warn small">
                          <summary>Notes ({m.warnings.length})</summary>
                          <ul>
                            {m.warnings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    <td data-label="As of">
                      {when.date}
                      <span className="hist-src small muted">{when.source}</span>
                    </td>
                    <td className="num" data-label="Rows read">
                      {m.rowsRead}
                    </td>
                    <td className="num" data-label="On file">
                      {m.matched}
                    </td>
                    <td className="num" data-label="To add">
                      {m.created}
                    </td>
                    <td className="num" data-label="Not matched">
                      {m.unmatched}
                    </td>
                    <td data-label="Check">
                      <span
                        className={`hist-check ${m.verdict}`}
                        title={chk.detail}
                        data-testid="hist-check"
                      >
                        <span aria-hidden="true">{chk.mark}</span> {chk.word}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <HistoryIdentities view={view} pins={pins} busy={busy} onPins={choosePins} />

          {picked.length > 0 && (
            <section className="hist-block" aria-labelledby="hist-conf">
              <h3 id="hist-conf">Values that disagree with what is on file ({picked.length})</h3>
              <p className="muted small">
                Nothing is replaced unless you choose the sheet&rsquo;s value. A value on a later
                date is never touched.
              </p>
              <ul className="hist-conflicts">
                {picked.map((c) => (
                  <li key={c.id}>
                    <fieldset>
                      <legend className="small">{conflictText(c)}</legend>
                      <label>
                        <input
                          type="radio"
                          name={`c-${c.id}`}
                          checked={(choices[c.id] ?? 'keep') === 'keep'}
                          onChange={() => setChoices({ ...choices, [c.id]: 'keep' })}
                        />{' '}
                        Keep what is on file
                      </label>
                      <label>
                        <input
                          type="radio"
                          name={`c-${c.id}`}
                          checked={choices[c.id] === 'sheet'}
                          onChange={() => setChoices({ ...choices, [c.id]: 'sheet' })}
                        />{' '}
                        Use the sheet
                      </label>
                    </fieldset>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {view.months.some((m) => m.unmatchedRows.length > 0) && (
            <details className="disclose hist-block">
              <summary>
                Lines that could not be matched (
                {view.months.reduce((s, m) => s + m.unmatchedRows.length, 0)})
              </summary>
              {view.months
                .filter((m) => m.unmatchedRows.length > 0)
                .map((m) => (
                  <div key={m.tab}>
                    <h4>{m.tab}</h4>
                    <ul className="hist-list small">
                      {m.unmatchedRows.map((u) => (
                        <li key={u.cell + u.label}>
                          <span className="hist-cell">{u.cell}</span> {u.label}
                          {u.bank ? `, ${u.bank}` : ''}
                          {u.owner ? ` (${u.owner})` : ''}: {u.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
            </details>
          )}

          {view.historical.some((h) => !h.skipReason) && (
            <details className="disclose hist-block">
              <summary>
                Closed deposits and accounts that would be added (
                {view.historical.filter((h) => !h.skipReason).length})
              </summary>
              <p className="muted small">
                These are in older tabs and not on file. They are added as closed records. The tabs
                never say when a deposit was paid out, so the end date is the first month the tabs
                stop listing it: an estimate you can edit.
              </p>
              <ul className="hist-list small">
                {view.historical
                  .filter((h) => !h.skipReason)
                  .map((h) => (
                    <li key={h.key}>{historicalText(h)}</li>
                  ))}
              </ul>
              {view.renewals.length > 0 && (
                <>
                  <h4>Possible renewals (suggestions only, nothing is linked)</h4>
                  <ul className="hist-list small">
                    {view.renewals.map((r) => (
                      <li key={r.from + r.to}>{r.text}</li>
                    ))}
                  </ul>
                </>
              )}
              {view.historical.some((h) => h.skipReason) && (
                <>
                  <h4>Not added</h4>
                  <ul className="hist-list small">
                    {view.historical
                      .filter((h) => h.skipReason)
                      .map((h) => (
                        <li key={h.key}>
                          {h.bank} ({h.ownerName}): {h.skipReason}
                        </li>
                      ))}
                  </ul>
                </>
              )}
            </details>
          )}

          {view.skipped.length > 0 && (
            <details className="disclose hist-block">
              <summary>Tabs that are not months ({view.skipped.length})</summary>
              <ul className="hist-list small">
                {view.skipped.map((s) => (
                  <li key={s.tab}>
                    <strong>{s.tab}</strong>: {s.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}

          <div className="row hist-go">
            <button
              type="button"
              className="btn primary"
              disabled={busy || selected.size === 0}
              onClick={() => void runImport()}
              data-testid="hist-import"
            >
              {stage === 'importing'
                ? 'Importing…'
                : `Import the selected months (${selected.size})`}
            </button>
            {stage === 'importing' && (
              <button type="button" className="btn ghost" onClick={() => (stop.current = true)}>
                Stop after this month
              </button>
            )}
          </div>

          {(stage === 'importing' || stage === 'done') && (
            <div className="hist-progress" aria-live="polite">
              <div
                className="hist-bar"
                role="progressbar"
                aria-label="Months imported"
                aria-valuemin={0}
                aria-valuemax={progress.total}
                aria-valuenow={progress.done}
              >
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="small" data-testid="hist-progress">
                {stage === 'importing'
                  ? `Importing ${progress.current || '…'} (${Math.min(progress.done + 1, progress.total)} of ${progress.total})`
                  : `${progress.done} of ${progress.total} months done`}
              </p>
            </div>
          )}

          {stage === 'done' && (
            <div
              className={`notice ${failed.length ? 'warn' : 'ok'}`}
              role="status"
              data-testid="hist-result"
            >
              {demo ? (
                <p>
                  This is a sample: {outcomes.length} month{outcomes.length === 1 ? '' : 's'} were
                  acted out and nothing was saved anywhere.
                </p>
              ) : (
                <p>
                  {resultText({
                    months: outcomes.length,
                    failed: failed.length,
                    observations: sum((r) => r.observations),
                    addedAssets: sum((r) => r.addedAssets),
                    checks: sum((r) => r.checks),
                    identical: sum((r) => r.identical),
                    conflictsReplaced: sum((r) => r.conflictsReplaced),
                    conflictsKept: sum((r) => r.conflictsKept),
                  })}
                </p>
              )}
              {failed.length > 0 && (
                <ul className="small">
                  {failed.map((f) => (
                    <li key={f.tab}>
                      <strong>{f.tab}</strong>: {f.message || 'Not finished.'}
                    </li>
                  ))}
                </ul>
              )}
              {failed.length > 0 && (
                <p className="small">
                  Press <strong>Import the selected months</strong> again: months already in are
                  skipped and the rest continue.
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
