'use client';

import { useState, useTransition } from 'react';
import type { PersonStyle } from '@fwos/core';
import { PersonBadge } from './Person';

export interface ReorderRow {
  id: string;
  /** the sheet-style code, e.g. FD-NRE-5076 */
  code: string;
  ownerId: string;
}
export interface ReorderBank {
  key: string;
  name: string;
  rows: ReorderRow[];
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (from === to || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x!);
  return next;
}

/**
 * Banks and the rows inside them, in the order the Accounts and Monthly screens use. Reorder with drag and drop or with the
 * Move buttons (which work from the keyboard and screen readers); Save writes the whole order at once.
 */
export function ReorderList({
  banks: initial,
  styles,
  save,
}: {
  banks: ReorderBank[];
  styles: Record<string, PersonStyle>;
  /** saves the ordered asset ids; absent on the public sample, which saves nothing */
  save?: (ids: string[]) => Promise<{ ok: boolean; message: string }>;
}) {
  const [banks, setBanks] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [said, setSaid] = useState('');
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, start] = useTransition();

  const change = (next: ReorderBank[], announce: string) => {
    setBanks(next);
    setDirty(true);
    setResult(null);
    setSaid(announce);
  };
  const moveBank = (i: number, to: number) => {
    if (to < 0 || to >= banks.length) return;
    change(move(banks, i, to), `${banks[i]!.name} moved to position ${to + 1} of ${banks.length}.`);
  };
  const moveRow = (bi: number, ri: number, to: number) => {
    const b = banks[bi]!;
    if (to < 0 || to >= b.rows.length) return;
    change(
      banks.map((x, k) => (k === bi ? { ...x, rows: move(x.rows, ri, to) } : x)),
      `${b.rows[ri]!.code} in ${b.name} moved to position ${to + 1} of ${b.rows.length}.`,
    );
  };

  const onSave = () =>
    start(async () => {
      const ids = banks.flatMap((b) => b.rows.map((r) => r.id));
      if (!save) {
        setResult({
          ok: false,
          message: 'This is a sample: nothing is saved. Sign in to change your own order.',
        });
        return;
      }
      const r = await save(ids);
      setResult(r);
      if (r.ok) setDirty(false);
    });

  // drag and drop: a bank can be dropped on another bank, a row on another row of the same bank
  const [drag, setDrag] = useState<
    { kind: 'bank'; i: number } | { kind: 'row'; bi: number; ri: number } | null
  >(null);
  const over = (e: React.DragEvent) => {
    if (drag) e.preventDefault();
  };

  return (
    <div className="reorder">
      <p className="sr-only" role="status" aria-live="polite">
        {said}
      </p>
      <ol className="reorder-banks">
        {banks.map((b, bi) => (
          <li
            key={b.key}
            className="reorder-bank"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', b.key);
              setDrag({ kind: 'bank', i: bi });
            }}
            onDragOver={over}
            onDrop={(e) => {
              if (drag?.kind === 'bank') {
                e.preventDefault();
                moveBank(drag.i, bi);
              }
              setDrag(null);
            }}
            onDragEnd={() => setDrag(null)}
          >
            <div className="reorder-head">
              <span className="grip" aria-hidden title="Drag to move">
                ⠿
              </span>
              <strong>{b.name}</strong>
              <span className="muted small">
                {b.rows.length} row{b.rows.length === 1 ? '' : 's'}
              </span>
              <span className="reorder-buttons">
                <button
                  type="button"
                  className="btn compact"
                  onClick={() => moveBank(bi, bi - 1)}
                  disabled={bi === 0}
                  aria-label={`Move ${b.name} up`}
                >
                  ↑ Up
                </button>
                <button
                  type="button"
                  className="btn compact"
                  onClick={() => moveBank(bi, bi + 1)}
                  disabled={bi === banks.length - 1}
                  aria-label={`Move ${b.name} down`}
                >
                  ↓ Down
                </button>
              </span>
            </div>
            <details>
              <summary className="small">Rows in this bank ({b.rows.length})</summary>
              <ol className="reorder-rows">
                {b.rows.map((r, ri) => (
                  <li
                    key={r.id}
                    className="reorder-row"
                    draggable
                    onDragStart={(e) => {
                      e.stopPropagation();
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', r.id);
                      setDrag({ kind: 'row', bi, ri });
                    }}
                    onDragOver={over}
                    onDrop={(e) => {
                      e.stopPropagation();
                      if (drag?.kind === 'row' && drag.bi === bi) {
                        e.preventDefault();
                        moveRow(bi, drag.ri, ri);
                      }
                      setDrag(null);
                    }}
                    onDragEnd={() => setDrag(null)}
                  >
                    <span className="grip" aria-hidden title="Drag to move">
                      ⠿
                    </span>
                    <PersonBadge p={styles[r.ownerId]} name size={18} />
                    <span className="kind code">{r.code}</span>
                    <span className="reorder-buttons">
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => moveRow(bi, ri, ri - 1)}
                        disabled={ri === 0}
                        aria-label={`Move ${r.code} in ${b.name} up`}
                      >
                        ↑
                      </button>
                      <button
                        type="button"
                        className="btn compact"
                        onClick={() => moveRow(bi, ri, ri + 1)}
                        disabled={ri === b.rows.length - 1}
                        aria-label={`Move ${r.code} in ${b.name} down`}
                      >
                        ↓
                      </button>
                    </span>
                  </li>
                ))}
              </ol>
            </details>
          </li>
        ))}
      </ol>
      <div className="row" style={{ alignItems: 'center' }}>
        <button
          type="button"
          className="btn primary"
          onClick={onSave}
          disabled={pending || (!dirty && !!save)}
        >
          {pending ? 'Saving…' : 'Save this order'}
        </button>
        {result && (
          <span
            className={result.ok ? 'ok small' : 'fail small'}
            role={result.ok ? 'status' : 'alert'}
          >
            {result.message}
          </span>
        )}
        {dirty && !result && <span className="muted small">Not saved yet.</span>}
      </div>
    </div>
  );
}
