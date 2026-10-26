'use client';

import { useActionState, useState } from 'react';
import { importRateNotes } from './actions';

/** Paste rates the way you jot them down; one bank per line. Reading rules are shown so nothing is a surprise. */
export function ImportNotes({ example }: { example: string }) {
  const [res, act, pending] = useActionState(importRateNotes, null);
  const [text, setText] = useState('');
  return (
    <form action={act} className="form" aria-busy={pending}>
      <label>
        <span className="sr-only">Rates, one bank per line</span>
        <textarea
          name="notes"
          rows={8}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            'Jana Bank - Saving [2.5%-1Lk, 3.50% - 1Lk to 5Lk, 7% - above 50 lk], NRE FD[8% -2 Yr]'
          }
          aria-label="Rates, one bank per line"
          style={{ width: '100%', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}
        />
      </label>
      <p className="muted small">
        One bank per line:{' '}
        <code>Bank - Saving [2.5%-1Lk, 3.5% - 1Lk to 5Lk, 7% - above 50Lk], NRE FD[8% -2 Yr]</code>.
        Savings slabs are &ldquo;up to&rdquo;, &ldquo;from … to …&rdquo; or &ldquo;above&rdquo;;
        deposits take years, months or days. Pasting a bank again replaces the rates you typed for
        it; rates read from a bank page are kept.
      </p>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending || text.trim() === ''}>
          {pending ? 'Reading…' : 'Save these rates'}
        </button>
        <button type="button" className="btn ghost" onClick={() => setText(example)}>
          Fill in an example
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
