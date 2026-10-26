'use client';

import { useActionState } from 'react';
import { addTasksBulk } from './actions';

export function BulkTasks() {
  const [res, act, pending] = useActionState(addTasksBulk, null);
  return (
    <details className="card">
      <summary>Add many tasks at once (for example a plan with dates)</summary>
      <form action={act} className="form" aria-busy={pending}>
        <p className="muted small">
          One task per line, starting with the date: <code>2026-10-27 | Sell the folios</code> or{' '}
          <code>27 Oct 2026 - Renew the deposit</code>. Tasks due within the reminder window appear
          in the daily summary.
        </p>
        <textarea
          name="lines"
          rows={6}
          placeholder={
            '2026-11-04 | Register the new SIP mandates\n2027-03-31 | Finish the tax-gain harvest'
          }
        />
        <div className="row" style={{ alignItems: 'center' }}>
          <button className="btn primary" disabled={pending}>
            Add the tasks
          </button>
          {res && (
            <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
              {res.message}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}
