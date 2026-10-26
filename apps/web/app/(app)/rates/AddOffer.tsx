'use client';

import { useActionState, useId, useState } from 'react';
import { addRateOffer } from './actions';
import './rates.css';

/**
 * Add or correct one rate. Only the fields that apply are shown: a deposit has a term, a savings rate has a balance slab.
 * Saving a rate that already exists changes it in place. `bank` fixes the bank (on a bank's own page).
 */
export function AddOffer({ banks, bank }: { banks: string[]; bank?: string }) {
  const [res, act, pending] = useActionState(addRateOffer, null);
  const [product, setProduct] = useState<'fd' | 'savings'>('fd');
  const id = useId();
  return (
    <form action={act} className="rt-add" aria-busy={pending}>
      <div className="rt-fields">
        {bank ? (
          <input type="hidden" name="bank" value={bank} />
        ) : (
          <label>
            Bank
            <input name="bank" list={`${id}-banks`} placeholder="Bank name" required />
            <datalist id={`${id}-banks`}>
              {banks.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </label>
        )}
        <div role="group" aria-label="What kind of rate" className="rt-type">
          <span className="small muted" style={{ display: 'block', marginBottom: 4 }}>
            Type
          </span>
          <div className="rt-seg">
            <label>
              <input
                type="radio"
                name="product"
                value="fd"
                checked={product === 'fd'}
                onChange={() => setProduct('fd')}
              />
              <span>Fixed deposit</span>
            </label>
            <label>
              <input
                type="radio"
                name="product"
                value="savings"
                checked={product === 'savings'}
                onChange={() => setProduct('savings')}
              />
              <span>Savings</span>
            </label>
          </div>
        </div>
        <label>
          Account
          <select name="kind" defaultValue="NRE">
            <option value="NRE">NRE</option>
            <option value="NRO">NRO</option>
            <option value="resident">Resident</option>
            <option value="any">Any</option>
          </select>
        </label>
        <label>
          Rate (% a year)
          <input name="rate" inputMode="decimal" placeholder="7.25" required />
        </label>
        {product === 'fd' ? (
          <>
            <label>
              Term
              <input name="term" inputMode="numeric" placeholder="2" required />
            </label>
            <label>
              Term in
              <select name="unit" defaultValue="years">
                <option value="years">years</option>
                <option value="months">months</option>
                <option value="days">days</option>
              </select>
            </label>
          </>
        ) : (
          <>
            <label>
              Balance above
              <input name="balfrom" placeholder="blank, or 1 lakh" />
            </label>
            <label>
              Up to
              <input name="balto" placeholder="blank, or 5 lakh" />
            </label>
          </>
        )}
        <label>
          Conditions (optional)
          <input name="conditions" placeholder="for example: new money only" />
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          {pending ? 'Saving…' : 'Save rate'}
        </button>
        <span className="muted small">
          A rate you type is never overwritten by the refresh; if the bank page later disagrees, you
          are shown the difference.
        </span>
        {res && (
          <span className={res.ok ? 'ok small' : 'fail small'} role={res.ok ? 'status' : 'alert'}>
            {res.message}
          </span>
        )}
      </div>
    </form>
  );
}
