'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from 'react';
import {
  bankStyle,
  formatInr,
  rowState,
  standings as buildStandings,
  summarizeStandings,
  type BankBlock,
  type BankRow,
  type PersonStyle,
} from '@fwos/core';
import { saveMonthly } from '@/app/(app)/monthly/actions';
import { AccordionControls } from './AccordionControls';
import { BankBadge } from './BankBadge';
import { BankStatusBoard } from './BankStatusBoard';
import { PersonBadge } from './Person';
import { UpdatedCell, fmtDate, pctText } from './BankTable';
import { AddButton, EditButton } from './QuickEdit';
import {
  buildGridChanges,
  carryForward,
  changeHint,
  spreadPaste,
  type CarryRow,
  type GridEdit,
  type GridRowInfo,
} from '@/lib/update-grid';
import { slugify } from '@/lib/slug';
import './datain.css';

const FD_STATUS = [
  ['active', 'Running'],
  ['closed', 'Matured, paid out'],
  ['renewed', 'Renewed'],
] as const;

const money = (v: number | null) => (v === null ? '–' : formatInr(Math.round(v)));
const own = (r: BankRow, v: number | null) =>
  v === null
    ? '–'
    : r.currency === 'INR'
      ? formatInr(Math.round(v))
      : `${r.currency} ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function info(r: BankRow): GridRowInfo {
  return {
    id: r.assetId,
    kind: r.kind,
    currency: r.currency,
    notes: r.notes ?? '',
    status: r.status,
    fd: r.fd
      ? { ratePct: String(Math.round(r.fd.rate * 1e6) / 1e4), maturityAmount: r.fd.maturityAmount }
      : null,
  };
}

/**
 * The monthly sheet. A summary at the top says which banks are up to date and how each latest value arrived; below it every
 * bank in your order, with the balances you type first and the deposits (valued from their terms) tucked underneath.
 * Enter moves down, a pasted column from Excel fills the boxes below, "Same" and "Nothing changed" carry the last balance
 * forward. Nothing is saved until you press Save.
 */
export function UpdateGrid({
  blocks,
  styles,
  today,
  fxHint,
  institutions,
  summary = true,
}: {
  blocks: BankBlock[];
  styles: Record<string, PersonStyle>;
  today: string;
  fxHint: Record<string, number>;
  institutions: boolean;
  /** show the "where each bank stands" board (off on the single-bank page) */
  summary?: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, GridEdit>>({});
  const [asOf, setAsOf] = useState(today);
  const [onlyWaiting, setOnlyWaiting] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const stands = useMemo(() => buildStandings(blocks, today), [blocks, today]);
  const sum = useMemo(() => summarizeStandings(stands), [stands]);
  const standOf = useMemo(() => new Map(stands.map((s) => [s.key, s])), [stands]);
  const [open, setOpen] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(
      blocks.map((b) => [b.key, blocks.length === 1 || standOf.get(b.key)?.state !== 'current']),
    ),
  );
  const set = (id: string, patch: GridEdit) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const rows = useMemo(() => blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)), [blocks]);
  const infos = useMemo(() => rows.map(info), [rows]);
  const carryRows: CarryRow[] = useMemo(
    () =>
      rows.map((r) => ({ id: r.assetId, kind: r.kind, status: r.status, recorded: r.recorded })),
    [rows],
  );
  const { changes, errors } = useMemo(
    () => buildGridChanges(infos, edits, asOf, today, fxHint),
    [infos, edits, asOf, today, fxHint],
  );
  const monthLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

  const idsOf = (key: string) =>
    new Set(
      blocks.find((b) => b.key === key)?.sections.flatMap((s) => s.rows.map((r) => r.assetId)) ??
        [],
    );
  const sameCount = (key: string) => carryForward(carryRows, edits, idsOf(key)).filled;
  function sameBank(key: string) {
    const r = carryForward(carryRows, edits, idsOf(key));
    setEdits(r.edits);
    setOpen((o) => ({ ...o, [key]: true }));
    setMsg(
      r.filled > 0
        ? {
            ok: true,
            text: `${r.filled} balance${r.filled === 1 ? '' : 's'} carried forward with the date above. Press Save to keep them.`,
          }
        : null,
    );
  }
  function jump(key: string) {
    setOpen((o) => ({ ...o, [key]: true }));
    requestAnimationFrame(() => {
      const el = document.getElementById(slugify(blocks.find((b) => b.key === key)?.name ?? ''));
      el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el?.querySelector<HTMLInputElement>('input[data-bal]')?.focus({ preventScroll: true });
    });
  }

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveMonthly(changes);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setEdits({});
    });
  }

  // Enter and the arrow keys move between the visible balance boxes; a pasted column from Excel fills the boxes below
  const visibleBoxes = () =>
    [...document.querySelectorAll<HTMLInputElement>('input[data-bal]')].filter(
      (b) => b.offsetParent !== null,
    );
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = e.key === 'Enter' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!move) return;
    e.preventDefault();
    const all = visibleBoxes();
    const next = all[all.indexOf(e.currentTarget) + move];
    if (next) {
      next.focus();
      next.select();
    } else if (move === 1) document.getElementById('save-all')?.focus();
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, id: string) => {
    const boxes = visibleBoxes().map((b) => ({ id: b.dataset.id ?? '' }));
    const next = spreadPaste(e.clipboardData.getData('text'), boxes, id, edits);
    if (!next) return;
    e.preventDefault();
    setEdits(next);
  };

  const shownBlocks = blocks.filter(
    (b) =>
      !onlyWaiting ||
      standOf.get(b.key)?.state !== 'current' ||
      b.sections.some((s) => s.rows.some((r) => edits[r.assetId])),
  );
  const mixedStates = sum.current > 0 && sum.current < sum.banks;

  // plain functions, not components: a component defined here would be rebuilt on every keystroke and lose the cursor
  function balanceRow(r: BankRow, bank: string, ownerName: string) {
    const e = edits[r.assetId] ?? {};
    const st = rowState(r, today);
    const hint = changeHint(r.recorded, e.amount, r.currency);
    const edited = e.amount !== undefined && e.amount.trim() !== '';
    return (
      <tr
        key={r.assetId}
        className={`urow ${st === 'waiting' || st === 'missing' ? 'wait' : ''} ${edited ? 'edited' : ''} ${st === 'closed' ? 'dim' : ''}`}
      >
        <td className="acct">
          <div className="code">
            <span className={`kind ${r.kind}`}>{r.code}</span>
            <EditButton id={r.assetId} name={r.code} />
          </div>
          {r.kind === 'held' && r.holderName && <div className="sub">held by {r.holderName}</div>}
          {r.notes && <div className="sub">{r.notes}</div>}
          {errors[r.assetId] && (
            <div className="small fail" role="alert">
              {errors[r.assetId]}
            </div>
          )}
        </td>
        <td className="lastcell" data-label="Last value">
          <div className="amt">{own(r, r.recorded)}</div>
          <UpdatedCell asOf={r.asOf} source={r.source} olderEmail={r.olderEmail ?? null} />
          {(st === 'waiting' || st === 'missing') && (
            <span className="statuspill warn">
              {st === 'missing' ? 'No value yet' : 'Needs this month’s value'}
            </span>
          )}
        </td>
        <td className="newcell" data-label="New balance">
          <div className="newbal">
            <input
              className="bal"
              data-bal
              data-id={r.assetId}
              inputMode="decimal"
              autoComplete="off"
              aria-label={`New balance for ${bank} ${ownerName} ${r.code}`}
              placeholder={r.recorded === null ? 'New balance' : String(Math.round(r.recorded))}
              value={e.amount ?? ''}
              onChange={(ev) => set(r.assetId, { amount: ev.target.value })}
              onKeyDown={onKey}
              onPaste={(ev) => onPaste(ev, r.assetId)}
            />
            {r.currency !== 'INR' && (
              <input
                className="bal fx"
                inputMode="decimal"
                aria-label={`${r.currency} to INR rate for ${r.code}`}
                placeholder={
                  fxHint[r.currency]
                    ? `₹ per ${r.currency} ${fxHint[r.currency]}`
                    : `${r.currency}→INR`
                }
                value={e.fx ?? ''}
                onChange={(ev) => set(r.assetId, { fx: ev.target.value })}
              />
            )}
            {r.recorded !== null && st !== 'closed' && (
              <button
                type="button"
                className="btn compact"
                onClick={() => set(r.assetId, { amount: String(r.recorded) })}
                title={`Same as last: ${own(r, r.recorded)}`}
                aria-label={`Same as last for ${r.code}: ${own(r, r.recorded)}`}
              >
                Same
              </button>
            )}
            {hint && <span className={`delta ${hint.warn ? 'warn' : ''}`}>{hint.text}</span>}
          </div>
        </td>
      </tr>
    );
  }

  function depositRow(r: BankRow) {
    const e = edits[r.assetId] ?? {};
    const fd = r.fd!;
    return (
      <tr
        key={r.assetId}
        className={`urow ${fd.listState === 'hidden' || (r.status !== 'active' && fd.listState !== 'confirm') ? 'dim' : ''}`}
      >
        <td className="acct">
          <div className="code">
            <span className={`kind ${r.kind}`}>{r.code}</span>
            <EditButton id={r.assetId} name={r.code} />
          </div>
          {fd.linkedTo && <div className="sub">↳ {fd.linkedTo}</div>}
          {fd.refLast4 && <div className="sub">FD no. {fd.ref ?? `…${fd.refLast4}`}</div>}
          {errors[r.assetId] && (
            <div className="small fail" role="alert">
              {errors[r.assetId]}
            </div>
          )}
        </td>
        <td className="num" data-label="Rate">
          {pctText(fd.rate)}
        </td>
        <td className="num" data-label="Matures">
          {fmtDate(fd.maturityOn)}
          {fd.needsConfirmation && <div className="small fail">matured</div>}
        </td>
        <td className="num" data-label="Invested">
          {money(fd.principal)}
        </td>
        <td className="num" data-label="At maturity">
          {money(fd.maturityAmount)}
        </td>
        <td className="num" data-label="Worth today">
          {fd.needsConfirmation ? (
            <span
              className="muted"
              title="Counted in the savings account or a new deposit once you record it"
            >
              {money(fd.maturityAmount)}
              <div className="small">matured, not counted</div>
            </span>
          ) : (
            money(r.current)
          )}
        </td>
        <td className="wide" data-label="Status">
          <select
            className="mini"
            aria-label={`Status of ${r.code}`}
            value={e.status ?? (fd.needsConfirmation ? 'matured_unconfirmed' : r.status)}
            onChange={(ev) => set(r.assetId, { status: ev.target.value })}
          >
            {fd.needsConfirmation && (
              <option value="matured_unconfirmed">Matured: say where it went</option>
            )}
            {FD_STATUS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </td>
      </tr>
    );
  }

  return (
    <>
      {summary && blocks.length > 1 && (
        <BankStatusBoard
          standings={stands}
          summary={sum}
          monthLabel={monthLabel}
          onJump={jump}
          onSame={sameBank}
          sameCount={sameCount}
        />
      )}

      <div className="card gridbar">
        <label className="inline">
          Balances as of
          <input
            type="date"
            value={asOf}
            max={today}
            onChange={(e) => setAsOf(e.target.value || today)}
          />
        </label>
        {mixedStates && blocks.length > 1 && (
          <label className="check">
            <input
              type="checkbox"
              checked={onlyWaiting}
              onChange={(e) => setOnlyWaiting(e.target.checked)}
            />{' '}
            Only banks still waiting
          </label>
        )}
      </div>

      {blocks.length > 1 && <AccordionControls />}
      {shownBlocks.map((b) => {
        const st = standOf.get(b.key)!;
        const slug = slugify(b.name);
        const n = sameCount(b.key);
        return (
          <section
            className="card xlbank"
            key={b.key}
            id={slug}
            style={{ ['--bank' as string]: bankStyle(b.name).colour }}
          >
            <details
              open={open[b.key] ?? true}
              onToggle={(e) => {
                const o = e.currentTarget.open;
                setOpen((s) => (s[b.key] === o ? s : { ...s, [b.key]: o }));
              }}
              className="bankdet"
            >
              <summary className="xlhead">
                <BankBadge name={b.name} />
                <h2>{b.name}</h2>
                <span className="tot">
                  <b className="num big">{money(b.totals.current)}</b>
                </span>
                {st.state === 'current' ? (
                  <span className="statuspill ok">
                    Up to date{st.lastUpdated ? ` · ${fmtDate(st.lastUpdated)}` : ''}
                  </span>
                ) : st.state === 'waiting' ? (
                  <span className="statuspill warn">{st.waiting} waiting for a value</span>
                ) : (
                  <span className="statuspill bad">
                    {st.depositsToConfirm > 0 && st.waiting === 0
                      ? 'Deposit to confirm'
                      : 'Needs you'}
                  </span>
                )}
              </summary>
              <div className="banktools">
                {n > 0 && st.state !== 'current' && (
                  <button
                    type="button"
                    className="btn compact"
                    onClick={() => sameBank(b.key)}
                    title="Fills each box below with its last balance, dated with the date above. Nothing is saved until you press Save."
                  >
                    Nothing changed at {b.name}
                  </button>
                )}
                {blocks.length > 1 && (
                  <Link className="btn compact ghost grow" href={`/monthly/${slug}`}>
                    Open this bank alone
                  </Link>
                )}
              </div>
              {(() => {
                const personBal = b.sections
                  .map((sct) => ({ sct, rows: sct.rows.filter((r) => r.kind !== 'fd') }))
                  .filter((x) => x.rows.length > 0);
                const personDeps = b.sections
                  .map((sct) => ({ sct, rows: sct.rows.filter((r) => r.kind === 'fd') }))
                  .filter((x) => x.rows.length > 0);
                const nDeps = personDeps.reduce((a, x) => a + x.rows.length, 0);
                const toConfirm = personDeps.some((x) =>
                  x.rows.some((d) => d.fd?.needsConfirmation),
                );
                const cols = 3;
                return (
                  <>
                    {personBal.length > 0 && (
                      <div className="upd2wrap">
                        <table className="upd2">
                          <thead>
                            <tr>
                              <th>Account</th>
                              <th>Last value</th>
                              <th className="num">New balance</th>
                            </tr>
                          </thead>
                          {personBal.map(({ sct, rows: rs }) => (
                            <tbody
                              key={sct.ownerId}
                              style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                            >
                              <tr className="secthead">
                                <th colSpan={cols}>
                                  <PersonBadge p={styles[sct.ownerId]} name size={18} />
                                </th>
                              </tr>
                              {rs.map((r) =>
                                balanceRow(r, b.name, styles[sct.ownerId]?.name ?? ''),
                              )}
                            </tbody>
                          ))}
                        </table>
                      </div>
                    )}
                    {nDeps > 0 && (
                      <details className="bankdep" open={toConfirm || undefined}>
                        <summary>
                          {nDeps} deposit{nDeps === 1 ? '' : 's'}: worked out from their terms,
                          nothing to type
                          {toConfirm && (
                            <span className="statuspill bad" style={{ marginLeft: 8 }}>
                              matured: say where it went
                            </span>
                          )}
                        </summary>
                        <div className="upd2wrap">
                          <table className="upd2 deps">
                            <thead>
                              <tr>
                                <th>Deposit</th>
                                <th className="num">Rate</th>
                                <th className="num">Matures</th>
                                <th className="num">Invested</th>
                                <th className="num">At maturity</th>
                                <th className="num">Worth today</th>
                                <th>Status</th>
                              </tr>
                            </thead>
                            {personDeps.map(({ sct, rows: rs }) => (
                              <tbody
                                key={sct.ownerId}
                                style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                              >
                                <tr className="secthead">
                                  <th colSpan={7}>
                                    <PersonBadge p={styles[sct.ownerId]} name size={18} />
                                  </th>
                                </tr>
                                {rs.map((r) => depositRow(r))}
                              </tbody>
                            ))}
                          </table>
                        </div>
                      </details>
                    )}
                    {institutions && b.key !== '__none' && (
                      <div className="addcell">
                        {b.sections.map((sct) => (
                          <div key={sct.ownerId}>
                            <AddButton
                              className="linkbtn"
                              label={`+ Add a deposit or account for ${styles[sct.ownerId]?.name ?? ''}`.trim()}
                              preset={{ ownerId: sct.ownerId, institutionId: b.key }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </details>
          </section>
        );
      })}

      <div className="card savebar" role="region" aria-label="Save">
        <span className={msg ? (msg.ok ? 'ok' : 'fail') : 'muted'} role="status" aria-live="polite">
          {msg
            ? msg.text
            : changes.length === 0
              ? 'No changes yet. Type a balance, or use Same / Nothing changed.'
              : `${changes.length} change${changes.length === 1 ? '' : 's'} ready to save`}
        </span>
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
        <button
          id="save-all"
          className="btn primary"
          disabled={pending || changes.length === 0 || Object.keys(errors).length > 0}
          onClick={save}
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
      </div>
      <p className="muted small">
        Everything saved here feeds the whole app: Accounts, Home, tax, reminders. Earlier values
        stay as history. Funds and anything that arrives by email update by themselves.{' '}
        <Link href="/monthly?tab=other">Property, ULIP, loans and other items</Link>
      </p>
    </>
  );
}
