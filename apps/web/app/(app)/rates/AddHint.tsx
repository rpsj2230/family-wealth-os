'use client';

import { useActionState } from 'react';
import { addHint } from './actions';

/** Write a rule for the reader yourself; it is passed along with the learned ones at the next refresh. */
export function AddHint({ bank }: { bank: string }) {
  const [res, act, pending] = useActionState(addHint, null);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <input type="hidden" name="bank" value={bank} />
      <label>
        A rule for the next refresh
        <input
          name="hint"
          placeholder="For example: read the Regular column, not Senior Citizens"
          maxLength={400}
          required
        />
      </label>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn compact" disabled={pending}>
          Save rule
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
