'use client';

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
import type { PersonStyle } from '@fwos/core';
import { swapNames, type EditRow } from '@/lib/account-edit';
import {
  KIND_OPTIONS,
  buildQuickSave,
  quickLayout,
  savedMessage,
  statusOptions,
  type AddDraft,
  type QuickDraft,
  type QuickField,
  type QuickRow,
} from '@/lib/quick-edit';
import { AddAccountSheet, type AddFn } from './AddAccountSheet';
import { Sheet } from './Sheet';
import './quickedit.css';

export interface QuickSaveResult {
  ok: boolean;
  message: string;
}
type SaveFn = (input: {
  details: Record<string, unknown> | null;
  monthly: import('@/lib/monthly').Change | null;
}) => Promise<QuickSaveResult>;

interface Api {
  open: (id: string) => void;
  /** opens the "add an account or deposit" sheet, optionally for a given bank and person */
  add: (preset?: { institutionId?: string; ownerId?: string }) => void;
}
const Ctx = createContext<Api | null>(null);

/** The edit panel, once per page. Rows call `open(id)` through <EditButton/>; the panel is also opened by `initialOpen`. */
export function QuickEditProvider({
  rows,
  owners,
  institutions,
  styles,
  today,
  fxHint = {},
  save,
  addItem,
  initialOpen,
  children,
}: {
  rows: QuickRow[];
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  today: string;
  fxHint?: Record<string, number>;
  /** without it the panel is a sample: it works but says nothing is saved */
  save?: SaveFn;
  /** adds an account or deposit; without it the form is a sample */
  addItem?: AddFn;
  initialOpen?: string | null;
  children: ReactNode;
}) {
  const [stored, setStored] = useState<Record<string, QuickRow>>(() =>
    Object.fromEntries(rows.map((r) => [r.id, r])),
  );
  // after the page refreshes (a save, an added account) the rows from the server are the truth
  useEffect(() => {
    setStored(Object.fromEntries(rows.map((r) => [r.id, r])));
  }, [rows]);
  const [openId, setOpenId] = useState<string | null>(
    initialOpen && rows.some((r) => r.id === initialOpen) ? initialOpen : null,
  );
  const [adding, setAdding] = useState<Partial<AddDraft> | null>(null);
  const api = useMemo<Api>(
    () => ({
      open: (id) => {
        setAdding(null);
        setOpenId(id);
      },
      add: (preset) => {
        setOpenId(null);
        setAdding(preset ?? {});
      },
    }),
    [],
  );
  // a link such as /accounts?edit=<id> opens that account's panel, also when the page was already showing
  useEffect(() => {
    if (initialOpen && rows.some((r) => r.id === initialOpen)) setOpenId(initialOpen);
  }, [initialOpen, rows]);
  const row = openId ? stored[openId] : undefined;
  return (
    <Ctx.Provider value={api}>
      {children}
      {row && (
        <Panel
          key={row.id}
          was={row}
          owners={owners}
          institutions={institutions}
          styles={styles}
          today={today}
          fxHint={fxHint}
          {...(save ? { save } : {})}
          onSaved={(next) => setStored((s) => ({ ...s, [next.id]: next }))}
          onClose={() => setOpenId(null)}
        />
      )}
      {adding && (
        <AddAccountSheet
          preset={adding}
          owners={owners}
          institutions={institutions}
          styles={styles}
          {...(addItem ? { addItem } : {})}
          onClose={() => setAdding(null)}
        />
      )}
    </Ctx.Provider>
  );
}

export function useQuickEdit(): Api | null {
  return useContext(Ctx);
}

