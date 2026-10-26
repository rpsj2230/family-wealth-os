'use client';

import type { PersonStyle } from '@fwos/core';
import { PersonBadge } from '@/components/Person';
import { addCashflow, saveOwnerProfile, updateCashflow, deleteCashflow } from './actions';
import { Field, Msg, SaveRow, Tick, useForm } from './fields';

export interface PersonRow {
  id: string;
  name: string;
  dob: string;
  panLast4: string | null;
  residency: string;
  guardian: string;
  planRole: string;
  isMinor: boolean;
  notes: string;
}

/** The suggestions behind the tax-residency box; rendered once per page. */
export function ResidencyList() {
  return (
    <datalist id="residency-list">
      <option value="NRI (non-resident Indian)" />
      <option value="Resident Indian" />
      <option value="Singapore tax resident" />
    </datalist>
  );
}

export function PersonForm({
  p,
  others,
  style,
}: {
  p: PersonRow;
  others: { id: string; name: string }[];
  style?: PersonStyle | undefined;
}) {
  const { res, act, pending } = useForm(saveOwnerProfile);
  const missing = [!p.dob ? 'date of birth' : '', !p.panLast4 && !p.isMinor ? 'PAN' : ''].filter(
    Boolean,
  );
  return (
    <form
      action={act}
      className="card form personform personcard"
      style={{ ['--person' as string]: style?.colour }}
      aria-busy={pending}
    >
      <input type="hidden" name="owner" value={p.id} />
      <header className="personhead">
        <h3>
          <PersonBadge p={style} name size={26} />
          {style ? '' : p.name}
        </h3>
        {p.isMinor && <span className="pill">Child</span>}
        {p.panLast4 ? (
          <span className="pill ok">PAN saved, ends {p.panLast4}</span>
        ) : p.isMinor ? null : (
          <span className="pill warn">PAN not saved</span>
        )}
        {missing.length > 0 && <span className="pill warn">Missing: {missing.join(', ')}</span>}
      </header>
      <div className="formgrid g3">
        <Field
          label="Date of birth"
          hint="Sets the retirement ages, and who is a child for tax and the handbook."
        >
          <input name="dob" type="date" defaultValue={p.dob} />
        </Field>
        <Field
          label={p.panLast4 ? `PAN (saved, ends ${p.panLast4})` : 'PAN'}
          hint="Write-only. Used only to open this person’s fund statements; after saving, only the last four characters are ever shown."
        >
          <input
            name="pan"
            autoComplete="off"
            maxLength={10}
            placeholder={p.panLast4 ? 'type to replace' : 'ABCDE1234F'}
            style={{ textTransform: 'uppercase' }}
          />
        </Field>
      </div>
      <details className="disclose" open={p.isMinor && !p.guardian}>
        <summary>Residency, role, guardian and notes</summary>
        <div className="formgrid g3">
          <Field
            label="Tax residency"
            hint="Shown on the tax pages and in the handbook. Plain words are fine."
          >
            <input
              name="residency"
              list="residency-list"
              defaultValue={p.residency}
              placeholder="e.g. NRI, Singapore tax resident"
            />
          </Field>
          <Field
            label="Role in the retirement plan"
            hint="“Can I retire now?” plans for one primary person and one spouse."
          >
            <select name="planRole" defaultValue={p.planRole}>
              <option value="">Not in the plan</option>
              <option value="primary">Primary person</option>
              <option value="spouse">Spouse</option>
            </select>
          </Field>
          <Field
            label="Guardian (for a child)"
            hint="The adult who handles this child’s money and signs for them."
          >
            <select name="guardian" defaultValue={p.guardian}>
              <option value="">None</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Notes" hint="Anything worth remembering, for example “no PAN yet”.">
            <input
              name="notes"
              defaultValue={p.notes}
              placeholder="e.g. guardian files the return"
            />
          </Field>
        </div>
      </details>
      <div className="row ticks">
        <Tick name="minor" label="This person is a child" defaultChecked={p.isMinor} />
        {p.panLast4 && <Tick name="clearPan" label="Remove the saved PAN" />}
      </div>
      <SaveRow label={`Save ${p.name}`} pending={pending} res={res} />
    </form>
  );
}

export interface FlowRow {
  id: string;
  ownerId: string | null;
  kind: 'income' | 'expense';
  label: string;
  amount: number;
  currency: string;
  frequency: 'monthly' | 'yearly';
}

/** One income or spending line, editable in place: change the amount and press Save. */
export function CashflowRow({ f, whose }: { f: FlowRow; whose: string }) {
  const { res, act, pending } = useForm(updateCashflow);
  return (
    <form action={act} className="flowrow" aria-busy={pending}>
      <input type="hidden" name="id" value={f.id} />
      <div className="flow-name">
        <strong>{f.label}</strong>
        <span className="muted small">
          {f.kind === 'income' ? 'Income' : 'Spending'} · {whose}
        </span>
      </div>
      <input
        name="amount"
        inputMode="decimal"
        defaultValue={f.amount}
        aria-label={`Amount for ${f.label}`}
        className="flow-amt"
      />
      <input
        name="currency"
        defaultValue={f.currency}
        maxLength={3}
        aria-label={`Currency for ${f.label}`}
        className="flow-cur"
        style={{ textTransform: 'uppercase' }}
      />
      <select name="frequency" defaultValue={f.frequency} aria-label={`How often for ${f.label}`}>
        <option value="monthly">a month</option>
        <option value="yearly">a year</option>
      </select>
      <button className="btn compact" disabled={pending}>
        Save
      </button>
      <button
        className="btn compact ghost"
        formAction={deleteCashflow}
        aria-label={`Remove ${f.label}`}
      >
        Remove
      </button>
      <Msg r={res} />
    </form>
  );
}

export function CashflowForm({ people }: { people: { id: string; name: string }[] }) {
  const { res, act, pending } = useForm(addCashflow);
  return (
    <form action={act} className="form addflow" aria-busy={pending}>
      <h4>Add a line</h4>
      <div className="formgrid g4">
        <Field label="What is it">
          <select name="kind" defaultValue="income">
            <option value="income">Income</option>
            <option value="expense">Spending</option>
          </select>
        </Field>
        <Field label="Name" hint="For example Salary, Rent, Household.">
          <input name="label" required />
        </Field>
        <Field label="Whose">
          <select name="owner" defaultValue="">
            <option value="">Household</option>
            {people.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Amount" hint="In its own currency, for example 4,500 in SGD.">
          <input name="amount" inputMode="decimal" required />
        </Field>
        <Field label="Currency" hint="Three letters.">
          <input
            name="currency"
            defaultValue="INR"
            maxLength={3}
            style={{ textTransform: 'uppercase' }}
          />
        </Field>
        <Field label="How often">
          <select name="frequency" defaultValue="monthly">
            <option value="monthly">a month</option>
            <option value="yearly">a year</option>
          </select>
        </Field>
      </div>
      <SaveRow label="Add" pending={pending} res={res} />
    </form>
  );
}
