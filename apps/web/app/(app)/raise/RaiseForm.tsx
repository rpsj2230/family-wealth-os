import Link from 'next/link';
import { KIND_LABEL, LIQUIDITY_KINDS, type AppConfig, type LiquidityKind } from '@fwos/core';
import './raise.css';

export interface RaiseFormValues {
  amount: string;
  who: string;
  hard: boolean;
  by: string;
  mode: 'cheapest' | 'fastest' | 'order';
  order: LiquidityKind[];
}

/**
 * The question: how much, whose money, and how badly it is needed. Everything else is a default from Settings and sits under
 * "More options".
 */
export function RaiseForm({
  action,
  people,
  values,
  cfg,
  settingsHref = '/settings#liquidity',
}: {
  action: string;
  people: { id: string; name: string }[];
  values: RaiseFormValues;
  cfg: AppConfig['liquidity'];
  settingsHref?: string;
}) {
  return (
    <form className="card rz-need" method="get" action={action}>
      <fieldset className="rz-kind">
        <legend>How badly do you need it?</legend>
        <label>
          <input type="radio" name="urgency" value="soft" defaultChecked={!values.hard} />
          <span className="rz-opt">
            <b>Soft need</b>
            <span>Lowest cost, shown for several deadlines, using your preferences.</span>
          </span>
        </label>
        <label>
          <input type="radio" name="urgency" value="hard" defaultChecked={values.hard} />
          <span className="rz-opt">
            <b>Hard need</b>
            <span>I must have it at any cost: every source is used, as soon as possible.</span>
          </span>
        </label>
      </fieldset>
      <div className="rz-fields">
        <label>
          Amount needed (₹)
          <input
            name="amount"
            inputMode="numeric"
            defaultValue={values.amount}
            placeholder="5 lakh, or 500000"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Whose money
          <select name="who" defaultValue={values.who}>
            <option value="">Everyone (joint accounts included)</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">Show me where from</button>
      </div>
      <details className="disclose" style={{ marginTop: 0 }}>
        <summary>More options: date, how to choose, where to look</summary>
        <div className="rz-fields" style={{ paddingTop: 10 }}>
          <label>
            Needed by (hard need)
            <input type="date" name="by" defaultValue={values.by} />
          </label>
          <label>
            Choose between sources by (soft need)
            <select name="mode" defaultValue={values.mode}>
              <option value="cheapest">Lowest cost</option>
              <option value="fastest">Fastest</option>
              <option value="order">My priority order</option>
            </select>
          </label>
        </div>
        <div className="row" style={{ padding: '10px 0 4px' }}>
          {LIQUIDITY_KINDS.map((k) => (
            <label className="check" key={k}>
              <input
                type="checkbox"
                name="k"
                value={k}
                defaultChecked={values.order.includes(k)}
                disabled={!cfg.order.includes(k)}
              />{' '}
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
        <p className="muted small" style={{ margin: 0 }}>
          Sources turned off in <Link href={settingsHref}>Settings, When I need money</Link> cannot
          be switched on here. Costs, delays and the usual order are set there too.
        </p>
      </details>
    </form>
  );
}
