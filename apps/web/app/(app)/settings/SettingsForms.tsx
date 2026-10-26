'use client';

import { useActionState } from 'react';
import {
  contactLines,
  KIND_LABEL,
  LIQUIDITY_KINDS,
  type AppConfig,
  type EmergencyProfile,
} from '@fwos/core';
import {
  addCashflow,
  addRateSource,
  saveConfig,
  saveEmergencyProfile,
  saveLiquidity,
  saveOwnerProfile,
  saveTaxRule,
  type FormResult,
} from './actions';

type Action = (prev: FormResult | null, f: FormData) => Promise<FormResult>;

function Msg({ r }: { r: FormResult | null }) {
  if (!r) return null;
  return (
    <span className={r.ok ? 'ok small' : 'fail small'} role={r.ok ? 'status' : 'alert'}>
      {r.message}
    </span>
  );
}

function useForm(action: Action) {
  const [res, act, pending] = useActionState(action, null);
  return { res, act, pending };
}

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

export function PersonForm({
  p,
  others,
}: {
  p: PersonRow;
  others: { id: string; name: string }[];
}) {
  const { res, act, pending } = useForm(saveOwnerProfile);
  return (
    <form action={act} className="card form personform" aria-busy={pending}>
      <input type="hidden" name="owner" value={p.id} />
      <h3>{p.name}</h3>
      <div className="formgrid g3">
        <label>
          Date of birth
          <input name="dob" type="date" defaultValue={p.dob} />
        </label>
        <label>
          PAN {p.panLast4 ? `(saved, ends ${p.panLast4})` : ''}
          <input
            name="pan"
            autoComplete="off"
            maxLength={10}
            placeholder={p.panLast4 ? 'type to replace' : 'ABCDE1234F'}
            style={{ textTransform: 'uppercase' }}
          />
        </label>
        <label>
          Tax residency
          <input
            name="residency"
            defaultValue={p.residency}
            placeholder="e.g. NRI, Singapore tax resident"
          />
        </label>
        <label>
          Role in the retirement plan
          <select name="planRole" defaultValue={p.planRole}>
            <option value="">None</option>
            <option value="primary">Primary person</option>
            <option value="spouse">Spouse</option>
          </select>
        </label>
        <label>
          Guardian (for a minor)
          <select name="guardian" defaultValue={p.guardian}>
            <option value="">None</option>
            {others.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Notes
          <input
            name="notes"
            defaultValue={p.notes}
            placeholder="e.g. no PAN yet, guardian files the return"
          />
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <label className="check">
          <input type="checkbox" name="minor" defaultChecked={p.isMinor} /> Minor
        </label>
        {p.panLast4 && (
          <label className="check">
            <input type="checkbox" name="clearPan" /> Remove the saved PAN
          </label>
        )}
        <button className="btn compact primary" disabled={pending}>
          Save {p.name}
        </button>
        <Msg r={res} />
      </div>
    </form>
  );
}

export function CashflowForm({ people }: { people: { id: string; name: string }[] }) {
  const { res, act, pending } = useForm(addCashflow);
  return (
    <form action={act} className="form row cashform" aria-busy={pending}>
      <select name="kind" aria-label="Income or spending" defaultValue="income">
        <option value="income">Income</option>
        <option value="expense">Spending</option>
      </select>
      <input
        name="label"
        placeholder="Label, e.g. Salary, Rent, Household"
        aria-label="Label"
        required
      />
      <select name="owner" aria-label="Whose" defaultValue="">
        <option value="">Household</option>
        {people.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <input
        name="amount"
        inputMode="decimal"
        placeholder="Amount"
        aria-label="Amount"
        required
        style={{ maxWidth: 120 }}
      />
      <input
        name="currency"
        placeholder="INR"
        aria-label="Currency"
        defaultValue="INR"
        maxLength={3}
        style={{ maxWidth: 70, textTransform: 'uppercase' }}
      />
      <select name="frequency" aria-label="How often" defaultValue="monthly">
        <option value="monthly">per month</option>
        <option value="yearly">per year</option>
      </select>
      <button className="btn compact primary" disabled={pending}>
        Add
      </button>
      <Msg r={res} />
    </form>
  );
}

export interface ConfigValues {
  limit: number;
  alertDays: string;
  soonDays: number;
  policyDays: number;
  taskDays: number;
  harvestMonth: number;
  harvestDay: number;
  freshness: number;
  savingsRate: number;
  tdsRate: number;
  includeSip: boolean;
  rateStale: number;
  rateGap: number;
  rateGain: number;
  nroTax: number;
  rateTenure: number;
  rateLook: number;
  rateBuffer: number;
  minSell: number;
  margin: number;
  skipSip: boolean;
  nri: boolean;
  incomeLimit: number;
  otherIncome: number;
}

export function ConfigForm({ v }: { v: ConfigValues }) {
  const { res, act, pending } = useForm(saveConfig);
  return (
    <form action={act} className="form" aria-busy={pending}>
      <h3>Deposits</h3>
      <div className="formgrid g3">
        <label>
          Deposit insurance limit per person per bank (₹)
          <input name="limit" inputMode="numeric" defaultValue={v.limit} />
        </label>
        <label>
          Maturity alert steps (days before)
          <input name="alertDays" defaultValue={v.alertDays} />
        </label>
        <label>
          Flag a deposit as &ldquo;maturing soon&rdquo; within (days)
          <input name="soonDays" inputMode="numeric" defaultValue={v.soonDays} />
        </label>
      </div>
      <h3>Reminders in the daily summary</h3>
      <div className="formgrid g3">
        <label>
          Policy renewals and end dates, days ahead
          <input name="policyDays" inputMode="numeric" defaultValue={v.policyDays} />
        </label>
        <label>
          Tasks due within (days)
          <input name="taskDays" inputMode="numeric" defaultValue={v.taskDays} />
        </label>
        <label>
          Tax-harvest reminder: month and day
          <span className="row">
            <input
              name="harvestMonth"
              inputMode="numeric"
              defaultValue={v.harvestMonth}
              aria-label="Month"
              style={{ maxWidth: 70 }}
            />
            <input
              name="harvestDay"
              inputMode="numeric"
              defaultValue={v.harvestDay}
              aria-label="Day"
              style={{ maxWidth: 70 }}
            />
          </span>
        </label>
      </div>
      <h3>Estimates</h3>
      <div className="formgrid g3">
        <label>
          A balance is out of date after (days)
          <input name="freshness" inputMode="numeric" defaultValue={v.freshness} />
        </label>
        <label>
          Assumed savings interest until an account has its own rate (% a year)
          <input name="savingsRate" inputMode="decimal" defaultValue={v.savingsRate} />
        </label>
        <label>
          Tax deducted on interest, assumed (%)
          <input name="tdsRate" inputMode="decimal" defaultValue={v.tdsRate} />
        </label>
        <label className="check">
          <input type="checkbox" name="includeSip" defaultChecked={v.includeSip} /> Add active SIP
          instalments to fund estimates
        </label>
      </div>
      <h3>Interest-rate suggestions</h3>
      <div className="formgrid g4">
        <label>
          Only suggest a move when the after-tax rate is better by (percentage points)
          <input name="rateGap" inputMode="decimal" defaultValue={v.rateGap} />
        </label>
        <label>
          and it earns at least this much more a year (₹)
          <input name="rateGain" inputMode="numeric" defaultValue={v.rateGain} />
        </label>
        <label>
          Tax on NRO interest (%)
          <input name="nroTax" inputMode="decimal" defaultValue={v.nroTax} />
        </label>
        <label>
          A rate counts as old after (days)
          <input name="rateStale" inputMode="numeric" defaultValue={v.rateStale} />
        </label>
        <label>
          Usual tenure for a new deposit (months)
          <input name="rateTenure" inputMode="numeric" defaultValue={v.rateTenure} />
        </label>
        <label>
          Look ahead for maturing deposits (days)
          <input name="rateLook" inputMode="numeric" defaultValue={v.rateLook} />
        </label>
        <label>
          Keep this much in a savings account before suggesting a move (₹)
          <input name="rateBuffer" inputMode="numeric" defaultValue={v.rateBuffer} />
        </label>
      </div>
      <h3>Tax refunds on NRO interest</h3>
      <div className="formgrid g3">
        <label>
          Income per person up to which no Indian tax is due (₹ a year)
          <input name="incomeLimit" inputMode="numeric" defaultValue={v.incomeLimit} />
        </label>
        <label>
          Other taxable Indian income per person besides NRO interest (₹ a year)
          <input name="otherIncome" inputMode="numeric" defaultValue={v.otherIncome} />
        </label>
        <p className="muted small">
          While a person&apos;s total stays under the first figure, tax withheld on their NRO
          deposit interest (the NRO tax rate above, plus cess) is expected back when they file.
        </p>
      </div>
      <h3>Tax-gain harvesting</h3>
      <div className="formgrid g3">
        <label>
          Smallest sale worth suggesting (₹)
          <input name="minSell" inputMode="numeric" defaultValue={v.minSell} />
        </label>
        <label>
          Extra months of holding before counting a fund as long-term
          <input name="margin" inputMode="numeric" defaultValue={v.margin} />
        </label>
        <span>
          <label className="check">
            <input type="checkbox" name="skipSip" defaultChecked={v.skipSip} /> Leave out funds with
            an active SIP
          </label>
          <label className="check">
            <input type="checkbox" name="nri" defaultChecked={v.nri} /> Non-resident: tax is
            withheld on redemption
          </label>
        </span>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          Save limits and reminders
        </button>
        <Msg r={res} />
      </div>
    </form>
  );
}

export interface TaxValues {
  fy: string;
  months: number;
  stcg: number;
  ltcg: number;
  exemption: number;
  cess: number;
  verified: boolean;
  note: string;
}

export function TaxRuleForm({
  v,
  custom,
  isNew,
}: {
  v: TaxValues;
  custom: boolean;
  isNew?: boolean;
}) {
  const { res, act, pending } = useForm(saveTaxRule);
  return (
    <form action={act} className="card form" aria-busy={pending}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>{isNew ? 'Add a financial year' : `Financial year ${v.fy}`}</strong>
        <span className="small muted">
          {isNew ? '' : custom ? 'Your numbers' : 'Built-in defaults (not yet confirmed by you)'}
        </span>
      </div>
      <div className="formgrid g4">
        {isNew ? (
          <label>
            Financial year
            <input name="fy" placeholder="2027-28" required />
          </label>
        ) : (
          <input type="hidden" name="fy" value={v.fy} />
        )}
        <label>
          Months held to be long-term
          <input name="months" inputMode="numeric" defaultValue={v.months} />
        </label>
        <label>
          Short-term rate (%)
          <input name="stcg" inputMode="decimal" defaultValue={v.stcg} />
        </label>
        <label>
          Long-term rate (%)
          <input name="ltcg" inputMode="decimal" defaultValue={v.ltcg} />
        </label>
        <label>
          Tax-free long-term gain per person (₹)
          <input name="exemption" inputMode="numeric" defaultValue={v.exemption} />
        </label>
        <label>
          Cess (%)
          <input name="cess" inputMode="decimal" defaultValue={v.cess} />
        </label>
        <label>
          Where this comes from
          <input name="note" defaultValue={v.note} placeholder="e.g. Finance Act 2027, section …" />
        </label>
        <label className="check">
          <input type="checkbox" name="verified" defaultChecked={v.verified} /> I checked this on
          the official site
        </label>
      </div>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn compact primary" disabled={pending}>
          Save
        </button>
        <Msg r={res} />
      </div>
    </form>
  );
}

export function RateSourceForm() {
  const { res, act, pending } = useForm(addRateSource);
  return (
    <form action={act} className="form row addform" aria-busy={pending}>
      <input name="bank" placeholder="Bank name" aria-label="Bank name" required />
      <input
        name="url"
        placeholder="https://… the bank's published rate page"
        aria-label="Address of the rate page"
        required
        style={{ minWidth: 280 }}
      />
      <button className="btn compact primary" disabled={pending}>
        Add page
      </button>
      <Msg r={res} />
    </form>
  );
}

export function EmergencyForm({ p }: { p: EmergencyProfile }) {
  const { res, act, pending } = useForm(saveEmergencyProfile);
  const area = (name: string, label: string, value: string, rows = 2, hint?: string) => (
    <label>
      {label}
      <textarea name={name} rows={rows} defaultValue={value} placeholder={hint} />
    </label>
  );
  return (
    <form action={act} className="form" aria-busy={pending}>
      {area(
        'message',
        'A message to the family (shown first, and in the short version for the children)',
        p.message,
        3,
        'e.g. We made this so you are never left wondering what to do…',
      )}
      {area(
        'contacts',
        'Call these people first (one per line: name | who they are | phone | note)',
        contactLines(p.contacts),
        4,
        'Uncle Ravi | my brother | +65 9000 0000 | knows where the papers are',
      )}
      {area(
        'advisors',
        'Advisers: lawyer, accountant, insurance agent (one per line, same format)',
        contactLines(p.advisors),
        3,
      )}
      <div className="formgrid">
        {area('willLocation', 'Where the will and estate papers are', p.willLocation)}
        {area(
          'documentsLocation',
          'Where other important documents are (passports, property papers, policies)',
          p.documentsLocation,
        )}
        {area('lockerDetails', 'Bank locker (bank, branch, who has the key)', p.lockerDetails)}
        {area(
          'passwordManager',
          'Where the passwords and logins are (which password manager, who can open it)',
          p.passwordManager,
        )}
        {area(
          'devices',
          'Phones, computers and other devices (where they are, how to unlock)',
          p.devices,
        )}
        {area('emailAccounts', 'Email accounts used for banks and investments', p.emailAccounts)}
        {area(
          'backupKeyLocation',
          'Where the key to the encrypted backups of this app is kept',
          p.backupKeyLocation,
        )}
        {area('nominees', 'Nominees on accounts, funds and policies (who, for which)', p.nominees)}
      </div>
      {area('instructions', 'Anything else the family should know or do', p.instructions, 4)}
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          Save emergency information
        </button>
        <Msg r={res} />
      </div>
    </form>
  );
}

export function LiquidityForm({ c }: { c: AppConfig['liquidity'] }) {
  const { res, act, pending } = useForm(saveLiquidity);
  const pc = (x: number) => Math.round(x * 1e4) / 100;
  return (
    <form action={act} className="form" aria-busy={pending}>
      <h3>Where money may come from, in your order of preference</h3>
      <table className="tbl lines">
        <thead>
          <tr>
            <th>Use it</th>
            <th>Source</th>
            <th className="num">Priority (1 = first)</th>
          </tr>
        </thead>
        <tbody>
          {LIQUIDITY_KINDS.map((k, i) => {
            const at = c.order.indexOf(k);
            return (
              <tr key={k}>
                <td>
                  <input
                    type="checkbox"
                    name={`on_${k}`}
                    defaultChecked={at >= 0}
                    aria-label={`Use ${KIND_LABEL[k]}`}
                  />
                </td>
                <td>{KIND_LABEL[k]}</td>
                <td className="num">
                  <input
                    className="mini"
                    name={`pri_${k}`}
                    inputMode="numeric"
                    defaultValue={at >= 0 ? at + 1 : i + 1}
                    aria-label={`Priority of ${KIND_LABEL[k]}`}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <label>
        How to choose between them
        <select name="mode" defaultValue={c.mode}>
          <option value="cheapest">Cheapest first (least interest, tax and charges lost)</option>
          <option value="fastest">Fastest first</option>
          <option value="order">My priority order above</option>
        </select>
      </label>
      <h3>Costs and timing</h3>
      <div className="formgrid g4">
        <label>
          Leave in each savings account (₹)
          <input name="keepInBank" inputMode="numeric" defaultValue={c.keepInBank} />
        </label>
        <label>
          Interest lost when a deposit is broken early (points a year)
          <input name="fdPenalty" inputMode="decimal" defaultValue={pc(c.fdPenaltyPoints)} />
        </label>
        <label>
          Days for a broken deposit to reach the bank
          <input name="fdBreakDays" inputMode="numeric" defaultValue={c.fdBreakDays} />
        </label>
        <label className="check">
          <input type="checkbox" name="fdPartial" defaultChecked={c.fdPartialBreak} /> My banks let
          me break part of a deposit
        </label>
        <label>
          Working days from selling a fund to the money
          <input name="mfDays" inputMode="numeric" defaultValue={c.mfSettlementDays} />
        </label>
        <label>
          Working days from selling shares to the money
          <input name="stockDays" inputMode="numeric" defaultValue={c.stockSettlementDays} />
        </label>
        <label>
          Days to convert a foreign-currency balance
          <input name="foreignDays" inputMode="numeric" defaultValue={c.foreignCashDays} />
        </label>
        <label>
          Exit load on a recent fund sale (%)
          <input name="exitLoad" inputMode="decimal" defaultValue={pc(c.exitLoadPct)} />
        </label>
        <label>
          Gain assumed when the cost is not recorded (% of value)
          <input name="gainShare" inputMode="decimal" defaultValue={pc(c.assumedGainShare)} />
        </label>
        <label>
          Days to sell a property
          <input name="propDays" inputMode="numeric" defaultValue={c.propertySaleDays} />
        </label>
        <label>
          Selling costs of a property (%)
          <input name="propCost" inputMode="decimal" defaultValue={pc(c.propertyCostPct)} />
        </label>
        <label>
          Days to collect money lent out
          <input name="recvDays" inputMode="numeric" defaultValue={c.receivableDays} />
        </label>
      </div>
      <label>
        Deadlines shown as separate plans (days from today, 0 = today)
        <input name="scenarioDays" defaultValue={c.scenarioDays.join(', ')} />
      </label>
      <div className="row" style={{ alignItems: 'center' }}>
        <button className="btn primary" disabled={pending}>
          Save
        </button>
        <Msg r={res} />
      </div>
    </form>
  );
}
