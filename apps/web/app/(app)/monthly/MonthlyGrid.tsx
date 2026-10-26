'use client';

import { Fragment, useMemo, useRef, useState, useTransition } from 'react';
import { formatInr } from '@fwos/core';
import { FD_STATUSES, buildChanges, type GridRow, type RowEdit } from '@/lib/monthly';
import { UpdatedCell } from '@/components/BankTable';
import { saveMonthly, type SaveResult } from './actions';

const FRESH_LABEL: Record<string, string> = {
  current: 'Current',
  older_than_expected: 'Older than expected',
  stale: 'Stale',
  missing: 'No value yet',
  imported_unverified: 'Imported, unverified',
  calculated: 'Calculated',
};

function money(row: GridRow, v: number | null) {
  if (v === null) return '—';
  return row.currency === 'INR'
    ? formatInr(v, { decimals: v % 1 ? 2 : 0 })
    : `${row.currency} ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function MonthlyGrid({
  rows,
  today,
  assumedRate,
}: {
  rows: GridRow[];
  today: string;
  /** the savings rate assumed when none is set (Settings), as a fraction */
  assumedRate?: number;
}) {
  const [edits, setEdits] = useState<Record<string, RowEdit>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();
  const amountRefs = useRef<(HTMLInputElement | null)[]>([]);

  const { changes, errors } = useMemo(() => buildChanges(rows, edits, today), [rows, edits, today]);
  const valueRows = rows.filter((r) => r.mode === 'value');
  const set = (id: string, patch: RowEdit) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));

  function focusRow(i: number) {
    const el = amountRefs.current[Math.max(0, Math.min(valueRows.length - 1, i))];
    el?.focus();
    el?.select();
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>, startIndex: number) {
    const text = e.clipboardData.getData('text/plain');
    const cells = text
      .split(/\r?\n/)
      .map((l) => l.split('\t')[0]!.trim())
      .filter((l, i, a) => l !== '' || i < a.length - 1);
    if (cells.length <= 1) return; // a single value pastes normally
    e.preventDefault();
    setEdits((prev) => {
      const next = { ...prev };
      cells.forEach((c, k) => {
        const target = valueRows[startIndex + k];
        if (target) next[target.id] = { ...next[target.id], amount: c };
      });
      return next;
    });
  }

  function onSave() {
    setResult(null);
    start(async () => {
      const r = await saveMonthly(changes);
      setResult(r);
      if (r.ok) setEdits({});
    });
  }

  let valueIndex = -1;
  let lastGroup = '';
  const nErrors = Object.keys(errors).length;

  return (
    <div>
      <div className="card savebar" role="status" aria-live="polite">
        <strong>{changes.length}</strong> change{changes.length === 1 ? '' : 's'} ready
        {nErrors > 0 && <span className="fail"> · {nErrors} need fixing</span>}
        <button
          className="btn primary"
          onClick={onSave}
          disabled={pending || changes.length === 0 || nErrors > 0}
        >
          {pending ? 'Saving…' : 'Save all'}
        </button>
        {changes.length > 0 && (
          <button
            className="btn ghost"
            type="button"
            onClick={() => setEdits({})}
            disabled={pending}
          >
            Discard
          </button>
        )}
      </div>
      {result && (
        <p className={`notice ${result.ok ? 'ok' : 'warn'}`} role="status">
          {result.message}
        </p>
      )}

      <table className="tbl grid responsive">
        <thead>
          <tr>
            <th>Account</th>
            <th>Last value</th>
            <th className="num">Estimated today</th>
            <th>New value</th>
            <th>As of</th>
            <th>Rate / status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const header = r.group !== lastGroup ? r.group : null;
            lastGroup = r.group;
            const e = edits[r.id] ?? {};
            const idx = r.mode === 'value' ? ++valueIndex : -1;
            return (
              <Fragment key={r.id}>
                {header && (
                  <tr className="grouprow">
                    <th colSpan={6}>{header}</th>
                  </tr>
                )}
                <tr
                  className={
                    errors[r.id]
                      ? 'rowerr'
                      : e.amount || e.status || e.interestRate
                        ? 'rowedit'
                        : ''
                  }
                >
                  <td data-label="Account">
                    <strong>{r.name}</strong>
                    <br />
                    <span className="muted small">
                      {r.owner}
                      {r.fd
                        ? ` · ${(r.fd.rate * 100).toFixed(2)}% · matures ${r.fd.maturityOn}`
                        : ''}
                    </span>
                  </td>
                  <td data-label="Last recorded">
                    {r.fd
                      ? money({ ...r, currency: 'INR' }, r.fd.principal) + ' principal'
                      : money(r, r.latestAmount)}
                    <br />
                    {r.origin ? (
                      <UpdatedCell asOf={r.latestAsOf} source={r.origin} />
                    ) : (
                      <span className="muted small">{r.latestAsOf ?? ''}</span>
                    )}{' '}
                    <span className={`fresh ${r.freshness}`}>{FRESH_LABEL[r.freshness]}</span>
                  </td>
                  <td className="num" data-label="Estimated today">
                    {r.estimatedToday === null ? '—' : formatInr(r.estimatedToday)}
                  </td>
                  {r.mode === 'value' ? (
                    <>
                      <td data-label="New value">
                        <input
                          ref={(el) => {
                            amountRefs.current[idx] = el;
                          }}
                          inputMode="decimal"
                          autoComplete="off"
                          placeholder={r.currency === 'INR' ? '₹ amount' : r.currency}
                          aria-label={`New value for ${r.name}`}
                          value={e.amount ?? ''}
                          onChange={(ev) => set(r.id, { amount: ev.target.value })}
                          onPaste={(ev) => onPaste(ev, idx)}
                          onKeyDown={(ev) => {
                            if (ev.key === 'Enter' || ev.key === 'ArrowDown') {
                              ev.preventDefault();
                              focusRow(idx + 1);
                            } else if (ev.key === 'ArrowUp') {
                              ev.preventDefault();
                              focusRow(idx - 1);
                            }
                          }}
                        />
                        {r.currency !== 'INR' && (
                          <input
                            className="mt"
                            inputMode="decimal"
                            aria-label={`${r.currency} to INR rate for ${r.name}`}
                            placeholder={`₹ per ${r.currency}${r.fxRate ? ` (last ${r.fxRate})` : ''}`}
                            value={e.fxRate ?? ''}
                            onChange={(ev) => set(r.id, { fxRate: ev.target.value })}
                          />
                        )}
                        {errors[r.id] && <span className="fail small">{errors[r.id]}</span>}
                      </td>
                      <td data-label="As of">
                        <input
                          type="date"
                          max={today}
                          aria-label={`Date for ${r.name}`}
                          value={e.asOf ?? ''}
                          onChange={(ev) => set(r.id, { asOf: ev.target.value })}
                          placeholder={today}
                        />
                      </td>
                      <td data-label="Rate">
                        {r.type === 'bank_account' && r.currency === 'INR' ? (
                          <input
                            inputMode="decimal"
                            aria-label={`Annual interest % for ${r.name}`}
                            placeholder={
                              r.interestRate === null
                                ? assumedRate === undefined
                                  ? 'bank rate'
                                  : `assumed ${(assumedRate * 100).toFixed(2).replace(/\.?0+$/, '')} %`
                                : `${(r.interestRate * 100).toFixed(2)} %`
                            }
                            value={e.interestRate ?? ''}
                            onChange={(ev) => set(r.id, { interestRate: ev.target.value })}
                          />
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td data-label="New value">
                        <span className="muted small">Valued from its contract</span>
                      </td>
                      <td data-label="As of">
                        <span className="muted small">—</span>
                      </td>
                      <td data-label="Status">
                        <select
                          aria-label={`Status of ${r.name}`}
                          value={e.status ?? r.status}
                          onChange={(ev) => set(r.id, { status: ev.target.value })}
                        >
                          {FD_STATUSES.map(([v, l]) => (
                            <option key={v} value={v}>
                              {l}
                            </option>
                          ))}
                        </select>
                      </td>
                    </>
                  )}
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
