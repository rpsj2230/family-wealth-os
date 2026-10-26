'use client';

import { useActionState, type ReactNode } from 'react';
import type { FormResult } from './actions';

type Action = (prev: FormResult | null, f: FormData) => Promise<FormResult>;

/** The saved-state message under a form: green and polite when it worked, red and assertive when it did not. */
export function Msg({ r, pending }: { r: FormResult | null; pending?: boolean }) {
  if (pending) return <span className="muted small">Saving…</span>;
  if (!r) return null;
  return (
    <span className={r.ok ? 'ok small saved' : 'fail small saved'} role={r.ok ? 'status' : 'alert'}>
      {r.ok ? '✓ ' : ''}
      {r.message}
    </span>
  );
}

export function useForm(action: Action) {
  const [res, act, pending] = useActionState(action, null);
  return { res, act, pending };
}

/** A labelled box with an optional unit after it and a one-line "what this changes". */
export function Field({
  label,
  hint,
  unit,
  children,
  wide,
}: {
  label: string;
  hint?: string | undefined;
  unit?: string | undefined;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <label className={`fld ${wide ? 'wide' : ''}`}>
      <span className="fld-label">{label}</span>
      {unit ? (
        <span className="fld-input">
          {children}
          <span className="fld-unit">{unit}</span>
        </span>
      ) : (
        children
      )}
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  );
}

/** A tick box with its explanation underneath. */
export function Tick({
  name,
  label,
  hint,
  defaultChecked,
}: {
  name: string;
  label: string;
  hint?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="fld tick">
      <span className="tick-row">
        <input type="checkbox" name={name} defaultChecked={defaultChecked} />
        <span className="fld-label">{label}</span>
      </span>
      {hint && <span className="fld-hint">{hint}</span>}
    </label>
  );
}

/** The footer of every form: the button, then what happened. */
export function SaveRow({
  label,
  pending,
  res,
  extra,
}: {
  label: string;
  pending: boolean;
  res: FormResult | null;
  extra?: ReactNode;
}) {
  return (
    <div className="saverow">
      <button className="btn primary" disabled={pending}>
        {label}
      </button>
      {extra}
      <Msg r={res} pending={pending} />
    </div>
  );
}

/** Whether a setting has been looked at by the household or still runs on the built-in number. */
export function StatePill({ confirmed }: { confirmed: boolean }) {
  return confirmed ? (
    <span className="pill ok">Confirmed by you</span>
  ) : (
    <span className="pill warn">Built-in numbers: please confirm</span>
  );
}
