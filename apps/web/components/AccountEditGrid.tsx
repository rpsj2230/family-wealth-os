'use client';

import { Fragment, useMemo, useState, useTransition } from 'react';
import type { PersonStyle } from '@fwos/core';
import {
  KINDS,
  STATUSES,
  diffRow,
  rowProblems,
  suggestKinds,
  swapNames,
  type EditRow,
} from '@/lib/account-edit';
import '@/app/accounts-edit.css';

export type GridRow = EditRow & { code: string };
export interface GridBank {
  key: string;
  name: string;
  rows: GridRow[];
}
export interface SaveResult {
  ok: boolean;
  message: string;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  matured: 'Matured',
  matured_unconfirmed: 'Matured, not confirmed',
  renewed: 'Renewed',
  closed: 'Closed',
  stopped: 'Stopped',
};

/**
 * Every account and deposit, bank by bank in your sheet's order, with the fields that can be wrong: type (NRE, NRO…), joint,
 * last four digits, label, note, person, bank, status and a deposit's terms. Rows you change are marked; nothing is saved until
 * you press Save. Balances are not here: they change only through the monthly update.
 */
export function AccountEditGrid({
  banks,
  owners,
  institutions,
  styles,
  save,
}: {
  banks: GridBank[];
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  save?: (rows: Record<string, unknown>[]) => Promise<SaveResult>;
}) {
  const initial = useMemo(
    () => Object.fromEntries(banks.flatMap((b) => b.rows).map((r) => [r.id, r as EditRow])),
    [banks],
  );
  const codes = useMemo(
    () => Object.fromEntries(banks.flatMap((b) => b.rows).map((r) => [r.id, r.code])),
    [banks],
  );
  const [was, setWas] = useState<Record<string, EditRow>>(initial);
  const [rows, setRows] = useState<Record<string, EditRow>>(initial);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [proposed, setProposed] = useState<Set<string>>(new Set());
  const [moveTo, setMoveTo] = useState('');
  const [msg, setMsg] = useState<SaveResult | null>(null);
  const [pending, start] = useTransition();

  const all = useMemo(
    () => banks.flatMap((b) => b.rows.map((r) => rows[r.id] ?? r)),
    [banks, rows],
  );
  const diffs = useMemo(
    () =>
      all.map((r) => ({ r, d: diffRow(r, was[r.id]!) })).filter((x) => x.d !== null) as {
        r: EditRow;
        d: Record<string, unknown>;
      }[],
    [all, was],
  );
  const problems = useMemo(() => Object.fromEntries(all.map((r) => [r.id, rowProblems(r)])), [all]);
  const changedIds = new Set(diffs.map((x) => x.r.id));
  const badCount = diffs.filter((x) => (problems[x.r.id] ?? []).length > 0).length;

  const set = (id: string, patch: Partial<EditRow>) => {
    setMsg(null);
    setRows((m) => ({ ...m, [id]: { ...m[id]!, ...patch } }));
    if ('accountKind' in patch)
      setProposed((p) => (p.has(id) ? new Set([...p].filter((x) => x !== id)) : p));
  };
  const toggle = (ids: string[], on: boolean) =>
    setPicked((p) => {
      const n = new Set(p);
      ids.forEach((i) => (on ? n.add(i) : n.delete(i)));
      return n;
    });
  const bulk = (patch: Partial<EditRow>) => [...picked].forEach((id) => set(id, patch));

  const suggest = () => {
    const s = suggestKinds(all);
    const ids = Object.keys(s);
    setMsg(null);
    setRows((m) => {
      const n = { ...m };
      for (const id of ids) n[id] = { ...n[id]!, accountKind: s[id]! };
      return n;
    });
    setProposed(new Set(ids));
    if (ids.length === 0)
      setMsg({
        ok: true,
        message: 'Nothing to suggest: every row has a type, or the evidence disagrees.',
      });
  };

  const doSave = () =>
    start(async () => {
      if (!save) {
        setMsg({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      const res = await save(diffs.map((x) => x.d));
      setMsg(res);
      if (res.ok) {
        setWas(rows);
        setProposed(new Set());
        setPicked(new Set());
      }
    });
  const discard = () => {
    setRows(was);
    setProposed(new Set());
    setMsg(null);
  };

  const col = (
    r: EditRow,
    k: keyof EditRow,
    label: string,
    cls: string,
    props: {
      type?: string;
      placeholder?: string;
      disabled?: boolean;
      inputMode?: 'numeric' | 'decimal';
    } = {},
  ) => (
    <td className={cls}>
      <input
        value={String(r[k] ?? '')}
        onChange={(e) => set(r.id, { [k]: e.target.value } as Partial<EditRow>)}
        aria-label={`${label}, ${codes[r.id]}`}
        type={props.type ?? 'text'}
        inputMode={props.inputMode}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
    </td>
  );

  return (
    <div className="aeg" aria-busy={pending}>
      <div className="card aeg-tools" role="toolbar" aria-label="Change many rows at once">
        <b>{picked.size} selected</b>
        <span className="sep" aria-hidden />
        <span className="small muted">Type</span>
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="btn compact"
            disabled={picked.size === 0}
            onClick={() => bulk({ accountKind: k })}
          >
            {k}
          </button>
        ))}
        <button
          type="button"
          className="btn compact ghost"
          disabled={picked.size === 0}
          onClick={() => bulk({ accountKind: '' })}
        >
          No type
        </button>
        <span className="sep" aria-hidden />
        <button
          type="button"
          className="btn compact"
          disabled={picked.size === 0}
          onClick={() => bulk({ isJoint: true })}
        >
          Mark joint
        </button>
        <button
          type="button"
          className="btn compact"
          disabled={picked.size === 0}
          onClick={() => bulk({ isJoint: false })}
        >
          Not joint
        </button>
        <span className="sep" aria-hidden />
        <label className="small">
          <span className="sr-only">Move to bank</span>
          <select
            value={moveTo}
            onChange={(e) => setMoveTo(e.target.value)}
            aria-label="Move the selected rows to bank"
          >
            <option value="">Move to bank…</option>
            {institutions.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn compact"
          disabled={picked.size === 0 || !moveTo}
          onClick={() => bulk({ institutionId: moveTo })}
        >
          Move
        </button>
        <span className="sep" aria-hidden />
        <button type="button" className="btn compact primary" onClick={suggest}>
          Suggest types for empty rows
        </button>
        {picked.size > 0 && (
          <button type="button" className="btn compact ghost" onClick={() => setPicked(new Set())}>
            Clear selection
          </button>
        )}
      </div>

      {banks.map((b) => {
        const ids = b.rows.map((r) => r.id);
        const allOn = ids.length > 0 && ids.every((i) => picked.has(i));
        return (
          <section className="card aeg-bank" key={b.key} aria-label={b.name}>
            <header>
              <label className="check">
                <input
                  type="checkbox"
                  checked={allOn}
                  onChange={(e) => toggle(ids, e.target.checked)}
                  aria-label={`Select all in ${b.name}`}
                />
                <h2>{b.name}</h2>
              </label>
              <span className="small muted">{b.rows.length} rows</span>
            </header>
            <div
              className="aeg-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${b.name} accounts, scrolls sideways`}
            >
              <table className="aeg-table" data-notools>
                <thead>
                  <tr>
                    <th className="c-mark" aria-label="Changed" />
                    <th className="c-sel" aria-label="Select" />
                    <th className="c-person">Person</th>
                    <th className="c-label">Account</th>
                    <th className="c-type">Type</th>
                    <th className="c-joint">Joint</th>
                    <th className="c-d4">Last-4</th>
                    <th className="c-d4">Linked to</th>
                    <th className="c-rate">Rate %</th>
                    <th className="c-date">Start</th>
                    <th className="c-date">Maturity</th>
                    <th className="c-amt">Invested</th>
                    <th className="c-amt">At maturity</th>
                    <th className="c-d4">FD no.</th>
                    <th className="c-notes">Notes</th>
                    <th className="c-status">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((r0) => {
                    const r = rows[r0.id] ?? r0;
                    const fd = r.kind === 'fd';
                    const bad = problems[r.id] ?? [];
                    const cls = [
                      proposed.has(r.id)
                        ? 'aeg-proposed'
                        : changedIds.has(r.id)
                          ? 'aeg-changed'
                          : '',
                      bad.length ? 'aeg-bad' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <Fragment key={r.id}>
                        <tr className={cls}>
                          <td className="c-mark">
                            {(changedIds.has(r.id) || proposed.has(r.id)) && (
                              <span className="sr-only">
                                {proposed.has(r.id) ? 'suggested change' : 'changed'}
                              </span>
                            )}
                          </td>
                          <td className="c-sel">
                            <input
                              type="checkbox"
                              checked={picked.has(r.id)}
                              onChange={(e) => toggle([r.id], e.target.checked)}
                              aria-label={`Select ${r0.code}`}
                            />
                          </td>
                          <td className="c-person">
                            <select
                              value={r.ownerId}
                              onChange={(e) => set(r.id, { ownerId: e.target.value })}
                              aria-label={`Person, ${r0.code}`}
                            >
                              {owners.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {styles[o.id]?.name ?? o.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          {col(r, 'label', 'Account', 'c-label', { placeholder: r0.code })}
                          <td className="c-type">
                            <select
                              value={r.accountKind}
                              onChange={(e) => set(r.id, { accountKind: e.target.value })}
                              aria-label={`Type, ${r0.code}`}
                            >
                              <option value="">
                                {r.inferred ? `not set (shows as ${r.inferred})` : 'not set'}
                              </option>
                              {KINDS.map((k) => (
                                <option key={k} value={k}>
                                  {k}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="c-joint">
                            <input
                              type="checkbox"
                              checked={r.isJoint}
                              onChange={(e) =>
                                set(r.id, {
                                  isJoint: e.target.checked,
                                  ...(e.target.checked ? {} : { jointHolderId: '' }),
                                })
                              }
                              aria-label={`Joint, ${r0.code}`}
                            />
                            {r.isJoint && (
                              <div className="aeg-with">
                                <select
                                  value={r.jointHolderId}
                                  onChange={(e) => set(r.id, { jointHolderId: e.target.value })}
                                  aria-label={`Joint with, ${r0.code}`}
                                >
                                  <option value="">second name not set</option>
                                  {owners
                                    .filter((o) => o.id !== r.ownerId)
                                    .map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.name}
                                      </option>
                                    ))}
                                </select>
                                <button
                                  type="button"
                                  className="btn compact ghost"
                                  disabled={!r.jointHolderId}
                                  onClick={() => {
                                    const p = swapNames(r);
                                    if (p) set(r.id, p);
                                  }}
                                  aria-label={`Swap names, ${r0.code}`}
                                  title="Swap the first and second name (Rupash & Ragini becomes Ragini & Rupash)"
                                >
                                  Swap names
                                </button>
                              </div>
                            )}
                          </td>
                          {col(r, 'last4', 'Last four digits', 'c-d4', {
                            disabled: fd,
                            placeholder: fd ? '' : '0266',
                          })}
                          {fd ? (
                            col(r, 'linkedLast4', 'Linked savings last four', 'c-d4', {
                              placeholder: '0266',
                            })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdRate', 'Rate percent', 'c-rate', {
                              inputMode: 'decimal',
                              placeholder: '7.25',
                            })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdBookedOn', 'Start date', 'c-date', { type: 'date' })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdMaturityOn', 'Maturity date', 'c-date', { type: 'date' })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdPrincipal', 'Amount invested', 'c-amt', {
                              inputMode: 'numeric',
                            })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdMaturityAmount', 'Amount at maturity', 'c-amt', {
                              inputMode: 'numeric',
                              placeholder: 'worked out',
                            })
                          ) : (
                            <td className="na" />
                          )}
                          {fd ? (
                            col(r, 'fdRefLast4', 'Deposit number last four', 'c-d4', {
                              placeholder: '5076',
                            })
                          ) : (
                            <td className="na" />
                          )}
                          {col(r, 'notes', 'Notes', 'c-notes', {
                            placeholder: 'AMB, cards, lounge…',
                          })}
                          <td className="c-status">
                            <select
                              value={r.status}
                              onChange={(e) => set(r.id, { status: e.target.value })}
                              aria-label={`Status, ${r0.code}`}
                            >
                              {STATUSES.map((s) => (
                                <option key={s} value={s}>
                                  {STATUS_LABEL[s]}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                        {bad.length > 0 && (
                          <tr>
                            <td colSpan={16} className="aeg-problem" role="alert">
                              {r0.code}: {bad.join('; ')}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <div className="card savebar aeg-savebar" role="region" aria-label="Save">
        <span>
          <b>{diffs.length}</b> row{diffs.length === 1 ? '' : 's'} changed
          {proposed.size > 0 ? ` (${proposed.size} suggested: save to confirm, or discard)` : ''}
        </span>
        {msg && (
          <span
            className={msg.ok ? 'ok small' : 'aeg-err small'}
            role={msg.ok ? 'status' : 'alert'}
          >
            {msg.message}
          </span>
        )}
        {badCount > 0 && <span className="aeg-err small">Fix the marked rows first.</span>}
        <button
          type="button"
          className="btn"
          onClick={discard}
          disabled={diffs.length === 0 || pending}
        >
          Discard
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={doSave}
          disabled={diffs.length === 0 || badCount > 0 || pending}
        >
          {pending ? 'Saving…' : 'Save all'}
        </button>
      </div>
    </div>
  );
}
