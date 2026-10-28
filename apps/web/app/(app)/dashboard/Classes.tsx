import Link from 'next/link';
import {
  classHref,
  formatInrCompact,
  formatPct,
  type ClassCard,
  type Explain,
  type ExplainSet,
} from '@fwos/core';
import { plural, whole } from '@/app/(app)/accounts/BankOverview';
import { Est } from '@/components/Est';
import { ForeignCashLines } from '@/components/ForeignCash';
import { Why } from '@/components/Why';
import type { HomeModel } from '@/lib/home';
import { Signed, homeLink } from './parts';

const NOUN: Record<ClassCard['key'], [string, string]> = {
  fd: ['deposit', 'deposits'],
  funds: ['fund', 'funds'],
  cash: ['account', 'accounts'],
  others: ['holding kept by hand', 'holdings kept by hand'],
};

/** One kind of holding, small: what was put in, what it has earned, what it is worth, the profit or loss and its share of the total. */
function ClassCardView({ c, sample, why }: { c: ClassCard; sample: boolean; why: Explain }) {
  const href = homeLink(classHref(c.key), sample);
  const [one, many] = NOUN[c.key];
  const title = href ? (
    <Link href={href} className="hm-class-link">
      {c.label}
    </Link>
  ) : (
    c.label
  );
  return (
    <li className="hm-class" data-testid={`hm-class-${c.key}`}>
      <h3 className="hm-class-title">
        {title}
        {href && (
          <span aria-hidden="true" className="hm-go">
            {' '}
            ›
          </span>
        )}
        <Why explain={why} />
      </h3>
      <div className="hm-class-now" data-testid={`hm-class-${c.key}-current`}>
        {formatInrCompact(c.current)}
      </div>
      <div className="bv-exact">{whole(c.current)}</div>
      {c.key === 'cash' && <ForeignCashLines items={c.foreign} testid="hm-class-cash-fx" />}
      <dl className="hm-class-facts">
        <div>
          <dt>Invested</dt>
          <dd>{formatInrCompact(c.invested)}</dd>
        </div>
        <div>
          <dt>Earned so far</dt>
          <dd>
            {c.earned === null ? '–' : formatInrCompact(c.earned)}
            {c.earned !== null && c.key === 'cash' && <Est />}
          </dd>
        </div>
      </dl>
      <p className="hm-class-pl">
        <Signed
          label="Profit so far"
          amount={c.profit}
          pct={c.profitPct}
          estimate={c.estimated && Math.round(c.profit) !== 0}
        />
        {c.profitPct !== null && (
          <span className="small muted"> on the {formatInrCompact(c.invested)} invested</span>
        )}
      </p>
      <p className="hm-class-share small muted">
        {formatPct(c.share, 0)} of net worth
        {c.count > 0 ? ` · ${plural(c.count, one, many)}` : ''}
        {c.key === 'fd' && c.maturity > c.current
          ? ` · ${formatInrCompact(c.maturity)} at maturity`
          : ''}
      </p>
      {c.awaiting && (
        <p className="hm-class-note small muted">
          Not counted: {plural(c.awaiting.count, 'deposit')} ({formatInrCompact(c.awaiting.current)}
          ) past their date. Confirm them on Accounts; the money counts in the savings account or
          new deposit it went to.
        </p>
      )}
    </li>
  );
}

/**
 * Four small cards, one per kind of holding, in one row (four columns, then two, then one by the width of the page): deposits,
 * mutual funds, cash and the rest. Together they are the net worth. Each links to the page that has the detail.
 */
export function Classes({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const funds = m.classes.find((c) => c.key === 'funds')!;
  const w = m.periods.basis;
  const rates = m.assumptions;
  return (
    <section className="card hm-classes" aria-labelledby="hm-classes">
      <header className="hm-head">
        <h2 id="hm-classes">By kind of holding</h2>
        <span className="muted small">small cards, the detail is on each page</span>
      </header>
      <ul className="hm-class-grid">
        {m.classes.map((c) => (
          <ClassCardView
            key={c.key}
            c={c}
            sample={sample}
            why={
              ex[
                c.key === 'fd'
                  ? 'home.classDeposits'
                  : c.key === 'funds'
                    ? 'home.classFunds'
                    : c.key === 'cash'
                      ? 'home.classCash'
                      : 'home.classOthers'
              ]
            }
          />
        ))}
      </ul>
      <details className="bv-how">
        <summary>How these are worked out</summary>
        <ul className="list small muted">
          <li>
            <strong>Fixed deposits.</strong> Invested is the amount of each deposit. Current is what
            it has grown to today on its own terms (rate, dates and how interest is added); maturity
            is what it pays on its date. A deposit past its date that is still listed as running is
            counted here at its maturity amount, as in net worth, though Deposits leaves it out
            until you confirm it.
          </li>
          <li>
            <strong>Mutual funds.</strong> Invested is the money still in the funds: the cost of the
            units held, as Investments shows it. Current is the units times the latest price, with
            SIP instalments assumed since the last statement added and marked <Est />. Profit is
            current less invested; where a fund has no statement ({w.fundsFromPlan} of{' '}
            {plural(funds.count, 'fund')} here) the cost is the amount entered, so its profit is{' '}
            <Est />.
          </li>
          <li>
            <strong>Cash.</strong> Invested is the last balance recorded for each account. Current
            is that balance plus the interest estimated since, at the account’s own rate, else the
            rate on the Rates list for its bank, else the {formatPct(rates.savingsRate, 2)} assumed
            in Settings, less the {formatPct(rates.tdsRate, 0)} tax taken at source. Profit is that
            interest, an <Est /> because banks credit interest in lumps. A balance in another
            currency (for example Singapore dollars) is counted in the figure at today’s exchange
            rate and shown on its own under it, with its rupee value and the rate’s date; it earns
            nothing here, because a changing exchange rate is not interest.
          </li>
          <li>
            <strong>Others.</strong> Shares, property, money lent, money held by others, pension
            accounts and any other counted holding. Invested is the amount recorded and current is
            what is counted today, so the profit is nothing unless a recorded value has moved on
            from what was recorded. A change you make to a recorded value shows in the net worth
            over time, not as profit here.
          </li>
          <li>
            <strong>Earned so far</strong> is everything the kind has earned since it was first
            held, including interest from deposits already paid out and gains from units already
            sold, so it can be more than the profit on what is still held. The profit shown with
            each card is on what is held now.
          </li>
        </ul>
      </details>
    </section>
  );
}
