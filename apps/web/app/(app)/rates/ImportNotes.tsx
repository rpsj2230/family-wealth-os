'use client';

import { useActionState } from 'react';
import { importRateNotes } from './actions';

/** Paste rates the way you jot them down; one bank per line. Reading rules are shown so nothing is a surprise. */
export function ImportNotes({ example }: { example: string }) {
  const [res, act, pending] = useActionState(importRateNotes, null);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <textarea
        name="notes"
        rows={8}
        defaultValue={example}
        aria-label="Rates, one bank per line"
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
      />
      <p className="muted small">
        Write each bank on one line:{' '}
        <code>Bank - Saving [2.5%-1Lk, 3.5% - 1Lk to 5Lk, 7% - above 50Lk], NRE FD[8% -2 Yr]</code>.
        Savings slabs are &ldquo;up to&rdquo;, &ldquo;from … to …&rdquo; or &ldquo;above&rdquo;;
        deposits take years, months or days. Pasting a bank again replaces the rates you typed for
        it.
      </p>
      <div className="row">
        <button className="btn primary" disabled={pending}>
          {pending ? 'Reading…' : 'Save these rates'}
        </button>
        {res && (
          <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
            {res.message}
          </span>
        )}
      </div>
    </form>
  );
}