/** A small "Edit" button for a row. It shows nothing where the panel is not available. */
export function EditButton({
  id,
  name,
  className = '',
  label = 'Edit',
  title,
  plain = false,
  button = false,
}: {
  id: string;
  name: string;
  className?: string;
  /** the words on the button */
  label?: string;
  title?: string;
  /** a bare button (no pencil, no pill border) for use inside another style */
  plain?: boolean;
  /** drawn as a regular compact button (page headers) instead of the small pill used in tables */
  button?: boolean;
}) {
  const q = useContext(Ctx);
  if (!q) return null;
  return (
    <button
      type="button"
      className={`${button ? 'btn compact' : plain ? 'plainbtn' : 'editbtn'} ${className}`}
      onClick={() => q.open(id)}
      aria-label={`Edit ${name}`}
      title={title ?? `Edit ${name}`}
    >
      {!plain && !button && (
        <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
          <path
            d="M3 14.5V17h2.5l7.4-7.4-2.5-2.5L3 14.5zm11.7-6.8a.7.7 0 0 0 0-1l-1.4-1.4a.7.7 0 0 0-1 0l-1.1 1.1 2.5 2.5 1-1.2z"
            fill="currentColor"
          />
        </svg>
      )}
      <span>{label}</span>
    </button>
  );
}

/** A button that opens the "add an account or a deposit" sheet; it shows nothing where the sheet is not available. */
export function AddButton({
  label = 'Add an account',
  className = 'btn',
  preset,
}: {
  label?: string;
  className?: string;
  preset?: { institutionId?: string; ownerId?: string };
}) {
  const q = useContext(Ctx);
  if (!q) return null;
  return (
    <button type="button" className={className} onClick={() => q.add(preset)}>
      {label}
    </button>
  );
}

