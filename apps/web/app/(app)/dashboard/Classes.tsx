import Link from 'next/link';
import {
  TERMS,
  classHref,
  formatInrCompact,
  formatPct,
  type ClassCard,
  type ClassYearly,
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

/**
 * One kind of holding, small: its current value, what it cost (Invested; Balance for savings), its share of the one Lifetime profit,
 * its yearly rate (XIRR, or the rate savings earned), its profit and its share of net worth.
 */
function ClassCardView({
  c,
  sample,
  why,
  yearly,
  lifetime,
  earnedFy,
}: {
  c: ClassCard;
  sample: boolean;
  why: Explain;
  yearly: ClassYearly | null | undefined;
  /** this kind's part of the Lifetime profit (the capital ledger's earnings by kind); null before the ledger starts */
  lifetime: number | null;
  /** savings: the interest earned this financial year */
  earnedFy: number | null;
}) {
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
          <dt>{c.key === 'cash' ? TERMS.balance.label : TERMS.invested.label}</dt>
          <dd>{formatInrCompact(c.invested)}</dd>
        </div>
        <div>
          <dt>{TERMS.lifetimeProfit.label}</dt>
          <dd data-testid={`hm-class-${c.key}-lifetime`}>
            {lifetime === null
              ? '–'
              : `${lifetime < 0 ? '−' : '+'}${formatInrCompact(Math.abs(lifetime))}`}
            {lifetime !== null && c.key === 'cash' && <Est />}
          </dd>
        </div>
      </dl>
      <p
        className="hm-class-yearly small"
        data-testid={`hm-class-${c.key}-yearly`}
        title={yearly?.basis}
      >
        <span className="muted">
          {yearly?.kind === 'rate' ? `${TERMS.rateEarned.label} ` : `${TERMS.xirr.label} `}
        </span>
        {yearly ? (
          <>
            <strong>{formatPct(yearly.rate, 2)}</strong>
            <span className="muted"> a year</span>
            {yearly.estimated && (
              <>
                {' '}
                <Est />
              </>
            )}
          </>
        ) : (
          <span className="muted">
            {c.key === 'others' ? 'not measurable: no dated money in and out' : 'not available yet'}
          </span>
        )}
      </p>
      <p className="hm-class-pl">
        {c.key === 'cash' && earnedFy !== null ? (
          <Signed label={`${TERMS.interestEarned.label} this FY`} amount={earnedFy} estimate />
        ) : (
          <>
            <Signed
              label={c.key === 'fd' ? TERMS.profitInterest.label : TERMS.profit.label}
              amount={c.profit}
              pct={c.profitPct}
              estimate={c.estimated && Math.round(c.profit) !== 0}
            />
            {c.profitPct !== null && <span className="small muted"> overall</span>}
          </>
        )}
      </p>
      <p className="hm-class-share small muted">
        {formatPct(c.share, 0)} of net worth
        {c.count > 0 ? ` · ${plural(c.count, one, many)}` : ''}
        {c.key === 'fd' && c.maturity > c.current
          ? ` · ${TERMS.maturityValue.label.toLowerCase()} ${formatInrCompact(c.maturity)}`
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
  const t = m.capital.totals;
  const e = t.earnings;
  const started = !!m.capital.opening;
  const lifetimeOf: Record<ClassCard['key'], number> = {
    fd: e.deposits,
    funds: e.funds,
    cash: e.savings,
    others: e.others,
  };
  const rest = e.fx + e.income;
  return (
    <section className="card hm-classes" aria-labelledby="hm-classes">
      <header className="hm-head">
        <h2 id="hm-classes">By kind of holding</h2>
        <span className="muted small">what each kind cost, is worth and has earned</span>
      </header>
      <ul className="hm-class-grid">
        {m.classes.map((c) => (
          <ClassCardView
            key={c.key}
            c={c}
            yearly={m.yearly[c.key]}
            lifetime={started ? lifetimeOf[c.key] : null}
            earnedFy={c.key === 'cash' ? (m.extras.earnedFy?.savings ?? null) : null}
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
      {started && (
        <p className="small muted" data-testid="hm-lifetime-split">
          {TERMS.lifetimeProfit.label}: the four kinds{' '}
          {formatInrCompact(e.deposits + e.funds + e.savings + e.others)}
          {Math.abs(rest) >= 1
            ? ` + exchange-rate moves and other income ${formatInrCompact(rest)}`
            : ''}{' '}
          = {formatInrCompact(t.profit)}.
        </p>
      )}
      <FundSplitLine m={m} />
      <details className="bv-how">
        <summary>How these are worked out</summary>
        <ul className="list small muted">
          <li>
            <strong>Fixed deposits.</strong> Invested is the amount of each deposit. Current value
            is what it has grown to today on its own terms (rate, dates and how interest is added);
            maturity is what it pays on its date. A deposit that has matured stops earning; its
            proceeds are counted once, here and in net worth, until you say where they went, unless
            a new deposit or a later balance already holds them (then they are not counted twice).
          </li>
          <li>
            <strong>Mutual funds.</strong> Invested is the money still in the funds: the cost of the
            units held, as Investments shows it. Current value is the units times the latest price,
            with SIP instalments assumed since the last statement added and marked <Est />. Profit
            is current less invested; where a fund has no statement ({w.fundsFromPlan} of{' '}
            {plural(funds.count, 'fund')} here) the cost is the amount entered, so its profit is{' '}
            <Est />.
          </li>
          <li>
            <strong>Cash.</strong> Balance is the last balance recorded for each account. Current
            value is that balance plus the interest estimated since, at the account’s own rate, else
            the rate on the Rates list for its bank, else the {formatPct(rates.savingsRate, 2)}{' '}
            assumed in Settings, less the {formatPct(rates.tdsRate, 0)} tax taken at source. Profit
            is that interest, an <Est /> because banks credit interest in lumps. A balance in
            another currency (for example Singapore dollars) is counted in the figure at today’s
            exchange rate and shown on its own under it, with its rupee value and the rate’s date;
            it earns nothing here, because a changing exchange rate is not interest.
          </li>
          <li>
            <strong>Others.</strong> Shares, money lent, money held by others, pension accounts and
            any other counted holding. Invested is the amount recorded and current value is what is
            counted today, so the profit is nothing unless a recorded value has moved on from what
            was recorded. A change you make to a recorded value shows in the net worth over time,
            not as profit here.
          </li>
          <li>
            <strong>{TERMS.lifetimeProfit.label}</strong> on each card is that kind’s part of the
            one Lifetime profit at the top, including interest already paid out and gains on units
            already sold, so the cards add up to it with exchange-rate moves and other income.{' '}
            <strong>{TERMS.invested.label}</strong> is what today’s holdings cost: a deposit renewed
            with its interest counts at its new, larger amount, so{' '}
            <strong>{TERMS.profit.label}</strong> leaves out interest already rolled into a deposit.
          </li>
        </ul>
      </details>
    </section>
  );
}
