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
import { niceDate } from '@/lib/dates';
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
          <dt>Cost of current holdings</dt>
          <dd>{formatInrCompact(c.invested)}</dd>
        </div>
        <div>
          <dt>Earned since first record</dt>
          <dd>
            {c.earned === null ? '–' : formatInrCompact(c.earned)}
            {c.earned !== null && c.key === 'cash' && <Est />}
          </dd>
        </div>
      </dl>
      <p className="hm-class-pl">
        <Signed
          label="Gain on current holdings"
          amount={c.profit}
          pct={c.profitPct}
          estimate={c.estimated && Math.round(c.profit) !== 0}
        />
        {c.profitPct !== null && (
          <span className="small muted"> on the {formatInrCompact(c.invested)} they cost</span>
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
          ) past their date whose money is probably already in another account or a new deposit.
          Confirm where it went on Explain movements.
        </p>
      )}
    </li>
  );
}

/**
 * Where the funds' value comes from and how fresh its prices are: the part a fund statement confirmed (units × the official price), the
 * SIP instalments since that no statement has confirmed (projected), the part estimated from a plan alone, and the funds whose latest
 * price is older than the setting.
 */
function FundSplitLine({ m }: { m: HomeModel }) {
  const f = m.capital.funds;
  if (f.confirmed + f.estimated <= 0) return null;
  const parts = [
    `${formatInrCompact(f.confirmed)} confirmed by fund statements (units × the latest official price)`,
    f.projected.count > 0
      ? `${formatInrCompact(f.projected.value)} projected from ${plural(f.projected.count, 'SIP instalment')} since the last statement`
      : null,
    f.unconfirmedFunds > 0
      ? `${formatInrCompact(f.unconfirmedFunds)} estimated from a plan, with no statement yet`
      : null,
  ].filter(Boolean);
  return (
    <p className="small muted" data-testid="hm-fund-split">
      <strong>Funds:</strong> {parts.join('; ')}.{' '}
      {f.staleCount > 0 ? (
        <span className="warn">
          {plural(f.staleCount, 'fund price')} older than {plural(f.navStaleDays, 'day')}
          {f.oldestNav ? ` (oldest ${niceDate(f.oldestNav)})` : ''}: those values may be out of
          date.
        </span>
      ) : (
        `Every fund price is within ${plural(f.navStaleDays, 'day')}.`
      )}
    </p>
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
        <span className="muted small">
          current holdings: what today’s holdings cost and are worth (lifetime figures are at the
          top)
        </span>
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
      <FundSplitLine m={m} />
      <details className="bv-how">
        <summary>How these are worked out</summary>
        <ul className="list small muted">
          <li>
            <strong>Fixed deposits.</strong> Invested is the amount of each deposit. Current is what
            it has grown to today on its own terms (rate, dates and how interest is added); maturity
            is what it pays on its date. A deposit that has matured stops earning; its proceeds are
            counted once, here and in net worth, until you say where they went, unless a new deposit
            or a later balance already holds them (then they are not counted twice).
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
            <strong>Earned since first record</strong> is everything the kind has earned since it
            was first held, including interest from deposits already paid out and gains from units
            already sold, so it can be more than the gain on what is still held.{' '}
            <strong>Cost of current holdings</strong> is what today’s holdings cost: a deposit
            renewed with its interest counts at its new, larger amount, so{' '}
            <strong>Gain on current holdings</strong> leaves out interest already rolled into a
            deposit. The lifetime profit at the top counts it once, as profit.
          </li>
        </ul>
      </details>
    </section>
  );
}
