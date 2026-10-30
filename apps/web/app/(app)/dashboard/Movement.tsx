import Link from 'next/link';
import {
  MOVEMENT_PERIODS,
  TERMS,
  formatInrCompact,
  formatPct,
  type ExplainSet,
  type HomeRange,
} from '@fwos/core';
import { Why } from '@/components/Why';
import { whole } from '@/app/(app)/accounts/BankOverview';
import { Est } from '@/components/Est';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { CardHead, MaybeLink, homeLink, rupees, tone } from './parts';

/**
 * Where the wealth came from, as one line: Own money + Lifetime profit = Net worth (the capital ledger's figures, core capital.ts),
 * with where the own money came from one tap away, and the maturity proceeds still to place. A figure that cannot be worked out says
 * so instead of showing a number. XIRR on own money is in the growth strip above.
 */
export function Capital({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const c = m.capital;
  const t = c.totals;
  const opening = c.opening;
  return (
    <div className="hm-capital" role="group" aria-label="Where the wealth came from">
      <div className="hm-bridge">
        <div className="hm-cap">
          <div className="hm-cap-label">
            {TERMS.ownMoney.label} <Why explain={ex['home.ownMoney']} />
          </div>
          <div className="hm-cap-value" data-testid="hm-own-money">
            {opening ? formatInrCompact(t.ownMoney) : '–'}
          </div>
          {!opening && (
            <div className="hm-cap-note">shows once balances or deposits are recorded</div>
          )}
        </div>
        <span className="hm-bridge-op" aria-hidden="true">
          +
        </span>
        <div className="hm-cap">
          <div className="hm-cap-label">
            {TERMS.lifetimeProfit.label} <Est /> <Why explain={ex['home.profitSoFar']} />
          </div>
          <div
            className={`hm-cap-value ${tone(opening ? t.profit : null)}`}
            data-testid="hm-profit-so-far"
          >
            {opening ? rupees(t.profit) : '–'}
            {opening && t.profitPct !== null && (
              <span className="hm-cap-pct">
                {' '}
                {t.profitPct < 0 ? '−' : '+'}
                {formatPct(Math.abs(t.profitPct), 1)} overall
              </span>
            )}
          </div>
        </div>
        <span className="hm-bridge-op" aria-hidden="true">
          =
        </span>
        <div className="hm-cap">
          {/* the sum of the line: the headline figure again, as the result of the equation */}
          <div className="hm-cap-label hm-bridge-sum">{TERMS.netWorth.label}</div>
          <div className="hm-cap-value">{formatInrCompact(m.total)}</div>
        </div>
      </div>
      {opening && (
        <details className="hm-cap-parts-box small">
          <summary>Where the own money came from</summary>
          <ul className="hm-cap-parts" data-testid="hm-own-money-parts">
            <li>
              <span>Balances on {niceDate(opening.date)}</span>
              <span>{formatInrCompact(t.opening)}</span>
            </li>
            {c.abroad.count > 0 && (
              <li data-testid="hm-own-money-abroad">
                <span>
                  Sent from Singapore since ({c.abroad.count} transfer
                  {c.abroad.count === 1 ? '' : 's'})
                </span>
                <span>{formatInrCompact(c.abroad.amount)}</span>
              </li>
            )}
            {t.confirmedExternal !== 0 && (
              <li>
                <span>Other money in or out, confirmed</span>
                <span>{rupees(t.confirmedExternal)}</span>
              </li>
            )}
            {Math.abs(t.unexplained - c.abroad.amount) >= 1 && (
              <li>
                <span>Other money in or out, worked out from balances</span>
                <span>{rupees(t.unexplained - c.abroad.amount)}</span>
              </li>
            )}
          </ul>
        </details>
      )}
      {c.proceeds.count > 0 && (
        <div className="hm-cap warn">
          <div className="hm-cap-label">Matured, to place</div>
          <div className="hm-cap-value" data-testid="hm-proceeds">
            {formatInrCompact(c.proceeds.amount)}
          </div>
          <div className="hm-cap-note">
            {c.proceeds.count} deposit{c.proceeds.count === 1 ? '' : 's'} matured: counted once
            until you{' '}
            <MaybeLink href={homeLink('/reconcile', sample)}>say where the money went</MaybeLink>
          </div>
        </div>
      )}
    </div>
  );
}

/** A query string that keeps the other choices on the page. */
const query = (o: Record<string, string | undefined>) =>
  '?' +
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');

/**
 * How net worth moved over the period chosen: where it started, the money that came in or went out (confirmed, and worked out from
 * balances when nothing was confirmed), what was earned (interest on savings and deposits, fund gains, exchange-rate moves, income less
 * costs), and where it ended. Outside money is never mixed with performance. The periods are whole calendar months, the last to today.
 */
export function Movement({
  m,
  base,
  range,
  sample,
  ex,
}: {
  m: HomeModel;
  base: string;
  range: HomeRange;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const mv = m.capital.movement;
  const f = mv.figures;
  const rows = f
    ? [
        { key: 'start', label: `Net worth on ${niceDate(f.from)}`, amount: f.start, signed: false },
        {
          key: 'ext',
          label: 'Outside money, confirmed',
          amount: f.confirmedExternal,
          signed: true,
          muted: f.confirmedExternal === 0,
        },
        {
          key: 'unx',
          label: 'Moved in or out, not yet explained',
          amount: f.unexplained,
          signed: true,
          warn: Math.abs(f.unexplained) >= 1,
        },
        ...(Math.abs(f.corrections) >= 1
          ? [{ key: 'cor', label: 'Corrections you made', amount: f.corrections, signed: true }]
          : []),
        {
          key: 'sav',
          label: 'Interest on savings',
          amount: f.earnings.savings,
          signed: true,
          earn: true,
        },
        {
          key: 'dep',
          label: 'Interest on deposits',
          amount: f.earnings.deposits,
          signed: true,
          earn: true,
        },
        {
          key: 'fun',
          label: 'Fund gains and losses',
          amount: f.earnings.funds,
          signed: true,
          earn: true,
        },
        ...(Math.abs(f.earnings.fx) >= 1
          ? [
              {
                key: 'fx',
                label: 'Exchange-rate moves',
                amount: f.earnings.fx,
                signed: true,
                earn: true,
              },
            ]
          : []),
        ...(Math.abs(f.earnings.others) >= 1
          ? [
              {
                key: 'oth',
                label: 'Other holdings (growth in Settings)',
                amount: f.earnings.others,
                signed: true,
                earn: true,
              },
            ]
          : []),
        ...(Math.abs(f.earnings.income) >= 1
          ? [
              {
                key: 'inc',
                label: 'Income less fees and taxes',
                amount: f.earnings.income,
                signed: true,
                earn: true,
              },
            ]
          : []),
        {
          key: 'end',
          label: `Net worth on ${niceDate(f.to === m.today ? m.today : f.through)}`,
          amount: f.end,
          signed: false,
        },
      ]
    : [];
  return (
    <section className="card hm-card hm-move" aria-labelledby="hm-move-h">
      <CardHead
        title="Wealth movement"
        id="hm-move-h"
        href={homeLink('/reconcile', sample)}
        linkLabel="Explain movements"
        why={ex['home.movement']}
      />
      <nav className="rangeswitch hm-range" aria-label="Period">
        {MOVEMENT_PERIODS.map((p) => (
          <Link
            key={p.key}
            href={`${base}${query({ period: p.key, range })}`}
            scroll={false}
            className={`fchip ${mv.key === p.key ? 'on' : ''}`}
            aria-current={mv.key === p.key ? 'true' : undefined}
          >
            {p.label}
          </Link>
        ))}
      </nav>
      <form className="hm-custom small" action={base} method="get">
        <input type="hidden" name="period" value="custom" />
        <input type="hidden" name="range" value={range} />
        <label>
          From <input type="month" name="from" defaultValue={mv.from.slice(0, 7)} />
        </label>
        <label>
          to{' '}
          <input
            type="month"
            name="to"
            defaultValue={(mv.to === m.today ? m.today : (mv.figures?.through ?? mv.to)).slice(
              0,
              7,
            )}
          />
        </label>
        <button className="btn small">Show</button>
      </form>
      {!f ? (
        <p className="muted small">Nothing was recorded in this period.</p>
      ) : (
        <>
          <table className="hm-move-table" data-testid="hm-move">
            <caption className="sr-only">
              How net worth moved from {niceDate(f.from)}: outside money, money not yet explained
              and what was earned
            </caption>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  className={`${r.signed ? '' : 'total'} ${'warn' in r && r.warn ? 'warn' : ''} ${'muted' in r && r.muted ? 'muted' : ''}`}
                >
                  <th scope="row">{r.label}</th>
                  <td className={r.signed && 'earn' in r ? tone(r.amount) : ''}>
                    {r.signed ? rupees(r.amount) : whole(r.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="hm-move-sum small">
            <strong className={tone(f.earnings.total)}>Earned {rupees(f.earnings.total)}</strong>
            {mv.twr !== null && <> · {formatPct(mv.twr, 2)} on the money at work (time-weighted)</>}
            {f.estimated && (
              <>
                {' '}
                · <Est /> rests partly on estimates
              </>
            )}
          </p>
          {mv.clamped && (
            <p className="muted small">
              The records start on {niceDate(mv.from)}: the period begins there.
            </p>
          )}
          {Math.abs(f.unexplained) >= 1 && (
            <p className="muted small">
              Money that moved with nothing to say what it was is worked out from the balances. It
              is not counted as profit; say what it was (salary, a gift, money taken out) on{' '}
              <MaybeLink href={homeLink('/reconcile', sample)}>Explain movements</MaybeLink>.
            </p>
          )}
        </>
      )}
    </section>
  );
}
