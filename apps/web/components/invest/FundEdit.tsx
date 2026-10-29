'use client';

import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { formatInr, type PersonStyle } from '@fwos/core';
import {
  buildAddFund,
  buildFundSave,
  buildTxn,
  draftOf,
  EMPTY_FUND,
  savedMessage,
  SELL_KINDS,
  TXN_KINDS,
  typed,
  type AddFundDraft,
  type AddFundPayload,
  type FundDraft,
  type FundEditRow,
  type FundSavePayload,
  type TxnDraft,
} from '@/lib/fund-edit';
import { Sheet } from '@/components/Sheet';
import '@/components/quickedit.css';
import './invest.css';

export interface EditResult {
  ok: boolean;
  message: string;
}
export interface FundEditActions {
  save: (p: FundSavePayload) => Promise<EditResult>;
  addFund: (p: AddFundPayload) => Promise<EditResult>;
  addTxn: (v: Record<string, string>) => Promise<EditResult>;
}

interface Api {
  edit: (id: string) => void;
  addFund: () => void;
  addTxn: (assetId?: string) => void;
}
const Ctx = createContext<Api | null>(null);
export const useFundEdit = () => useContext(Ctx);

type Goal = { id: string; name: string };
type Owner = { id: string; name: string };

/**
 * The side panels of the Investments page: edit one fund, add a fund, add a transaction. Without `actions` (the public sample) they
 * work but say nothing is saved. Rows call the panels through <EditFundButton/> and friends, and the page can open one by address.
 */
export function FundEditProvider({
  rows,
  owners,
  goals,
  styles,
  today,
  actions,
  linkBase,
  initialOpen,
  children,
}: {
  rows: FundEditRow[];
  owners: Owner[];
  goals: Goal[];
  styles: Record<string, PersonStyle>;
  today: string;
  actions?: FundEditActions;
  /** where the Match tab lives, and whether this is the public sample (its fund pages have another address) */
  linkBase: { match: string; demo: boolean };
  initialOpen?: string | null;
  children: ReactNode;
}) {
  const [stored, setStored] = useState<Record<string, FundEditRow>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r])),
  );
  useEffect(() => setStored(Object.fromEntries(rows.map((r) => [r.id, r]))), [rows]);
  const [panel, setPanel] = useState<
    { kind: 'edit'; id: string } | { kind: 'fund' } | { kind: 'txn'; id: string | null } | null
  >(
    initialOpen && rows.some((r) => r.id === initialOpen)
      ? { kind: 'edit', id: initialOpen }
      : null,
  );
  const api = useMemo<Api>(
    () => ({
      edit: (id) => setPanel({ kind: 'edit', id }),
      addFund: () => setPanel({ kind: 'fund' }),
      addTxn: (id) => setPanel({ kind: 'txn', id: id ?? null }),
    }),
    [],
  );
  const close = () => setPanel(null);
  const row = panel?.kind === 'edit' ? stored[panel.id] : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      {row && (
        <EditPanel
          key={row.id}
          was={row}
          goals={goals}
          style={styles[row.ownerId]}
          today={today}
          {...(actions ? { save: actions.save } : {})}
          linkBase={linkBase}
          onSaved={(next) => setStored((s) => ({ ...s, [next.id]: next }))}
          onTxn={() => setPanel({ kind: 'txn', id: row.id })}
          onClose={close}
        />
      )}
      {panel?.kind === 'fund' && (
        <AddFundPanel
          owners={owners}
          goals={goals}
          styles={styles}
          today={today}
          {...(actions ? { add: actions.addFund } : {})}
          matchHref={linkBase.match}
          onClose={close}
        />
      )}
      {panel?.kind === 'txn' && (
        <TxnPanel
          funds={Object.values(stored).map((r) => ({
            id: r.id,
            name: r.label || r.name,
            owner: r.ownerName,
          }))}
          start={panel.id}
          today={today}
          {...(actions ? { add: actions.addTxn } : {})}
          onClose={close}
        />
      )}
    </Ctx.Provider>
  );
}

