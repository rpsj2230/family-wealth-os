import { TERMS, formatInr, formatInrCompact, formatPct, type ExplainSet } from '@fwos/core';
import { GrowthStrip } from '@/components/GrowthStrip';
import { Extra, Pill, TileHead, short, signed, signedPct } from '@/components/MoneyHeadline';
import { Why } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { MaybeLink, homeLink } from './parts';

/**
 * The top of Home as approved (money words v6): net worth with today's change and what this financial year earned, how the money is
 * growing (one compact strip of yearly rates), where the wealth came from (Own money + Lifetime profit = Net worth), the four kinds of
 * holding, and the useful extras ("Also on this page"). One dark panel; every figure comes from buildHome(), this only draws it.
 */
export function HomeHeadline({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const to = (path: string) => homeLink(path, sample);
  const g = m.growth;
  const x = m.extras;
  const ef = x.earnedFy;
  const t = m.capital.totals;
  const opening = m.capital.opening;
  const cls = (k: 'fd' | 'funds' | 'cash' | 'others') => m.classes.find((c) => c.key === k);
  const fd = cls('fd');
  const funds = cls('funds');
  const cash = cls('cash');
  const others = cls('others');
  const otherParts = m.allocation.filter(
    (a) => !['cash', 'fd', 'funds'].includes(a.key) && a.amount > 0,
  );
  const since = g.own.since ? `Since ${g.own.since.slice(0, 4)}` : TERMS.xirrOwn.label;

  return (
    <section className="hl" aria-label="Net worth">
      <div className="hl-lbl">
        <h2 className="hl-h">{TERMS.netWorth.label}</h2>
        <Why explain={ex['home.netWorth']} tone="on-dark" />
      </div>
      <div className="hl-big num" data-testid="hm-total" title={formatInr(Math.round(m.total))}>
        {formatInr(Math.round(m.total))}
      </div>
      <div className="hl-pills">
        <Pill
          amount={m.change.today.amount}
          pct={m.change.today.pct}
          label={TERMS.todayChange.label}
          why={ex['home.today']}
          testId="hl-today"
        />
        {ef && (
          <Pill
            amount={ef.total}
            pct={ef.pct}
            label={TERMS.earnedFy.label}
            why={ex['home.earnedFy']}
            testId="hl-earned-fy"
          />
        )}
      </div>
      <p className="hl-asof">
        as of {niceDate(m.today)} · est.
        {x.notCounted.count > 0 && (
          <span data-testid="hm-not-counted">
            {' '}
            · Property {formatInr(Math.round(x.notCounted.amount))} not counted
          </span>
        )}
      </p>

      <GrowthStrip
        title="How is my money growing?"
        testId="hm-growth"
        tone="on-dark"
        inflation={g.inflation}
        items={[
          {
            key: 'all',
            label: 'All money',
            rate: g.all?.rate ?? null,
            main: true,
            why: ex['home.earningRate'],
          },
          { key: 'funds', label: 'Mutual funds', rate: g.funds, why: ex['home.fundsXirr'] },
          { key: 'fd', label: 'Fixed deposits', rate: g.fd, why: ex['home.depositsXirr'] },
          {
            key: 'savings',
            label: 'Savings',
            rate: g.savings?.rate ?? null,
            why: ex['home.savingsRate'],
          },
          { key: 'own', label: since, rate: g.own.rate, why: ex['home.xirr'] },
        ]}
      />

      <div className="hl-sec" role="group" aria-label="Where the wealth came from">
        <div className="hl-bridge">
          <span className="hl-b">
            <span className="hl-bk">
              {TERMS.ownMoney.label}
              <Why explain={ex['home.ownMoney']} tone="on-dark" />
            </span>
            <b className="num" data-testid="hm-own-money">
              {opening ? formatInr(Math.round(t.ownMoney)) : '–'}
            </b>
          </span>
          <b className="hl-op" aria-hidden="true">
            +
          </b>
          <span className="hl-b">
            <span className="hl-bk">
              {TERMS.lifetimeProfit.label}
              <Why explain={ex['home.profitSoFar']} tone="on-dark" />
            </span>
            <b
              className={`num ${t.profit < 0 ? 'hl-neg' : 'hl-pos'}`}
              data-testid="hm-profit-so-far"
            >
              {opening ? signed(t.profit) : '–'}
            </b>
            {opening && t.profitPct !== null && (
              <span className="hl-small"> ({signedPct(t.profitPct)} overall)</span>
            )}
          </span>
          <b className="hl-op" aria-hidden="true">
            =
          </b>
          <span className="hl-b">
            <span className="hl-bk hl-bridge-sum">{TERMS.netWorth.label}</span>
            <b className="num">{formatInr(Math.round(m.total))}</b>
          </span>
        </div>
        {opening && (
          <details className="hl-parts">
            <summary>Where the own money came from</summary>
            <ul data-testid="hm-own-money-parts">
              <li>
                <span>Balances on {niceDate(opening.date)}</span>
                <span className="num">{formatInrCompact(t.opening)}</span>
              </li>
              {m.capital.abroad.count > 0 && (
                <li data-testid="hm-own-money-abroad">
                  <span>
                    Sent from Singapore since ({m.capital.abroad.count} transfer
                    {m.capital.abroad.count === 1 ? '' : 's'})
                  </span>
                  <span className="num">{formatInrCompact(m.capital.abroad.amount)}</span>
                </li>
              )}
              {t.confirmedExternal !== 0 && (
                <li>
                  <span>Other money in or out, confirmed</span>
                  <span className="num">{signed(t.confirmedExternal)}</span>
                </li>
              )}
              {Math.abs(t.unexplained - m.capital.abroad.amount) >= 1 && (
                <li>
                  <span>Other money in or out, worked out from balances</span>
                  <span className="num">{signed(t.unexplained - m.capital.abroad.amount)}</span>
                </li>
              )}
            </ul>
          </details>
        )}
        {m.capital.proceeds.count > 0 && (
          <p className="hl-warnline" data-testid="hm-proceeds">
            {formatInrCompact(m.capital.proceeds.amount)} from {m.capital.proceeds.count} matured
            deposit{m.capital.proceeds.count === 1 ? '' : 's'} is counted once until you{' '}
            <MaybeLink href={to('/reconcile')}>say where the money went</MaybeLink>.
          </p>
        )}
      </div>

      <ul className="hl-tiles" aria-label="By kind of holding">
        {fd && (
          <li className="hl-tile" data-testid="hl-tile-fd">
            <TileHead label="Fixed deposits" href={to('/deposits')} />
            <div className="hl-tv num">{formatInr(Math.round(fd.current))}</div>
            <div className="hl-ts">
              {TERMS.profit.label}{' '}
              <span className={fd.profit < 0 ? 'hl-neg' : 'hl-pos'}>{signed(fd.profit)}</span>
              {fd.profitPct !== null && ` (${signedPct(fd.profitPct)})`}
              {g.fd !== null && ` · ${TERMS.xirr.label} ${formatPct(g.fd, 2)}`}
            </div>
          </li>
        )}
        {funds && (
          <li className="hl-tile" data-testid="hl-tile-funds">
            <TileHead label="Mutual funds" href={to('/investments')} />
            <div className="hl-tv num">{formatInr(Math.round(funds.current))}</div>
            <div className="hl-ts">
              {TERMS.profit.label}{' '}
              <span className={funds.profit < 0 ? 'hl-neg' : 'hl-pos'}>{signed(funds.profit)}</span>
              {funds.profitPct !== null && ` (${signedPct(funds.profitPct)})`}
              {g.funds !== null && ` · ${TERMS.xirr.label} ${formatPct(g.funds, 2)}`}
            </div>
          </li>
        )}
        {cash && (
          <li className="hl-tile" data-testid="hl-tile-cash">
            <TileHead label="Savings and cash" href={to('/cash')} />
            <div className="hl-tv num">{formatInr(Math.round(cash.current))}</div>
            <div className="hl-ts">
              {TERMS.interestEarned.label} this FY{' '}
              <span className="hl-pos">{ef ? signed(ef.savings) : '–'}</span>
              {g.savings && ` · ${formatPct(g.savings.rate, 2)} a year`}
            </div>
          </li>
        )}
        {others && others.current > 0 && (
          <li className="hl-tile" data-testid="hl-tile-others">
            <TileHead label="Money lent and other" href={to('/others')} />
            <div className="hl-tv num">{formatInr(Math.round(others.current))}</div>
            <div className="hl-ts">
              {otherParts.length > 0
                ? otherParts
                    .map((a) => `${a.label.toLowerCase()} ${formatInr(Math.round(a.amount))}`)
                    .join(' · ')
                : 'recorded values'}
            </div>
          </li>
        )}
      </ul>

      <div className="hl-extras">
        <h3 className="hl-xh">Also on this page</h3>
        <ul className="hl-xg">
          <Extra
            label={`${TERMS.earnedFy.label}, by kind`}
            value={ef ? `${ef.total < 0 ? '−' : '+'}${formatInrCompact(Math.abs(ef.total))}` : '–'}
            sub={
              ef
                ? [
                    Math.abs(ef.deposits) >= 1 ? `deposits ${short(ef.deposits)}` : null,
                    Math.abs(ef.funds) >= 1 ? `funds ${short(ef.funds)}` : null,
                    Math.abs(ef.savings) >= 1 ? `savings ${short(ef.savings)}` : null,
                    Math.abs(ef.other) >= 1 ? `other ${short(ef.other)}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'shows once the records reach this year'
            }
            testId="hl-x-earned"
          />
          <Extra
            label="Available in 30 days"
            value={formatInrCompact(x.available30.total)}
            sub={`savings ${formatInrCompact(x.available30.cash)} + deposits maturing ${formatInrCompact(x.available30.deposits)}`}
            href={to('/raise')}
            why={ex['home.free30']}
            testId="hl-x-available"
          />
          <Extra
            label={TERMS.maturing90.label}
            value={formatInrCompact(x.maturing90.principal)}
            sub={
              x.maturing90.count > 0
                ? `${x.maturing90.count} deposit${x.maturing90.count === 1 ? '' : 's'} · plan where it goes`
                : 'no deposit matures in this time'
            }
            href={to('/deposits?tab=maturities')}
            why={ex['home.maturing90']}
            testId="hl-x-maturing"
          />
          <Extra
            label="Above insured limit"
            value={x.aboveInsured.amount > 0 ? formatInrCompact(x.aboveInsured.amount) : 'None'}
            sub={
              x.aboveInsured.amount > 0
                ? `in ${x.aboveInsured.banks} bank${x.aboveInsured.banks === 1 ? '' : 's'} · over ${formatInrCompact(x.aboveInsured.limit)} per bank and name`
                : `all within ${formatInrCompact(x.aboveInsured.limit)} per bank and name`
            }
            warn={x.aboveInsured.amount > 0}
            href={to('/deposits?tab=cover')}
            why={ex['home.insured']}
            testId="hl-x-insured"
          />
          <Extra
            label={TERMS.nreNro.label}
            value={`${formatInrCompact(x.nre)} · ${formatInrCompact(x.nro)}`}
            sub="bank money · NRO interest is taxed"
            href={to('/accounts')}
            why={ex['home.nreNro']}
            testId="hl-x-nre"
          />
        </ul>
      </div>
    </section>
  );
}
