'use client';

import { KIND_LABEL, LIQUIDITY_KINDS, type AppConfig } from '@fwos/core';
import type { GroupSpec } from '@/lib/settings-fields';
import { resetTaxRule, saveConfigGroup, saveLiquidity, saveTaxRule } from './actions';
import { Field, SaveRow, StatePill, Tick, useForm } from './fields';

/** One card of Money rules: its own numbers, its own Save and its own saved message. */
export function RuleGroupForm({
  group,
  values,
  confirmed,
}: {
  group: GroupSpec;
  values: Record<string, string | boolean>;
  confirmed: boolean;
}) {
  const { res, act, pending } = useForm(saveConfigGroup);
  const boxes = group.fields.filter((f) => f.kind !== 'check');
  const ticks = group.fields.filter((f) => f.kind === 'check');
  return (
    <form action={act} id={group.id} className="card form ruleform" aria-busy={pending}>
      <input type="hidden" name="group" value={group.key} />
      <header className="rulehead">
        <h3>{group.title}</h3>
        <StatePill confirmed={confirmed} />
      </header>
      <p className="muted small">{group.purpose}</p>
      <div className="formgrid">
        {boxes.map((f) => (
          <Field key={f.name} label={f.label} hint={f.hint} unit={f.unit}>
            <input
              name={f.name}
              inputMode={f.kind === 'list' ? 'text' : 'decimal'}
              defaultValue={String(values[f.name] ?? '')}
            />
          </Field>
        ))}
      </div>
      {ticks.length > 0 && (
        <div className="ticks stack">
          {ticks.map((f) => (
            <Tick
              key={f.name}
              name={f.name}
              label={f.label}
              hint={f.hint}
              defaultChecked={values[f.name] === true}
            />
          ))}
        </div>
      )}
      <SaveRow label={`Save ${group.title}`} pending={pending} res={res} />
    </form>
  );
}

