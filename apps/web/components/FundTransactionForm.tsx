'use client';

import { useActionState } from 'react';
import { addFundTransaction } from '@/app/(app)/investments/update/actions';

/** A single buy, SIP instalment, switch or sale. Units can be left out when the price is given. */
export function FundTransactionForm({
  funds,
  today,
  save = addFundTransaction,
}: {
  funds: { id: string; name: string; owner: string }[];
  today: string;
  /** the public sample passes a stand-in that saves nothing */
  save?: typeof addFundTransaction;
}) {
  const [state, action, pending] = useActionState(save, null);
  return (
    <form action={action} className="card txnform">
      <h2>Add a transaction</h2>
      <p className="muted small">
        For a purchase, SIP instalment, switch or sale between monthly updates. Units and the amount
        put in are updated for you. Sales take out the same share of both.
      </p>
      <div className="row" style={{ flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
        <label>
          Fund
          <select name="asset" required defaultValue="">
            <option value="" disabled>
              Choose…
            </option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name} ({f.owner})
              </option>
            ))}
          </select>
        </label>
        <label>
          Type
          <select name="kind" defaultValue="sip">
            <option value="sip">SIP instalment</option>
            <option value="purchase">Purchase</option>
            <option value="redeem">Sale / redemption</option>
            <option value="switch_in">Switch in</option>
            <option value="switch_out">Switch out</option>
            <option value="dividend_reinvest">Dividend reinvested</option>
          </select>
        </label>
        <label>
          Date
          <input type="date" name="date" defaultValue={today} max={today} required />
        </label>
        <label>
          Amount (₹)
          <input name="amount" inputMode="decimal" required style={{ width: 120 }} />
        </label>
        <label>
          Price per unit
          <input name="nav" inputMode="decimal" style={{ width: 110 }} />
        </label>
        <label>
          Units
          <input name="units" inputMode="decimal" style={{ width: 110 }} />
        </label>
        <label className="check" style={{ alignSelf: 'center' }}>
          <input type="checkbox" name="all" /> Sold every unit (closes the fund, stops its SIP)
        </label>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Adding…' : 'Add'}
        </button>
      </div>
      {state && (
        <p role="status" className={state.ok ? 'ok' : 'fail'}>
          {state.message}
        </p>
      )}
    </form>
  );
}
