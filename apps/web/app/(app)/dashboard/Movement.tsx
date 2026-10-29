import Link from 'next/link';
import {
  MOVEMENT_PERIODS,
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
import { MONEY_WORDS as W } from '@/lib/money-words';
import { CardHead, MaybeLink, homeLink, rupees, tone } from './parts';

/**
 * The family's own money and its profit, under the net worth: own money put in (with the part worked out from balances shown apart),
 * profit so far and its per cent of own money, the yearly return (XIRR, money-weighted), and the maturity proceeds still to place.
 * Each figure is the capital ledger's (core capital.ts); a figure that cannot be worked out says so instead of showing a number.
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
    <div className="hm-capital" role="group" aria-label="Own money and profit">
      <p className="hm-view small muted" data-testid="hm-view-lifetime">
        <strong>Lifetime:</strong> your own money is only what you brought in from outside (salary,
        money sent from Singapore, the balances on the first day). Interest and fund gains are never
        counted as own money: they are the profit. Today’s deposits and funds cost more than your
        own money because earlier interest was reinvested; that cost is the “amount invested now” on
        the cards below.
      </p>
      <div className="hm-cap">
        <div className="hm-cap-label">
          {W.ownMoney} <Why explain={ex['home.ownMoney']} />
        </div>
        <div className="hm-cap-value" data-testid="hm-own-money">
          {opening ? formatInrCompact(t.ownMoney) : '–'}
        </div>
        {opening ? (
          <ul className="hm-cap-parts small" data-testid="hm-own-money-parts">
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
        ) : (
          <div className="hm-cap-note">shows once balances or deposits are recorded</div>
        )}
      </div>
      <div className="hm-cap">
        <div className="hm-cap-label">
          {W.profitTotal} <Est /> <Why explain={ex['home.profitSoFar']} />
        </div>
        <div
          className={`hm-cap-value ${tone(opening ? t.profit : null)}`}
          data-testid="hm-profit-so-far"
        >
          {opening ? rupees(t.profit) : '–'}
        </div>
        <div className="hm-cap-note">
          {t.profitPct !== null
            ? `${formatPct(t.profitPct, 1)} of your own money: today’s net worth less your own money (interest, fund gains, exchange moves)`
            : 'no own money to measure a per cent against'}
        </div>
      </div>
      <div className="hm-cap">
        <div className="hm-cap-label">
          {W.xirrOwn} <Why explain={ex['home.xirr']} />
        </div>
        <div className={`hm-cap-value ${tone(t.xirr.rate)}`} data-testid="hm-xirr">
          {t.xirr.rate !== null ? formatPct(t.xirr.rate, 1) : '–'}
        </div>
        <div className="hm-cap-note">
          {t.xirr.rate !== null
            ? 'on your own money, with the dates it came in, to today’s net worth'
            : 'cannot be worked out yet'}
        </div>
      </div>
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
