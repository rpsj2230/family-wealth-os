import { formatInrCompact, formatPct } from '@fwos/core';
import { plural } from '@/app/(app)/accounts/BankOverview';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { BarRow, CardHead, homeLink } from './parts';

const when = (days: number) => (days === 0 ? 'Today' : `Within ${plural(days, 'day')}`);

/**
 * How fast the money can be reached. First what arrives with nothing sold (accounts now, then deposits as they mature); then, for the
 * windows set in Settings, what could be in the bank at no cost and the most there could be if funds are sold and deposits broken.
 */
export function Liquidity({ m, sample }: { m: HomeModel; sample: boolean }) {
  const l = m.liquidity;
  const steps = l.ladder.filter((s) => s.amount > 0 || s.key === 'now');
  const top = Math.max(1, l.ladderTotal);
  return (
    <section className="card hm-card" aria-labelledby="hm-liquid">
      <CardHead
        title="How fast can I get at it?"
        id="hm-liquid"
        href={homeLink('/raise', sample)}
        linkLabel="I need money"
      />
      <p className="muted small">
        Nothing sold: accounts now, then each deposit as it matures. Total{' '}
        {formatInrCompact(l.ladderTotal)}.
      </p>
      <ol className="dv-list">
        {steps.map((s) => (
          <BarRow
            key={s.key}
            name={s.label}
            amount={formatInrCompact(s.amount)}
            share={formatPct(s.cumulative / top, 0)}
            scale={s.cumulative / top}
            sub={
              s.key === 'now'
                ? s.items.length > 0
                  ? `includes ${plural(s.items.length, 'matured deposit')} waiting to be confirmed`
                  : 'savings and cash'
                : s.items.length > 0
                  ? `${plural(s.items.length, 'deposit')} · ${formatInrCompact(s.cumulative)} in all by then`
                  : `${formatInrCompact(s.cumulative)} in all by then`
            }
          />
        ))}
      </ol>

      <h3 className="bv-h hm-sub">Most that could be in the bank, by when</h3>
      <table className="tbl hm-raise">
        <caption className="sr-only">
          Amount that could be in the bank by each date, at no cost and including sales and early
          breaks
        </caption>
        <thead>
          <tr>
            <th scope="col">By</th>
            <th scope="col" className="num">
              No cost
            </th>
            <th scope="col" className="num">
              With sales and breaks
            </th>
          </tr>
        </thead>
        <tbody>
          {l.raise.map((r) => (
            <tr key={r.days}>
              <th scope="row">
                {when(r.days)}
                <span className="muted small"> {niceDate(r.date)}</span>
              </th>
              <td className="num">{formatInrCompact(r.free)}</td>
              <td className="num">{formatInrCompact(r.most)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        Before tax and penalties. Selling funds is taxed and breaking a deposit early loses
        interest; the “I need money” page shows the cost of each way.
      </p>
    </section>
  );
}