const PENCIL = (
  <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
    <path
      d="M3 14.5V17h2.5l7.4-7.4-2.5-2.5L3 14.5zm11.7-6.8a.7.7 0 0 0 0-1l-1.4-1.4a.7.7 0 0 0-1 0l-1.1 1.1 2.5 2.5 1-1.2z"
      fill="currentColor"
    />
  </svg>
);

/** The small "Edit" pill of a fund row (or a regular button in a page header). */
export function EditFundButton({
  id,
  name,
  button = false,
  label = 'Edit',
}: {
  id: string;
  name: string;
  button?: boolean;
  label?: string;
}) {
  const q = useContext(Ctx);
  if (!q) return null;
  return (
    <button
      type="button"
      className={button ? 'btn compact' : 'editbtn'}
      onClick={() => q.edit(id)}
      aria-label={`Edit ${name}`}
      title={`Edit ${name}`}
    >
      {!button && PENCIL}
      <span>{label}</span>
    </button>
  );
}

export function AddFundButton({
  className = 'btn',
  label = 'Add a fund',
}: {
  className?: string;
  label?: string;
}) {
  const q = useContext(Ctx);
  if (!q) return null;
  return (
    <button type="button" className={className} onClick={() => q.addFund()}>
      {label}
    </button>
  );
}

export function AddTxnButton({
  assetId,
  className = 'btn',
  label = 'Add a transaction',
}: {
  assetId?: string;
  className?: string;
  label?: string;
}) {
  const q = useContext(Ctx);
  if (!q) return null;
  return (
    <button type="button" className={className} onClick={() => q.addTxn(assetId)}>
      {label}
    </button>
  );
}

/* ------------------------------------------------------------------------------------------ shared */

function Footer({
  asking,
  setAsking,
  onClose,
  requestClose,
  result,
  idle,
  pending,
  canSave,
  saveLabel = 'Save',
}: {
  asking: boolean;
  setAsking: (v: boolean) => void;
  onClose: () => void;
  requestClose: () => void;
  result: EditResult | null;
  idle: string;
  pending: boolean;
  canSave: boolean;
  saveLabel?: string;
}) {
  return (
    <footer className="qe-foot">
      {asking ? (
        <div className="qe-ask" role="alertdialog" aria-label="Unsaved changes">
          <span>You have changes that are not saved.</span>
          <button type="button" className="btn compact" onClick={() => setAsking(false)}>
            Keep editing
          </button>
          <button type="button" className="btn compact" onClick={onClose}>
            Close without saving
          </button>
        </div>
      ) : (
        <>
          <span
            className={`qe-msg ${result ? (result.ok ? 'ok' : 'fail') : 'muted'}`}
            role={result && !result.ok ? 'alert' : 'status'}
            aria-live="polite"
          >
            {result ? (result.ok ? `✓ ${result.message}` : result.message) : idle}
          </span>
          <button type="button" className="btn" onClick={requestClose}>
            {result?.ok ? 'Done' : 'Cancel'}
          </button>
          <button type="submit" className="btn primary" disabled={pending || !canSave}>
            {pending ? 'Saving…' : saveLabel}
          </button>
        </>
      )}
    </footer>
  );
}

function Head({
  id,
  kicker,
  title,
  sub,
  colour,
  onClose,
}: {
  id: string;
  kicker: ReactNode;
  title: string;
  sub?: string | undefined;
  colour?: string | undefined;
  onClose: () => void;
}) {
  return (
    <header className="qe-head" style={{ ['--person' as string]: colour }}>
      <div>
        <p className="qe-kicker">{kicker}</p>
        <h2 id={id}>{title}</h2>
        {sub && <p className="muted small">{sub}</p>}
      </div>
      <button type="button" className="qe-x" onClick={onClose} aria-label="Close">
        <span aria-hidden>×</span>
      </button>
    </header>
  );
}