export function LiquidityForm({ c, confirmed }: { c: AppConfig['liquidity']; confirmed: boolean }) {
  const { res, act, pending } = useForm(saveLiquidity);
  const pc = (x: number) => Math.round(x * 1e4) / 100;
  return (
    <form action={act} id="liquidity" className="card form ruleform" aria-busy={pending}>
      <header className="rulehead">
        <h3>When I need money</h3>
        <StatePill confirmed={confirmed} />
      </header>
      <p className="muted small">
        The “I need money” page uses these choices to work out where an amount can come from, by
        when, and what it costs. Untick a source to never use it.
      </p>
      <h4>Where money may come from, in your order of preference</h4>
      <table className="tbl lines responsive">
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
                <td data-label="Use it">
                  <input
                    type="checkbox"
                    name={`on_${k}`}
                    defaultChecked={at >= 0}
                    aria-label={`Use ${KIND_LABEL[k]}`}
                  />
                </td>
                <td data-label="Source">{KIND_LABEL[k]}</td>
                <td className="num" data-label="Priority (1 = first)">
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
      <Field
        label="How to choose between the sources"
        hint="Decides which plan the “I need money” page shows first."
      >
        <select name="mode" defaultValue={c.mode}>
          <option value="cheapest">Cheapest first (least interest, tax and charges lost)</option>
          <option value="fastest">Fastest first</option>
          <option value="order">My priority order above</option>
        </select>
      </Field>
      <h4>Costs and timing</h4>
      <div className="formgrid g3">
        <Field
          label="Leave in each savings account"
          unit="₹"
          hint="So the account stays open and above its minimum."
        >
          <input name="keepInBank" inputMode="numeric" defaultValue={c.keepInBank} />
        </Field>
        <Field
          label="Interest lost when a deposit is broken early"
          unit="points a year"
          hint="Applied to the time the deposit has run."
        >
          <input name="fdPenalty" inputMode="decimal" defaultValue={pc(c.fdPenaltyPoints)} />
        </Field>
        <Field
          label="A deposit counts as recently added for"
          unit="days"
          hint="Deposits booked within this time are listed as their own source, since breaking them loses little interest."
        >
          <input name="recentFdDays" inputMode="numeric" defaultValue={c.recentFdDays} />
        </Field>
        <Field
          label="Days for a broken deposit to reach the bank"
          unit="days"
          hint="Sets the date a deposit break shows as available."
        >
          <input name="fdBreakDays" inputMode="numeric" defaultValue={c.fdBreakDays} />
        </Field>
        <Field
          label="Working days from selling a fund to the money"
          unit="days"
          hint="Sets when fund money arrives."
        >
          <input name="mfDays" inputMode="numeric" defaultValue={c.mfSettlementDays} />
        </Field>
        <Field
          label="Working days from selling shares to the money"
          unit="days"
          hint="Sets when share money arrives."
        >
          <input name="stockDays" inputMode="numeric" defaultValue={c.stockSettlementDays} />
        </Field>
        <Field
          label="Days to convert a foreign-currency balance"
          unit="days"
          hint="Sets when SGD and other balances arrive in rupees."
        >
          <input name="foreignDays" inputMode="numeric" defaultValue={c.foreignCashDays} />
        </Field>
        <Field
          label="Exit load on a recent fund sale"
          unit="%"
          hint="Charged when a fund is sold inside its load period."
        >
          <input name="exitLoad" inputMode="decimal" defaultValue={pc(c.exitLoadPct)} />
        </Field>
        <Field
          label="Gain assumed when the cost is not recorded"
          unit="% of value"
          hint="Used to estimate tax on a sale with no recorded cost."
        >
          <input name="gainShare" inputMode="decimal" defaultValue={pc(c.assumedGainShare)} />
        </Field>
        <Field
          label="Days to sell a property"
          unit="days"
          hint="Sets when property money could arrive."
        >
          <input name="propDays" inputMode="numeric" defaultValue={c.propertySaleDays} />
        </Field>
        <Field
          label="Selling costs of a property"
          unit="%"
          hint="Brokerage, legal and other costs."
        >
          <input name="propCost" inputMode="decimal" defaultValue={pc(c.propertyCostPct)} />
        </Field>
        <Field
          label="Days to collect money lent out"
          unit="days"
          hint="Sets when money owed to you is counted as available."
        >
          <input name="recvDays" inputMode="numeric" defaultValue={c.receivableDays} />
        </Field>
        <Tick
          name="fdPartial"
          label="My banks let me break part of a deposit"
          hint="Otherwise the whole deposit is used."
          defaultChecked={c.fdPartialBreak}
        />
      </div>
      <Field
        label="Deadlines shown as separate plans"
        unit="days from today, 0 = today"
        hint="Each number becomes a column on the “I need money” page, for example 0, 3, 14, 45, 120."
      >
        <input name="scenarioDays" defaultValue={c.scenarioDays.join(', ')} />
      </Field>
      <SaveRow label="Save when I need money" pending={pending} res={res} />
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
  sources,
  current,
  builtin,
}: {
  v: TaxValues;
  custom: boolean;
  isNew?: boolean;
  sources?: { title: string; url: string }[];
  current?: boolean;
  /** the app ships numbers for this year, so removing yours falls back to them */
  builtin?: boolean;
}) {
  const { res, act, pending } = useForm(saveTaxRule);
  const state = isNew
    ? null
    : custom && v.verified
      ? { tone: 'ok', text: 'Entered by you and checked' }
      : custom
        ? { tone: 'warn', text: 'Entered by you, not yet checked' }
        : { tone: 'warn', text: 'Built-in numbers, not confirmed by you' };
  return (
    <>
      <form
        action={act}
        className={`card form taxform ${current ? 'is-current' : ''}`}
        aria-busy={pending}
      >
        <header className="rulehead">
          <h3>{isNew ? 'Add a financial year' : `Financial year ${v.fy}`}</h3>
          {current && <span className="pill info">This year</span>}
          {state && <span className={`pill ${state.tone}`}>{state.text}</span>}
        </header>
        {isNew ? (
          <Field label="Financial year" hint="From 1 April to 31 March, written like 2027-28.">
            <input name="fy" placeholder="2027-28" required />
          </Field>
        ) : (
          <input type="hidden" name="fy" value={v.fy} />
        )}
        <div className="formgrid g3">
          <Field
            label="Months held to count as long-term"
            hint="A fund held for more than this is taxed at the long-term rate."
            unit="months"
          >
            <input name="months" inputMode="numeric" defaultValue={v.months} />
          </Field>
          <Field label="Short-term rate" unit="%" hint="Tax on gains from units held for less.">
            <input name="stcg" inputMode="decimal" defaultValue={v.stcg} />
          </Field>
          <Field label="Long-term rate" unit="%" hint="Tax on gains above the tax-free allowance.">
            <input name="ltcg" inputMode="decimal" defaultValue={v.ltcg} />
          </Field>
          <Field
            label="Tax-free long-term gain per person"
            unit="₹ a year"
            hint="The amount the harvest plan helps you use each year."
          >
            <input name="exemption" inputMode="numeric" defaultValue={v.exemption} />
          </Field>
          <Field label="Cess" unit="%" hint="Added on top of the tax.">
            <input name="cess" inputMode="decimal" defaultValue={v.cess} />
          </Field>
          <Field label="Where these numbers come from" hint="Shown on the Tax page.">
            <input
              name="note"
              defaultValue={v.note}
              placeholder="e.g. Finance Act 2027, section …"
            />
          </Field>
        </div>
        {sources && sources.length > 0 && (
          <p className="muted small">
            Built-in numbers come from:{' '}
            {sources.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  {s.title}
                </a>
              </span>
            ))}
            .
          </p>
        )}
        <Tick
          name="verified"
          label="I checked these numbers on the official site"
          hint="Removes the “not yet verified” warning from the Tax page."
          defaultChecked={v.verified}
        />
        <SaveRow
          label={isNew ? 'Add year' : `Save ${v.fy}`}
          pending={pending}
          res={res}
          extra={
            !isNew && custom ? (
              <button
                className="btn ghost"
                type="submit"
                formAction={resetTaxRule}
                title={
                  builtin
                    ? 'Remove your numbers and use the built-in ones again'
                    : 'Remove this year'
                }
              >
                {builtin ? 'Use the built-in numbers again' : 'Remove this year'}
              </button>
            ) : null
          }
        />
      </form>
    </>
  );
}
