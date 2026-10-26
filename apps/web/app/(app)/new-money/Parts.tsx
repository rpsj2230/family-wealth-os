import Link from 'next/link';
import {
  formatInr,
  ratePct,
  type PersonStyle,
  type PlacementPlan,
  type RateHolding,
  type RatePrefs,
  type Suggestion,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { PersonBadge } from '@/components/Person';
import { slugify } from '@/lib/slug';
import '../rates/rates.css';

export interface PlannerValues {
  amount: string;
  kind: 'NRE' | 'NRO';
  who: string;
  tenure: string;
  liquid: string;
  joint: boolean;
  with: string;
}

/** The short form: how much, which account, whose money. Joint, term and money to keep liquid are one click away. */
export function PlannerForm({
  action,
  values,
  people,
  defaultTenure,
}: {
  action: string;
  values: PlannerValues;
  people: { id: string; name: string }[];
  defaultTenure: number;
}) {
  const moreOpen = values.joint || values.liquid !== '' || values.tenure !== String(defaultTenure);
  return (
    <form method="get" action={action} className="nm-form">
      <div className="nm-main">
        <label>
          Amount (₹)
          <input
            name="amount"
            inputMode="numeric"
            defaultValue={values.amount}
            placeholder="25 lakh, or 2500000"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Account
          <select name="kind" defaultValue={values.kind}>
            <option value="NRE">NRE (no Indian tax)</option>
            <option value="NRO">NRO (taxed in India)</option>
          </select>
        </label>
        <label>
          Whose money
          <select name="who" defaultValue={values.who}>
            {people.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary">Show where it should go</button>
      </div>
      <details className="disclose" open={moreOpen} style={{ marginTop: 0 }}>
        <summary>More options: term, money to keep liquid, joint account</summary>
        <div className="nm-more">
          <label>
            Deposit term (months)
            <input name="tenure" inputMode="numeric" defaultValue={values.tenure} />
          </label>
          <label>
            Keep in savings (₹)
            <input name="liquid" inputMode="numeric" defaultValue={values.liquid} placeholder="0" />
          </label>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" name="joint" defaultChecked={values.joint} /> In a joint account
          </label>
          <label>
            Joint with
            <select name="with" defaultValue={values.with}>
              <option value="">Not recorded</option>
              {people.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small" style={{ marginBottom: 0 }}>
          Each name on a joint account, in its order, has its own insurance allowance at a bank.
        </p>
      </details>
    </form>
  );
}

/** The answer: how the amount is spread, what it earns after tax, and what that is against plain savings. */
export function PlanResult({
  plan,
  amount,
  prefs,
  banksBase,
}: {
  plan: PlacementPlan;
  amount: number;
  prefs: RatePrefs;
  /** where a bank's rates page lives: /rates or /demo/rates (the sample has one page) */
  banksBase: string;
}) {
  const placed = plan.placements.reduce((s, p) => s + p.amount, 0);
  return (
    <>
      <section className="kpis" aria-label="What this earns">
        <article className="kpi main">
          <div className="kpi-label">Interest a year, after tax</div>
          <div className="kpi-value">{formatInr(Math.round(plan.totalAnnual))}</div>
          <div className="kpi-sub muted">
            on {formatInr(Math.round(placed))} placed of {formatInr(Math.round(amount))}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">More than plain savings</div>
          <div className="kpi-value gain">+{formatInr(Math.round(plan.uplift))}</div>
          <div className="kpi-sub muted">
            savings at the usual rate would earn {formatInr(Math.round(plan.baselineAnnual))}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Banks used</div>
          <div className="kpi-value">{new Set(plan.placements.map((p) => p.bank)).size}</div>
          <div className="kpi-sub muted">
            {plan.unplaced > 0
              ? `${formatInr(Math.round(plan.unplaced))} does not fit`
              : 'all of it inside the insurance limit'}
          </div>
        </article>
      </section>

      <section className="card" aria-labelledby="place-h">
        <h2 id="place-h">Put it here</h2>
        {plan.placements.length === 0 ? (
          <p className="empty">Nothing could be placed with the rates on file.</p>
        ) : (
          <div role="list">
            {plan.placements.map((p, i) => (
              <div key={`${p.bank}${p.product}${i}`} className="nm-place" role="listitem">
                <BankBadge name={p.bank} size={34} />
                <div>
                  <b>
                    <Link href={`${banksBase}/${slugify(p.bank)}`}>{p.bank}</Link>
                  </b>
                  <div className="nm-sub">
                    {p.kind} {p.product === 'fd' ? 'fixed deposit' : 'savings'} · {p.tenureNote}
                  </div>
                </div>
                <div className="nm-amt">{formatInr(Math.round(p.amount))}</div>
                <div className="nm-wide">
                  <div className="nm-bar" aria-hidden="true">
                    <span
                      style={{ width: `${Math.min(100, (p.amount / Math.max(1, amount)) * 100)}%` }}
                    />
                  </div>
                  <div className="nm-sub" style={{ marginTop: 4 }}>
                    {ratePct(p.rate)}
                    {p.kind === 'NRO' ? ` (${ratePct(p.net)} after tax)` : ''} · about{' '}
                    <b>{formatInr(Math.round(p.annualInterest))}</b> a year · insurance room left
                    here {formatInr(Math.round(p.headroomLeft))}
                    {p.conditions ? ` · ${p.conditions}` : ''}
                  </div>
                  {p.offerAgeDays > prefs.staleDays && (
                    <div className="nm-sub warnText">
                      This rate was checked {p.offerAgeDays} days ago. Confirm it at the bank, then
                      update it on{' '}
                      <Link href={`${banksBase}/${slugify(p.bank)}`}>its rates page</Link>.
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
        {plan.notes.map((n) => (
          <p key={n} className="notice warn small" style={{ marginTop: 10 }}>
            {n}
          </p>
        ))}
      </section>
    </>
  );
}

/** Holdings that earn clearly less than an offer elsewhere, with the gain and the safe moment to act. */
export function Suggestions({
  suggestions,
  totalGain,
  prefs,
  offersCount,
  banksBase,
}: {
  suggestions: Suggestion[];
  totalGain: number;
  prefs: RatePrefs;
  offersCount: number;
  banksBase: string;
}) {
  if (suggestions.length === 0)
    return (
      <p className="empty">
        {offersCount === 0
          ? 'Add rates on the Rates page to compare.'
          : 'Nothing worth moving right now: no account earns clearly less than a better offer with insurance room. A running deposit is never suggested to be broken early; moves are for maturity.'}
      </p>
    );
  return (
    <>
      <p>
        If you act on all of these: about <strong>{formatInr(Math.round(totalGain))}</strong> more
        interest a year.
      </p>
      <div role="list">
        {suggestions.map((x) => (
          <div key={x.assetId} className="nm-sug" role="listitem">
            <div>
              <b>
                {x.from} <span aria-hidden="true">→</span>
                <span className="sr-only"> to </span>{' '}
                <Link href={`${banksBase}/${slugify(x.to)}`}>{x.to}</Link>
              </b>
              <div className="small" style={{ marginTop: 4 }}>
                {x.text}
              </div>
              {x.offerAgeDays > prefs.staleDays && (
                <div className="small warnText">
                  This rate was checked {x.offerAgeDays} days ago; confirm it first.
                </div>
              )}
            </div>
            <div className="gain num" style={{ fontWeight: 650, whiteSpace: 'nowrap' }}>
              +{formatInr(Math.round(x.annualGain))} a year
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Per person and bank: how much sits there and how much of the deposit-insurance limit is left. */
export function InsuranceRoom({
  holdings,
  limit,
  styles,
}: {
  holdings: RateHolding[];
  limit: number;
  styles: Record<string, PersonStyle>;
}) {
  const by = new Map<string, { ownerId: string; bank: string; total: number }>();
  for (const h of holdings) {
    if (h.needsConfirmation) continue;
    const k = `${h.ownerId}|${h.bank}`;
    const cur = by.get(k) ?? { ownerId: h.ownerId, bank: h.bank, total: 0 };
    cur.total += h.current;
    by.set(k, cur);
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total).slice(0, 40);
  if (rows.length === 0) return <p className="empty">No balances recorded yet.</p>;
  return (
    <div role="list">
      {rows.map((r) => {
        const over = r.total > limit;
        return (
          <div key={`${r.ownerId}${r.bank}`} className="nm-room" role="listitem">
            <div>
              <PersonBadge p={styles[r.ownerId]} name size={20} /> · <b>{r.bank}</b>
              <div className="nm-bar" style={{ marginTop: 6 }} aria-hidden="true">
                <span
                  style={{
                    width: `${Math.min(100, (r.total / limit) * 100)}%`,
                    background: over ? 'var(--fail)' : undefined,
                  }}
                />
              </div>
            </div>
            <div className="num" style={{ textAlign: 'right' }}>
              {formatInr(Math.round(r.total))}
              <div className={`small ${over ? 'fail' : 'muted'}`}>
                {over
                  ? `${formatInr(Math.round(r.total - limit))} above the limit`
                  : `${formatInr(Math.round(limit - r.total))} room`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
