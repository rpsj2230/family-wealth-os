'use client';

import { useActionState, useEffect, useRef, type ReactNode } from 'react';

export interface ActionResult {
  ok: boolean;
  message: string;
}

/**
 * A form that runs a server action and says what happened right under the button: "Saved" or what to fix.
 * The fields are cleared after a success unless `keepAfterSave` is set, so the next entry starts empty.
 */
export function ActionForm({
  action,
  children,
  submit,
  busy = 'Saving…',
  className = 'formrow',
  primary = false,
  keepAfterSave = false,
  disabled = false,
}: {
  action: (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;
  children: ReactNode;
  submit: string;
  busy?: string;
  className?: string;
  primary?: boolean;
  keepAfterSave?: boolean;
  /** the public samples show the form but cannot save */
  disabled?: boolean;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && !keepAfterSave) ref.current?.reset();
  }, [state, keepAfterSave]);
  return (
    <form ref={ref} action={run} className={className}>
      {children}
      <button className={`btn ${primary ? 'primary' : ''}`} disabled={pending || disabled}>
        {pending ? busy : submit}
      </button>
      {state && (
        <p
          role={state.ok ? 'status' : 'alert'}
          className={`small ${state.ok ? 'ok' : 'fail'}`}
          style={{ flexBasis: '100%', margin: 0 }}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
