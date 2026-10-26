'use client';

import { useActionState } from 'react';
import { addRateOffer } from './actions';

export function AddOffer({ banks }: { banks: string[] }) {
  const [res, act, pending] = useActionState(addRateOffer, null);
  return (
    <form action={act} className="form row addform" aria-busy={pending}>
      <input name="bank" list="bank-names" placeholder="Bank" aria-label="Bank" required />
      <datalist id="bank-names">
        {banks.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <select name="product" aria-label="Product" defaultValue="fd">
        <option value="fd">Fixed deposit</option>
        <option value="savings">Savings</option>
      </select>
      <select name="kind" aria-label="Account type" defaultValue="NRE">
        <option value="NRE">NRE</option>
        <option value="NRO">NRO</option>
        <option value="resident">Resident</option>
        <option value="any">Any</option>
      </select>
      <input
        name="from"
        inputMode="numeric"
        placeholder="From months"
        aria-label="Shortest tenure in months"
        style={{ maxWidth: 110 }}
      />
      <input
        name="to"
        inputMode="numeric"
        placeholder="To months"
        aria-label="Longest tenure in months"
        style={{ maxWidth: 110 }}
      />
      <input
        name="rate"
        inputMode="decimal"
        placeholder="Rate %"
        aria-label="Rate in percent"
        required
        style={{ maxWidth: 90 }}
      />
      <input
        name="balfrom"
        placeholder="Savings: above (e.g. 1 lakh)"
        aria-label="Savings slab starts above this balance"
        style={{ maxWidth: 150 }}
      />
      <input
        name="balto"
        placeholder="up to (e.g. 5 lakh)"
        aria-label="Savings slab ends at this balance"
        style={{ maxWidth: 130 }}
      />
      <input name="conditions" placeholder="Conditions (optional)" aria-label="Conditions" />
      <button className="btn compact primary" disabled={pending}>
        Save rate
      </button>
      {res && (
        <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
          {res.message}
        </span>
      )}
    </form>
  );
}