function Panel({
  was,
  owners,
  institutions,
  styles,
  today,
  fxHint,
  save,
  onSaved,
  onClose,
}: {
  was: QuickRow;
  owners: { id: string; name: string }[];
  institutions: { id: string; name: string }[];
  styles: Record<string, PersonStyle>;
  today: string;
  fxHint: Record<string, number>;
  save?: SaveFn;
  onSaved: (next: QuickRow) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState<EditRow>(was);
  const [draft, setDraft] = useState<QuickDraft>({
    balance: '',
    balanceOn: today,
    fx: '',
    savingsRate: was.savingsRate,
  });
  const [result, setResult] = useState<QuickSaveResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();

  const q = useMemo(
    () => buildQuickSave(was, now, draft, today, fxHint),
    [was, now, draft, today, fxHint],
  );
  const dirty = q.changes.length > 0;
  const layout = quickLayout(was.kind, was.currency);
  // the name and note run full width; when the rest would leave one box alone on a row, that box runs full width too
  const narrow = layout.main.filter((x) => x !== 'label' && x !== 'balance' && x !== 'notes');
  const wideSet = new Set<string>([
    'label',
    'notes',
    ...(narrow.length % 2 ? [narrow[narrow.length - 1]!] : []),
  ]);
  const W = (f: string) => (wideSet.has(f) ? ' qe-wide' : '');
  const person = styles[now.ownerId];

  const requestClose = useCallback(() => {
    if (dirty && !result?.ok) setAsking(true);
    else onClose();
  }, [dirty, result, onClose]);

  const set = (patch: Partial<EditRow>) => {
    setResult(null);
    setNow((n) => ({ ...n, ...patch }));
  };
  const setD = (patch: Partial<QuickDraft>) => {
    setResult(null);
    setDraft((d) => ({ ...d, ...patch }));
  };

  const doSave = () =>
    start(async () => {
      if (!save) {
        setResult({ ok: true, message: 'This is a sample: nothing is saved.' });
        return;
      }
      const res = await save({ details: q.details, monthly: q.monthly });
      if (!res.ok) {
        setResult(res);
        return;
      }
      setResult({ ok: true, message: savedMessage(q.changes) });
      const bal = q.monthly?.amount;
      onSaved({
        ...now,
        code: was.code,
        bankName: institutions.find((i) => i.id === now.institutionId)?.name ?? was.bankName,
        ownerName: owners.find((o) => o.id === now.ownerId)?.name ?? was.ownerName,
        currency: was.currency,
        recorded: typeof bal === 'number' ? bal : was.recorded,
        recordedOn: typeof bal === 'number' ? (q.monthly?.asOf ?? today) : was.recordedOn,
        savingsRate: draft.savingsRate.trim(),
      });
      setDraft((d) => ({ ...d, balance: '' }));
    });

  const text = (
    f: keyof EditRow,
    label: string,
    p: {
      placeholder?: string;
      inputMode?: 'numeric' | 'decimal';
      type?: string;
      help?: string;
      maxLength?: number;
    } = {},
  ) => (
    <label key={f} className={`qe-f${W(String(f))}`}>
      <span>{label}</span>
      <input
        value={String(now[f] ?? '')}
        onChange={(e) => set({ [f]: e.target.value } as Partial<EditRow>)}
        type={p.type ?? 'text'}
        inputMode={p.inputMode}
        placeholder={p.placeholder}
        maxLength={p.maxLength}
        autoComplete="off"
      />
      {p.help && <small className="muted">{p.help}</small>}
    </label>
  );

  const field = (f: QuickField): ReactNode => {
    switch (f) {
      case 'label':
        return text('label', 'Name', { placeholder: was.code, help: 'How you want to see it.' });
      case 'balance':
        return (
          <div key={f} className="qe-f qe-bal">
            <label>
              <span>Balance now{was.currency === 'INR' ? '' : ` (${was.currency})`}</span>
              <input
                value={draft.balance}
                onChange={(e) => setD({ balance: e.target.value })}
                inputMode="decimal"
                autoComplete="off"
                placeholder={
                  was.recorded === null ? 'Type the balance' : String(Math.round(was.recorded))
                }
              />
            </label>
            <label>
              <span>As of</span>
              <input
                type="date"
                max={today}
                value={draft.balanceOn}
                onChange={(e) => setD({ balanceOn: e.target.value || today })}
              />
            </label>
            {was.currency !== 'INR' && (
              <label className="qe-wide">
                <span>Rupees per {was.currency}</span>
                <input
                  value={draft.fx}
                  onChange={(e) => setD({ fx: e.target.value })}
                  inputMode="decimal"
                  placeholder={fxHint[was.currency] ? String(fxHint[was.currency]) : ''}
                />
              </label>
            )}
            <small className="muted qe-wide">
              {was.recorded === null
                ? 'No balance recorded yet.'
                : `Last recorded ${was.recorded.toLocaleString('en-IN')} on ${was.recordedOn ?? 'an earlier date'}. Leave empty to keep it.`}
              {was.recorded !== null && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="linkbtn"
                    onClick={() => setD({ balance: String(was.recorded) })}
                  >
                    Use the same balance
                  </button>
                </>
              )}
            </small>
          </div>
        );
      case 'savingsRate':
        return (
          <label key={f} className={`qe-f${W(f)}`}>
            <span>Interest rate (% a year)</span>
            <input
              value={draft.savingsRate}
              onChange={(e) => setD({ savingsRate: e.target.value })}
              inputMode="decimal"
              placeholder="the bank's rate"
              autoComplete="off"
            />
            <small className="muted">Leave empty to use the bank&rsquo;s rate.</small>
          </label>
        );
      case 'accountKind':
        return (
          <label key={f} className={`qe-f${W(f)}`}>
            <span>Type</span>
            <select value={now.accountKind} onChange={(e) => set({ accountKind: e.target.value })}>
              <option value="">
                {now.inferred ? `Not set (shows as ${now.inferred})` : 'Not set'}
              </option>
              {KIND_OPTIONS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
        );
      case 'fdRate':
        return text('fdRate', 'Interest rate (% a year)', {
          inputMode: 'decimal',
          placeholder: '7.25',
        });
      case 'fdMaturityOn':
        return text('fdMaturityOn', 'Matures on', { type: 'date' });
      case 'fdBookedOn':
        return text('fdBookedOn', 'Started on', { type: 'date' });
      case 'fdPrincipal':
        return text('fdPrincipal', 'Amount invested', { inputMode: 'numeric' });
      case 'fdMaturityAmount':
        return text('fdMaturityAmount', 'Amount at maturity', {
          inputMode: 'numeric',
          placeholder: 'worked out',
          help: 'Leave empty to work it out from the rate and dates.',
        });
      case 'notes':
        return (
          <label key={f} className="qe-f qe-wide">
            <span>Note</span>
            <textarea
              rows={2}
              value={now.notes}
              maxLength={500}
              onChange={(e) => set({ notes: e.target.value })}
              placeholder="Minimum balance, cards, lounge access…"
            />
          </label>
        );
      case 'status':
        return (
          <label key={f} className={`qe-f${W(f)}`}>
            <span>Status</span>
            <select value={now.status} onChange={(e) => set({ status: e.target.value })}>
              {statusOptions(was.kind, was.status).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        );
      case 'ownerId':
        return (
          <label key={f} className={`qe-f${W(f)}`}>
            <span>Whose</span>
            <select value={now.ownerId} onChange={(e) => set({ ownerId: e.target.value })}>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {styles[o.id]?.name ?? o.name}
                </option>
              ))}
            </select>
          </label>
        );
      case 'institutionId':
        return (
          <label key={f} className={`qe-f${W(f)}`}>
            <span>Bank</span>
            <select
              value={now.institutionId}
              onChange={(e) => set({ institutionId: e.target.value })}
            >
              {institutions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
        );
      case 'joint':
        return (
          <div key={f} className="qe-f qe-wide qe-joint">
            <label className="check">
              <input
                type="checkbox"
                checked={now.isJoint}
                onChange={(e) =>
                  set({
                    isJoint: e.target.checked,
                    ...(e.target.checked ? {} : { jointHolderId: '' }),
                  })
                }
              />{' '}
              Joint account
            </label>
            {now.isJoint && (
              <div className="qe-grid2">
                <label className="qe-f">
                  <span>Second name</span>
                  <select
                    value={now.jointHolderId}
                    onChange={(e) => set({ jointHolderId: e.target.value })}
                  >
                    <option value="">Not set</option>
                    {owners
                      .filter((o) => o.id !== now.ownerId)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn compact"
                  disabled={!now.jointHolderId}
                  onClick={() => {
                    const p = swapNames(now);
                    if (p) set(p);
                  }}
                  title="Swap the first and second name. The first name is the one on record."
                >
                  Swap the two names
                </button>
              </div>
            )}
          </div>
        );
      case 'last4':
        return text('last4', 'Last four digits of the account', {
          placeholder: '0266',
          maxLength: 4,
        });
      case 'linkedLast4':
        return text('linkedLast4', 'Linked savings account (last four)', {
          placeholder: '0266',
          maxLength: 4,
        });
      case 'fdRefLast4':
        return text('fdRefLast4', 'Deposit number', {
          placeholder: '300017790142-1',
          maxLength: 40,
        });
      case 'holderName':
        return text('holderName', 'Held by');
    }
  };

  const title = was.label || was.code;
  return (
    <Sheet labelId="qe-title" onRequestClose={requestClose} onClose={onClose}>
      <form
        className="qe-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (dirty && q.problems.length === 0 && !pending) doSave();
        }}
      >
        <header className="qe-head" style={{ ['--person' as string]: person?.colour }}>
          <div>
            <p className="qe-kicker">
              {was.bankName}
              {person && (
                <>
                  {' · '}
                  <span className="qe-who">
                    <span className="qe-dot" aria-hidden />
                    {person.name}
                  </span>
                </>
              )}
            </p>
            <h2 id="qe-title">{title}</h2>
            <p className="muted small">
              {was.kind === 'fd'
                ? 'Fixed deposit'
                : was.kind === 'held'
                  ? 'Held by someone else'
                  : 'Savings account'}
              {was.label ? ` · ${was.code}` : ''}
            </p>
          </div>
          <button type="button" className="qe-x" onClick={requestClose} aria-label="Close">
            <span aria-hidden>×</span>
          </button>
        </header>

        <div className="qe-body">
          <div className="qe-grid">{layout.main.map(field)}</div>
          <details className="qe-more">
            <summary>More details</summary>
            <div className="qe-grid">{layout.more.map(field)}</div>
          </details>
          {q.problems.length > 0 && (
            <ul className="qe-problems" role="alert">
              {q.problems.map((p) => (
                <li key={p}>Please check: {p}.</li>
              ))}
            </ul>
          )}
        </div>

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
                {result
                  ? result.ok
                    ? `✓ ${result.message}`
                    : result.message
                  : dirty
                    ? `Changed: ${q.changes.join(', ')}.`
                    : 'No changes yet.'}
              </span>
              <button type="button" className="btn" onClick={requestClose}>
                {result?.ok ? 'Done' : 'Cancel'}
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={pending || !dirty || q.problems.length > 0}
              >
                {pending ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </footer>
      </form>
    </Sheet>
  );
}