function Problems({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <ul className="qe-problems" role="alert">
      {list.map((p) => (
        <li key={p}>Please check: {p}.</li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------------------------------ edit a fund */

function EditPanel({
  was,
  goals,
  style,
  today,
  save,
  linkBase,
  onSaved,
  onTxn,
  onClose,
}: {
  was: FundEditRow;
  goals: Goal[];
  style: PersonStyle | undefined;
  today: string;
  save?: FundEditActions['save'];
  linkBase: { match: string; demo: boolean };
  onSaved: (next: FundEditRow) => void;
  onTxn: () => void;
  onClose: () => void;
}) {
  const [d, setD] = useState<FundDraft>(() => draftOf(was));
  const [result, setResult] = useState<EditResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const r = useMemo(() => buildFundSave(was, d, today), [was, d, today]);
  const dirty = r.changes.length > 0 || r.problems.length > 0;
  const set = (patch: Partial<FundDraft>) => {
    setResult(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const requestClose = useCallback(() => {
    if (dirty && !result?.ok) setAsking(true);
    else onClose();
  }, [dirty, result, onClose]);
  const unitsNow = typed(d.units);
  const worked =
    was.nav !== null && unitsNow !== null && !Number.isNaN(unitsNow) ? unitsNow * was.nav : null;
  const unitsChanged =
    r.payload?.units !== undefined || (unitsNow !== null && unitsNow !== was.units);

  const doSave = () =>
    start(async () => {
      if (!r.payload) return;
      if (!save) {
        setResult({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      const res = await save(r.payload);
      if (!res.ok) {
        setResult(res);
        return;
      }
      setResult({ ok: true, message: savedMessage(r.changes) });
      const p = r.payload;
      onSaved({
        ...was,
        label: p.label !== undefined ? (p.label ?? '') : was.label,
        units: p.units ?? was.units,
        value: p.value ?? was.value,
        invested: p.invested ?? was.invested,
        sipMonthly: p.sipMonthly !== undefined ? p.sipMonthly : was.sipMonthly,
        sipStopped: p.sipStopped ?? (p.sipMonthly === null ? false : was.sipStopped),
        startedOn: p.startedOn !== undefined ? (p.startedOn ?? '') : was.startedOn,
        goalIds: p.goalId !== undefined ? (p.goalId ? [p.goalId] : []) : was.goalIds,
        closed: p.status ? p.status === 'closed' : was.closed,
        plan: p.planType
          ? p.planType === 'regular_or_unknown'
            ? 'unknown'
            : p.planType
          : was.plan,
        exitLoadPct: p.exitLoadPct !== undefined ? p.exitLoadPct : was.exitLoadPct,
        exitLoadDays: p.exitLoadDays !== undefined ? p.exitLoadDays : was.exitLoadDays,
      });
      setD((x) => ({ ...x, value: '' }));
    });

  return (
    <Sheet labelId="fe-title" onRequestClose={requestClose} onClose={onClose}>
      <form
        className="qe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (r.payload && !pending) doSave();
        }}
      >
        <Head
          id="fe-title"
          colour={style?.colour}
          kicker={
            <>
              Mutual fund
              {style && (
                <>
                  {' · '}
                  <span className="qe-who">
                    <span className="qe-dot" aria-hidden />
                    {style.name}
                  </span>
                </>
              )}
            </>
          }
          title={was.label || was.name}
          sub={was.label ? was.name : undefined}
          onClose={requestClose}
        />
        <div className="qe-body">
          <div className="qe-grid">
            <label className="qe-f qe-wide">
              <span>Name</span>
              <input
                value={d.label}
                onChange={(e) => set({ label: e.target.value })}
                placeholder={was.name}
                maxLength={120}
                autoComplete="off"
              />
              <small className="muted">
                How you want to see it. Leave empty for the statement&rsquo;s name.
              </small>
            </label>
            <label className="qe-f">
              <span>Units held</span>
              <input
                value={d.units}
                onChange={(e) => set({ units: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                placeholder="not recorded"
              />
              <small className="muted">
                {worked !== null && unitsChanged
                  ? `Worth ${formatInr(Math.round(worked))} at ₹${(was.nav ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 4 })}.`
                  : was.nav !== null
                    ? `Price now ₹${was.nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })}.`
                    : 'No live price for this fund.'}
              </small>
            </label>
            <label className="qe-f">
              <span>Amount invested (₹)</span>
              <input
                value={d.invested}
                onChange={(e) => set({ invested: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
              <small className="muted">Cost of the units still held.</small>
            </label>
            {unitsChanged && was.nav === null && (
              <label className="qe-f qe-wide">
                <span>Value now (₹)</span>
                <input
                  value={d.value}
                  onChange={(e) => set({ value: e.target.value })}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="units × price from your fund app"
                />
                <small className="muted">Needed because this fund has no live price yet.</small>
              </label>
            )}
            <label className="qe-f">
              <span>SIP a month (₹)</span>
              <input
                value={d.sip}
                onChange={(e) =>
                  set({
                    sip: e.target.value,
                    ...(e.target.value.trim() === '' ? { sipStopped: false } : {}),
                  })
                }
                inputMode="decimal"
                autoComplete="off"
                placeholder="none"
              />
            </label>
            <div className="qe-f qe-check">
              <span>SIP</span>
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.sipStopped}
                  disabled={d.sip.trim() === ''}
                  onChange={(e) => set({ sipStopped: e.target.checked })}
                />{' '}
                Stopped
              </label>
            </div>
            <label className="qe-f">
              <span>Started on</span>
              <input
                type="date"
                max={today}
                value={d.startedOn}
                onChange={(e) => set({ startedOn: e.target.value })}
              />
            </label>
            <label className="qe-f">
              <span>Goal</span>
              {was.goalIds.length > 1 ? (
                <small className="muted">
                  Split between {was.goalIds.length} goals. Change the split on the{' '}
                  <Link href="/goals">Goals page</Link>.
                </small>
              ) : (
                <select value={d.goalId} onChange={(e) => set({ goalId: e.target.value })}>
                  <option value="">No goal</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              )}
            </label>
            <div className="qe-f qe-wide qe-joint">
              <label className="check">
                <input
                  type="checkbox"
                  checked={d.closed}
                  onChange={(e) => set({ closed: e.target.checked })}
                />{' '}
                Sold or closed (no longer held)
              </label>
            </div>
          </div>
          <details className="qe-more">
            <summary>More details</summary>
            <div className="qe-grid">
              <label className="qe-f">
                <span>Plan</span>
                <select value={d.plan} onChange={(e) => set({ plan: e.target.value })}>
                  <option value="unknown">Not set</option>
                  <option value="direct">Direct</option>
                  <option value="regular">Regular</option>
                </select>
              </label>
              <div className="qe-f" aria-hidden="true" />
              <label className="qe-f">
                <span>Exit load (%)</span>
                <input
                  value={d.exitPct}
                  onChange={(e) => set({ exitPct: e.target.value })}
                  inputMode="decimal"
                  placeholder="default"
                />
              </label>
              <label className="qe-f">
                <span>Exit load days</span>
                <input
                  value={d.exitDays}
                  onChange={(e) => set({ exitDays: e.target.value })}
                  inputMode="numeric"
                  placeholder="default"
                />
              </label>
              <p className="qe-wide small muted">
                Leave both empty to use the default in Settings.
              </p>
            </div>
          </details>
          <p className="qe-links small">
            <button type="button" className="linkbtn" onClick={onTxn}>
              Add a transaction
            </button>
            {' · '}
            <Link href={linkBase.demo ? `/demo/asset?kind=fund&id=${was.id}` : `/asset/${was.id}`}>
              Open the fund page
            </Link>
            {!was.amfiCode && (
              <>
                {' · '}
                <Link href={linkBase.match}>Match it to follow its price</Link>
              </>
            )}
          </p>
          <Problems list={r.problems} />
        </div>
        <Footer
          asking={asking}
          setAsking={setAsking}
          onClose={onClose}
          requestClose={requestClose}
          result={result}
          idle={r.changes.length > 0 ? `Changed: ${r.changes.join(', ')}.` : 'No changes yet.'}
          pending={pending}
          canSave={!!r.payload}
        />
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------ add a fund */

function AddFundPanel({
  owners,
  goals,
  styles,
  today,
  add,
  matchHref,
  onClose,
}: {
  owners: Owner[];
  goals: Goal[];
  styles: Record<string, PersonStyle>;
  today: string;
  add?: FundEditActions['addFund'];
  matchHref: string;
  onClose: () => void;
}) {
  const [d, setD] = useState<AddFundDraft>({
    ...EMPTY_FUND,
    ownerId: owners.length === 1 ? owners[0]!.id : '',
  });
  const [result, setResult] = useState<EditResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const r = useMemo(() => buildAddFund(d, today), [d, today]);
  const dirty =
    JSON.stringify(d) !==
    JSON.stringify({ ...EMPTY_FUND, ownerId: owners.length === 1 ? owners[0]!.id : '' });
  const set = (patch: Partial<AddFundDraft>) => {
    setResult(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const requestClose = () => (dirty && !result?.ok ? setAsking(true) : onClose());
  const submit = () =>
    start(async () => {
      if (!r.payload) return;
      if (!add) {
        setResult({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      const res = await add(r.payload);
      setResult(res);
      if (res.ok) setD({ ...EMPTY_FUND, ownerId: d.ownerId });
    });
  const person = styles[d.ownerId];
  return (
    <Sheet labelId="af-title" onRequestClose={requestClose} onClose={onClose}>
      <form
        className="qe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (r.payload && !pending) submit();
        }}
      >
        <Head
          id="af-title"
          colour={person?.colour}
          kicker="Investments"
          title="Add a fund"
          sub="For a fund that is not on a statement yet. A fund statement under Import fills everything in by itself."
          onClose={requestClose}
        />
        <div className="qe-body">
          <div className="qe-grid">
            <label className="qe-f qe-wide">
              <span>Fund name</span>
              <input
                value={d.name}
                onChange={(e) => set({ name: e.target.value })}
                maxLength={120}
                autoComplete="off"
                placeholder="as on your fund app"
              />
            </label>
            <label className="qe-f">
              <span>Whose</span>
              <select value={d.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
                <option value="">Choose</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {styles[o.id]?.name ?? o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="qe-f">
              <span>Plan</span>
              <select value={d.plan} onChange={(e) => set({ plan: e.target.value })}>
                <option value="unknown">Not set</option>
                <option value="direct">Direct</option>
                <option value="regular">Regular</option>
              </select>
            </label>
            <label className="qe-f">
              <span>Amount invested (₹)</span>
              <input
                value={d.invested}
                onChange={(e) => set({ invested: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f">
              <span>Value now (₹)</span>
              <input
                value={d.value}
                onChange={(e) => set({ value: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f">
              <span>Units held (optional)</span>
              <input
                value={d.units}
                onChange={(e) => set({ units: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f">
              <span>Started on (optional)</span>
              <input
                type="date"
                max={today}
                value={d.startedOn}
                onChange={(e) => set({ startedOn: e.target.value })}
              />
            </label>
            <label className="qe-f">
              <span>SIP a month (optional)</span>
              <input
                value={d.sip}
                onChange={(e) => set({ sip: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f">
              <span>Goal (optional)</span>
              <select value={d.goalId} onChange={(e) => set({ goalId: e.target.value })}>
                <option value="">No goal</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="small muted qe-links">
            Afterwards, <Link href={matchHref}>match the fund</Link> to its official scheme so the
            price follows the market.
          </p>
          <Problems list={dirty ? r.problems : []} />
        </div>
        <Footer
          asking={asking}
          setAsking={setAsking}
          onClose={onClose}
          requestClose={requestClose}
          result={result}
          idle="Fill in the name, whose it is, the amount invested and the value."
          pending={pending}
          canSave={!!r.payload}
          saveLabel="Add the fund"
        />
      </form>
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------ add a transaction */

function TxnPanel({
  funds,
  start: startId,
  today,
  add,
  onClose,
}: {
  funds: { id: string; name: string; owner: string }[];
  start: string | null;
  today: string;
  add?: FundEditActions['addTxn'];
  onClose: () => void;
}) {
  const blank: TxnDraft = {
    asset: startId ?? '',
    date: today,
    kind: 'purchase',
    amount: '',
    units: '',
    nav: '',
  };
  const [d, setD] = useState<TxnDraft>(blank);
  const [result, setResult] = useState<EditResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, run] = useTransition();
  const r = useMemo(() => buildTxn(d, today), [d, today]);
  const dirty = d.amount !== '' || d.units !== '' || d.nav !== '';
  const set = (patch: Partial<TxnDraft>) => {
    setResult(null);
    setD((x) => ({ ...x, ...patch }));
  };
  const requestClose = () => (dirty && !result?.ok ? setAsking(true) : onClose());
  const submit = () =>
    run(async () => {
      if (!r.values) return;
      if (!add) {
        setResult({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      const res = await add(r.values);
      setResult(res);
      if (res.ok) setD({ ...blank, asset: d.asset, kind: d.kind, date: d.date });
    });
  return (
    <Sheet labelId="at-title" onRequestClose={requestClose} onClose={onClose}>
      <form
        className="qe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (r.values && !pending) submit();
        }}
      >
        <Head
          id="at-title"
          kicker="Investments"
          title="Add a transaction"
          sub="A purchase, SIP instalment, switch or sale you made. Units and the amount invested follow."
          onClose={requestClose}
        />
        <div className="qe-body">
          <div className="qe-grid">
            <label className="qe-f qe-wide">
              <span>Fund</span>
              <select value={d.asset} onChange={(e) => set({ asset: e.target.value })}>
                <option value="">Choose the fund</option>
                {funds.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name} ({f.owner})
                  </option>
                ))}
              </select>
            </label>
            <label className="qe-f">
              <span>Date</span>
              <input
                type="date"
                max={today}
                value={d.date}
                onChange={(e) => set({ date: e.target.value })}
              />
            </label>
            <label className="qe-f">
              <span>Type</span>
              <select value={d.kind} onChange={(e) => set({ kind: e.target.value })}>
                {TXN_KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="qe-f">
              <span>Amount (₹)</span>
              <input
                value={d.amount}
                onChange={(e) => set({ amount: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f">
              <span>Price per unit (₹)</span>
              <input
                value={d.nav}
                onChange={(e) => set({ nav: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
              />
            </label>
            <label className="qe-f qe-wide">
              <span>Units (or leave empty to work them out from the price)</span>
              <input
                value={d.all && SELL_KINDS.has(d.kind) ? '' : d.units}
                onChange={(e) => set({ units: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                disabled={!!d.all && SELL_KINDS.has(d.kind)}
              />
            </label>
            {SELL_KINDS.has(d.kind) && (
              <label className="qe-f qe-wide check" data-testid="txn-all">
                <span>
                  <input
                    type="checkbox"
                    checked={!!d.all}
                    onChange={(e) => set({ all: e.target.checked })}
                  />{' '}
                  Sold every unit: close the fund and stop its SIP from this date
                </span>
              </label>
            )}
          </div>
          <Problems list={dirty ? r.problems : []} />
        </div>
        <Footer
          asking={asking}
          setAsking={setAsking}
          onClose={onClose}
          requestClose={requestClose}
          result={result}
          idle="Enter the amount and the units or the price."
          pending={pending}
          canSave={!!r.values}
          saveLabel="Add the transaction"
        />
      </form>
    </Sheet>
  );
}
