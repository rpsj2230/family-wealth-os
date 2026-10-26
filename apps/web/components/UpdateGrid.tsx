'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition, type ClipboardEvent, type KeyboardEvent } from 'react';
import { formatInr, type BankBlock, type BankRow, type PersonStyle } from '@fwos/core';
import { addBankItem, saveMonthly } from '@/app/(app)/monthly/actions';
import { PersonBadge } from './Person';
import { cleanNote, fmtDate, pctText } from './BankTable';
import { buildGridChanges, type GridEdit, type GridRowInfo } from '@/lib/update-grid';
import { slugify } from '@/lib/slug';

const FD_STATUS = [
  ['active', 'Running'],
  ['closed', 'Matured, paid out'],
  ['renewed', 'Renewed'],
] as const;

const money = (v: number | null) => (v === null ? '–' : formatInr(Math.round(v)));

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

/** The monthly sheet: every bank in your order, one row per account or deposit, edited in place. */
export function UpdateGrid({
  blocks,
  styles,
  today,
  fxHint,
  institutions,
}: {
  blocks: BankBlock[];
  styles: Record<string, PersonStyle>;
  today: string;
  fxHint: Record<string, number>;
  institutions: boolean;
}) {
  const [edits, setEdits] = useState<Record<string, GridEdit>>({});
  const [asOf, setAsOf] = useState(today);
  const [terms, setTerms] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (id: string, patch: GridEdit) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], ...patch } }));
  const rows = useMemo(() => blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)), [blocks]);
  const infos = useMemo(() => rows.map(info), [rows]);
  const { changes, errors } = useMemo(
    () => buildGridChanges(infos, edits, asOf, today, fxHint),
    [infos, edits, asOf, today, fxHint],
  );

  function save() {
    setMsg(null);
    start(async () => {
      const r = await saveMonthly(changes);
      setMsg({ ok: r.ok, text: r.message });
      if (r.ok) setEdits({});
    });
  }

  // Enter moves to the next balance box; pasting a column from Excel fills the boxes below
  function nextBal(from: HTMLElement) {
    const all = [...document.querySelectorAll<HTMLInputElement>('input[data-bal]')];
    all[all.indexOf(from as HTMLInputElement) + 1]?.focus();
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      nextBal(e.currentTarget);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>, id: string) => {
    const cells = e.clipboardData
      .getData('text')
      .split(/\r?\n/)
      .map((x) => x.split('\t')[0]!.trim())
      .filter((x, i, a) => x !== '' || i < a.length - 1);
    if (cells.length <= 1) return;
    e.preventDefault();
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[data-bal]')];
    const start = boxes.findIndex((b) => b.dataset.id === id);
    setEdits((prev) => {
      const next = { ...prev };
      cells.forEach((v, k) => {
        const box = boxes[start + k];
        if (box?.dataset.id) next[box.dataset.id] = { ...next[box.dataset.id], amount: v };
      });
      return next;
    });
  };

  return (
    <>
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
        <label className="check">
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />{' '}
          Edit deposit rate and maturity amount
        </label>
        <span className="jump">
          {blocks.length > 1 &&
            blocks.map((b) => (
              <a key={b.key} href={`#${slugify(b.name)}`}>
                {b.name}
              </a>
            ))}
        </span>
      </div>

      {blocks.map((b) => (
        <section className="card xlbank" key={b.key} id={slugify(b.name)}>
          <header className="xlhead">
            <h2>{b.name}</h2>
            <span className="tot">
              <b className="num big">{money(b.totals.current)}</b>
            </span>
            {b.needsYou > 0 ? (
              <span className="pill warn">{b.needsYou} need you</span>
            ) : b.doneThisMonth ? (
              <span className="pill ok">Updated this month</span>
            ) : (
              <span className="pill">Not updated this month</span>
            )}
          </header>
          <div className="xlwrap">
            <table className="xl upd">
              <thead>
                <tr>
                  <th>Account</th>
                  <th className="num">Rate</th>
                  <th className="num">Maturity</th>
                  <th className="num">Invested / balance</th>
                  <th className="num">At maturity</th>
                  <th className="num">Current value</th>
                  <th className="num">New balance · status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              {b.sections.map((sct) => (
                <tbody
                  key={sct.ownerId}
                  style={{ ['--person' as string]: styles[sct.ownerId]?.colour }}
                >
                  <tr className="secthead">
                    <th colSpan={8}>
                      <PersonBadge p={styles[sct.ownerId]} name size={18} />
                    </th>
                  </tr>
                  {sct.rows.map((r) => {
                    const e = edits[r.assetId] ?? {};
                    const fd = r.fd;
                    return (
                      <tr key={r.assetId} className="xlrow">
                        <td className="code">
                          <span className={`kind ${r.kind}`}>{r.code}</span>
                          {fd?.linkedTo && <div className="small muted">↳ {fd.linkedTo}</div>}
                          {errors[r.assetId] && (
                            <div className="small fail" role="alert">
                              {errors[r.assetId]}
                            </div>
                          )}
                        </td>
                        <td className="num">
                          {fd && terms ? (
                            <input
                              className="mini"
                              inputMode="decimal"
                              aria-label={`Rate for ${r.code}`}
                              defaultValue={String(Math.round(fd.rate * 1e6) / 1e4)}
                              onChange={(ev) => set(r.assetId, { fdRate: ev.target.value })}
                            />
                          ) : fd ? (
                            pctText(fd.rate)
                          ) : (
                            ''
                          )}
                        </td>
                        <td className="num nowrap">
                          {fd ? fmtDate(fd.maturityOn) : ''}
                          {fd?.needsConfirmation && <div className="small fail">matured</div>}
                        </td>
                        <td className="num">{fd ? money(fd.principal) : money(r.recorded)}</td>
                        <td className="num">
                          {fd && terms ? (
                            <input
                              className="mini wide"
                              inputMode="decimal"
                              aria-label={`Maturity amount for ${r.code}`}
                              defaultValue={String(Math.round(fd.maturityAmount))}
                              onChange={(ev) =>
                                set(r.assetId, { fdMaturityAmount: ev.target.value })
                              }
                            />
                          ) : fd ? (
                            money(fd.maturityAmount)
                          ) : (
                            ''
                          )}
                        </td>
                        <td className="num cur">{money(r.current)}</td>
                        <td className="num">
                          {fd ? (
                            <select
                              className="mini"
                              aria-label={`Status of ${r.code}`}
                              value={
                                e.status ??
                                (fd.needsConfirmation ? 'matured_unconfirmed' : r.status)
                              }
                              onChange={(ev) => set(r.assetId, { status: ev.target.value })}
                            >
                              {fd.needsConfirmation && (
                                <option value="matured_unconfirmed">
                                  Matured: say where it went
                                </option>
                              )}
                              {FD_STATUS.map(([v, l]) => (
                                <option key={v} value={v}>
                                  {l}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="balbox">
                              <input
                                className="mini wide"
                                data-bal
                                data-id={r.assetId}
                                inputMode="decimal"
                                aria-label={`New balance for ${b.name} ${styles[sct.ownerId]?.name} ${r.code}`}
                                placeholder={
                                  r.recorded === null ? '' : String(Math.round(r.recorded))
                                }
                                value={e.amount ?? ''}
                                onChange={(ev) => set(r.assetId, { amount: ev.target.value })}
                                onKeyDown={onKey}
                                onPaste={(ev) => onPaste(ev, r.assetId)}
                              />
                              {r.currency !== 'INR' && (
                                <input
                                  className="mini"
                                  inputMode="decimal"
                                  aria-label={`${r.currency} to INR rate`}
                                  placeholder={
                                    fxHint[r.currency]
                                      ? `×${fxHint[r.currency]}`
                                      : `${r.currency}→INR`
                                  }
                                  value={e.fx ?? ''}
                                  onChange={(ev) => set(r.assetId, { fx: ev.target.value })}
                                />
                              )}
                            </span>
                          )}
                        </td>
                        <td className="notes">
                          <input
                            className="mini note"
                            aria-label={`Notes for ${r.code}`}
                            defaultValue={fd ? cleanNote(r.notes) : (r.notes ?? '')}
                            placeholder={
                              fd?.refLast4
                                ? `FD no. …${fd.refLast4}`
                                : 'AMB, debit card, lounge card…'
                            }
                            onChange={(ev) =>
                              set(r.assetId, {
                                notes: fd
                                  ? [
                                      r.notes?.match(/FD\s*Number\s*:\s*[^\s,]*/i)?.[0],
                                      ev.target.value,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')
                                  : ev.target.value,
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                  {institutions && b.key !== '__none' && (
                    <tr>
                      <td colSpan={8} className="addcell">
                        <AddItem ownerId={sct.ownerId} institutionId={b.key} />
                      </td>
                    </tr>
                  )}
                </tbody>
              ))}
            </table>
          </div>
        </section>
      ))}

      <div className="card savebar" role="region" aria-label="Save">
        <span className={msg ? (msg.ok ? 'ok' : 'fail') : 'muted'} role="status" aria-live="polite">
          {msg
            ? msg.text
            : changes.length === 0
              ? 'No changes yet'
              : `${changes.length} change${changes.length === 1 ? '' : 's'} ready to save`}
        </span>
        <button
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
        <Link href="/monthly/all">Property, ULIP, loans and other items</Link>
      </p>
    </>
  );
}

function AddItem({ ownerId, institutionId }: { ownerId: string; institutionId: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<'bank_account' | 'fixed_deposit'>('fixed_deposit');
  const [f, setF] = useState({
    accountKind: 'NRE',
    isJoint: false,
    last4: '',
    notes: '',
    principal: '',
    ratePct: '',
    bookedOn: '',
    maturityOn: '',
    maturityAmount: '',
    refLast4: '',
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const up = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  if (!open)
    return (
      <button type="button" className="linkbtn" onClick={() => setOpen(true)}>
        + Add a deposit or account here
      </button>
    );
  return (
    <form
      className="addform"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        start(async () => {
          const r = await addBankItem({
            type,
            ownerId,
            institutionId,
            ...f,
            accountKind: f.accountKind as 'NRE' | 'NRO' | '',
          });
          setMsg(r.message);
          if (r.ok) setOpen(false);
        });
      }}
    >
      <select
        aria-label="Type"
        value={type}
        onChange={(e) => setType(e.target.value as typeof type)}
      >
        <option value="fixed_deposit">Fixed deposit</option>
        <option value="bank_account">Savings account</option>
      </select>
      <select
        aria-label="NRE or NRO"
        value={f.accountKind}
        onChange={(e) => up('accountKind', e.target.value)}
      >
        <option value="NRE">NRE</option>
        <option value="NRO">NRO</option>
        <option value="">Not stated</option>
      </select>
      <label className="check">
        <input
          type="checkbox"
          checked={f.isJoint}
          onChange={(e) => up('isJoint', e.target.checked)}
        />{' '}
        Joint
      </label>
      <input
        aria-label="Last 4 digits of the savings account"
        placeholder="Savings a/c last 4"
        maxLength={4}
        value={f.last4}
        onChange={(e) => up('last4', e.target.value)}
      />
      {type === 'fixed_deposit' && (
        <>
          <input
            aria-label="Amount invested"
            placeholder="Invested ₹"
            inputMode="decimal"
            value={f.principal}
            onChange={(e) => up('principal', e.target.value)}
          />
          <input
            aria-label="Rate in percent"
            placeholder="Rate %"
            inputMode="decimal"
            value={f.ratePct}
            onChange={(e) => up('ratePct', e.target.value)}
          />
          <input
            aria-label="Start date"
            type="date"
            value={f.bookedOn}
            onChange={(e) => up('bookedOn', e.target.value)}
          />
          <input
            aria-label="Maturity date"
            type="date"
            value={f.maturityOn}
            onChange={(e) => up('maturityOn', e.target.value)}
          />
          <input
            aria-label="Maturity amount"
            placeholder="At maturity ₹ (optional)"
            inputMode="decimal"
            value={f.maturityAmount}
            onChange={(e) => up('maturityAmount', e.target.value)}
          />
          <input
            aria-label="FD number last 4"
            placeholder="FD no. last 4"
            maxLength={4}
            value={f.refLast4}
            onChange={(e) => up('refLast4', e.target.value)}
          />
        </>
      )}
      <input
        aria-label="Notes"
        placeholder="Notes"
        value={f.notes}
        onChange={(e) => up('notes', e.target.value)}
      />
      <button className="btn compact primary" disabled={pending}>
        Add
      </button>
      <button type="button" className="btn compact ghost" onClick={() => setOpen(false)}>
        Cancel
      </button>
      {msg && (
        <span className="small fail" role="alert">
          {msg}
        </span>
      )}
    </form>
  );
}
