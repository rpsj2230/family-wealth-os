import Link from 'next/link';
import { TypeLegend } from '@/app/(app)/accounts/TypeLegend';
import {
  TERMS,
  formatInr,
  formatInrCompact,
  formatPct,
  LADDER_DAYS,
  type BankGrowth,
  type DepositsVsBest,
  type BankOverview as Overview,
  type BankShare,
  type ExplainSet,
  type MaturityYear,
  type PersonStyle,
} from '@fwos/core';
import { SplitBar, Stat, plural, whole } from '@/app/(app)/accounts/BankOverview';
import '@/app/(app)/accounts/bankoverview.css';
import './overview.css';
import { Extra, Extras, HeadlinePanel, Pill, Tile, signed } from '@/components/MoneyHeadline';
import { PersonBadge } from '@/components/Person';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';

/**
 * The overview at the top of Deposits: what the fixed deposits are worth, what was invested, what they pay at maturity, the profit and
 * today's change, which bank holds how much, and what falls due in which year. Every figure is computed in @fwos/core
 * (bankOverview over the deposits alone, depositsByBank, maturityLadder); this only draws them.
 */
export function DepositOverviewPanel({
  o,
  banks,
  ladder,
  cover,
  toConfirm,
  styles,
  scope = null,
  sample = false,
  ex,
  growth = null,
  fyInterest = null,
  vsBest = null,
}: {
  /** interest of the running deposits in this financial year, earned and to come (core deposit-extras.ts) */
  fyInterest?: { fy: string; earned: number; total: number } | null;
  /** each running deposit against today's best offer for the same term (core deposit-extras.ts) */
  vsBest?: DepositsVsBest | null;
  ex: ExplainSet<'deposits'>;
  /** the deposits' XIRR, interest this FY and average rates (core bank-growth.ts); null draws the page without them */
  growth?: BankGrowth | null;
  o: Overview;
  banks: BankShare[];
  ladder: MaturityYear[];
  /** insurance position of the whole household (the person filter does not narrow it) */
  cover: {
    limit: number;
    uninsured: number;
    banksOver: number;
    holdings: number;
    holdingsOver: number;
  };
  toConfirm: number;
  styles: Record<string, PersonStyle>;
  scope?: string | null;
  sample?: boolean;
}) {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  const empty = o.deposits === 0;
  const pctDone = o.interest.journey;
  const people = o.people.map((p) => ({ ...p, style: styles[p.ownerId] }));
  const typeNames = Object.fromEntries(Object.entries(styles).map(([id, st]) => [id, st.name]));
  const biggest = Math.max(1, ...ladder.map((s) => s.amount));
  const topShare = Math.max(0.0001, banks[0]?.share ?? 0);
  const r = growth?.rates;
  const kinds = [r?.nre ? `${r.nre.count} NRE` : null, r?.nro ? `${r.nro.count} NRO` : null]
    .filter(Boolean)
    .join(', ');

  return (
    <section className="bv-wrap" aria-label="Fixed deposits overview">
      <HeadlinePanel
        label={`${TERMS.currentValue.label} of fixed deposits${scope ? ` · ${scope}` : ''}`}
        value={o.current}
        why={ex['deposits.total']}
        ariaLabel="Current value of fixed deposits"
        testId="dv-current"
      >
        <div className="hl-pills">
          <Pill
            amount={o.profit}
            pct={o.profitPct}
            pctNote="overall"
            label={TERMS.profitInterest.label}
            extra={
              growth?.fd
                ? ` · ${TERMS.xirr.label} ${formatPct(growth.fd.rate, 2)} a year`
                : undefined
            }
            why={ex['deposits.profit']}
            extraWhy={ex['deposits.xirr']}
            testId="dv-profit"
          />
        </div>
        <p className="hl-asof">
          {empty
            ? 'No deposit is running.'
            : `${plural(o.deposits, 'running deposit')}${kinds ? ` (${kinds})` : ''} · est. · maturity amounts from the bank for ${o.maturityFromBank === o.deposits ? `all ${o.deposits}` : `${o.maturityFromBank} of ${o.deposits}, the rest worked out from their terms`}`}
        </p>
        <ul className="hl-tiles" aria-label="The deposits in figures">
          <Tile
            label={TERMS.investedPrincipal.label}
            value={formatInr(Math.round(o.invested))}
            sub={null}
            why={ex['deposits.invested']}
            testId="dv-tile-invested"
          />
          <Tile
            label={TERMS.maturityValue.label}
            value={formatInr(Math.round(o.maturity))}
            sub={`${TERMS.totalInterest.label} ${formatInr(Math.round(o.interest.total))}${o.interest.journey !== null ? ` · ${formatPct(o.interest.journey, 0)} earned so far` : ''}`}
            why={ex['deposits.maturity']}
            testId="dv-tile-maturity"
          />
          <Tile
            label={TERMS.interestToCome.label}
            value={formatInr(Math.round(o.interest.toEarn))}
            sub={null}
            why={ex['deposits.toEarn']}
            testId="dv-tile-tocome"
          />
          <Tile
            label={`${TERMS.interestEarned.label} this FY`}
            value={growth?.interestFy ? signed(growth.interestFy.deposits) : '–'}
            sub={r?.nro ? 'NRO part taxable' : 'NRE interest is tax-free'}
            why={ex['deposits.interestFy']}
            testId="dv-tile-fy"
          />
          <Tile
            label={TERMS.averageRate.label}
            value={typeof r?.all === 'number' ? `${formatPct(r.all, 2)} a year` : '–'}
            sub={
              [
                r?.nre ? `NRE ${formatPct(r.nre.rate, 2)}` : null,
                r?.nro
                  ? `NRO ${formatPct(r.nro.rate, 2)} (≈ ${formatPct(r.nro.afterTax, 1)} after tax)`
                  : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'no deposit is running'
            }
            href={to('/rates')}
            why={ex['deposits.avgRate']}
            testId="dv-tile-rate"
          />
          <Tile
            label="Maturing"
            value={formatInrCompact(o.maturingPrincipal.d30)}
            sub={`${LADDER_DAYS.d30} days · ${formatInrCompact(o.maturingPrincipal.d90)} in ${LADDER_DAYS.d90} days · ${formatInrCompact(o.maturingPrincipal.d365)} in a year`}
            href={to('/deposits?tab=maturities')}
            why={ex['deposits.soon']}
            testId="dv-tile-soon"
          />
        </ul>
        <Extras>
          <Extra
            label="Above insured limit"
            value={cover.uninsured > 0 ? formatInrCompact(cover.uninsured) : 'None'}
            sub={
              cover.uninsured > 0
                ? `deposits and savings, ${cover.holdingsOver} of ${cover.holdings} holdings`
                : `all within ${formatInr(cover.limit)} per bank and name`
            }
            warn={cover.uninsured > 0}
            href={to('/deposits?tab=cover')}
            why={ex['deposits.cover']}
            testId="dv-x-insured"
          />
          <Extra
            label="Interest by financial year"
            value={fyInterest ? formatInrCompact(fyInterest.total) : '–'}
            sub={
              fyInterest
                ? `FY ${fyInterest.fy}, earned and to come · every year on Reports, for your tax return`
                : 'for your tax return'
            }
            href={to('/reports')}
            testId="dv-x-fy"
          />
          <Extra
            label="Your rate vs today's best"
            value={
              !vsBest || vsBest.compared === 0
                ? 'No offers'
                : vsBest.below === 0
                  ? 'At the best'
                  : `+${formatInrCompact(vsBest.moreAYear)} a year`
            }
            sub={
              !vsBest || vsBest.compared === 0
                ? 'same term, from the Rates page: no offer on file for these terms'
                : vsBest.below === 0
                  ? `all ${plural(vsBest.compared, 'deposit')} at or above today's best for their term`
                  : `${vsBest.below} of ${vsBest.compared} below today's best for the same term, after tax · from the Rates page`
            }
            warn={!!vsBest && vsBest.below > 0}
            href={to('/rates')}
            testId="dv-x-best"
          />
        </Extras>
      </HeadlinePanel>

      <div className="card bv dv">
        <div className="bv-journey">
          <WhyHead why={ex['deposits.journey']}>
            <h3 className="bv-h">
              {TERMS.invested.label} → {TERMS.currentValue.label} → {TERMS.maturityValue.label}
            </h3>
          </WhyHead>
          {pctDone === null ? (
            <p className="muted small">
              No deposit has interest left to earn, so there is no journey to show.
            </p>
          ) : (
            <>
              <div
                className="bv-track"
                role="img"
                aria-label={`${formatPct(pctDone, 0)} of the total interest earned so far: ${whole(o.interest.earned)} of ${whole(o.interest.total)}`}
              >
                <span className="bv-fill" style={{ width: `${pctDone * 100}%` }} />
                <span className="bv-dot" style={{ left: `${pctDone * 100}%` }} />
              </div>
              <dl className="bv-ends">
                <div>
                  <dt>{TERMS.invested.label}</dt>
                  <dd>{formatInrCompact(o.invested)}</dd>
                </div>
                <div className="mid">
                  <dt>{TERMS.currentValue.label}</dt>
                  <dd>{formatInrCompact(o.current)}</dd>
                </div>
                <div className="end">
                  <dt>{TERMS.maturityValue.label}</dt>
                  <dd>{formatInrCompact(o.maturity)}</dd>
                </div>
              </dl>
              <p className="bv-jnote">
                <strong>{formatPct(pctDone, 0)}</strong> of the total interest earned so far:{' '}
                {formatInrCompact(o.interest.earned)} earned, {formatInrCompact(o.interest.toEarn)}{' '}
                {TERMS.interestToCome.label.toLowerCase()}.
              </p>
            </>
          )}
        </div>

        <dl className="bv-grid" aria-label="More figures">
          <Stat
            label={TERMS.todayChange.label}
            value={`${o.today.change < 0 ? '−' : '+'}${formatInr(Math.abs(Math.round(o.today.change)))}`}
            sub={
              o.today.changePct !== null
                ? `${formatPct(o.today.changePct, 2)} today · est.`
                : 'est.'
            }
            why={ex['deposits.today']}
          />
          <Stat
            label="Next maturity"
            value={o.next ? formatInrCompact(o.next.amount) : '–'}
            sub={
              o.next
                ? `${niceDate(o.next.date)} · ${o.next.days === 0 ? 'today' : `in ${plural(o.next.days, 'day')}`} · ${o.next.bank}${o.next.count > 1 ? ` and ${o.next.count - 1} more` : ''}`
                : 'no deposit is running'
            }
            href={to('/deposits?tab=maturities')}
            why={ex['deposits.next']}
          />
          <Stat
            label="To confirm"
            value={toConfirm === 0 ? 'None' : String(toConfirm)}
            sub={toConfirm === 0 ? 'nothing waiting' : 'matured: say where the money went'}
            tone={toConfirm > 0 ? 'warn' : undefined}
            href={to('/deposits?tab=maturities')}
            why={ex['deposits.toConfirm']}
          />
          <Stat
            label="Largest bank"
            value={banks[0] ? formatPct(banks[0].share, 0) : '–'}
            sub={
              banks[0]
                ? `${banks[0].bank} holds ${formatInrCompact(banks[0].current)}`
                : 'no bank yet'
            }
            why={ex['deposits.largest']}
          />
        </dl>

        {!empty && (
          <div className="dv-pair">
            <div className="dv-banks">
              <div className="dv-headrow">
                <WhyHead why={ex['deposits.banks']}>
                  <h3 className="bv-h">Which bank holds how much</h3>
                </WhyHead>
                <Link className="small" href={to('/deposits?g=bank')}>
                  Group the list by bank
                </Link>
              </div>
              <ol className="dv-list" data-testid="dv-banks">
                {banks.map((b) => (
                  <li key={b.bankId}>
                    <div className="dv-line">
                      <span className="dv-name">{b.bank}</span>
                      <strong className="dv-amt">{formatInrCompact(b.current)}</strong>
                      <span className="dv-pct">{formatPct(b.share, 0)}</span>
                    </div>
                    <div className="dv-bar" aria-hidden="true">
                      <span style={{ width: `${(b.share / topShare) * 100}%` }} />
                    </div>
                    <div className="dv-sub">
                      {plural(b.count, 'deposit')} · {formatInrCompact(b.invested)} invested
                      {b.avgRate !== null ? ` · ${formatPct(b.avgRate, 2)}` : ''}
                      {b.next
                        ? ` · next ${niceDate(b.next.date)} (${formatInrCompact(b.next.amount)})`
                        : ''}
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="dv-ladder">
              <WhyHead why={ex['deposits.ladder']}>
                <h3 className="bv-h">What matures, year by year</h3>
              </WhyHead>
              <ol className="dv-list" data-testid="dv-ladder">
                {ladder.map((s) => (
                  <li key={s.year}>
                    <div className="dv-line">
                      <span className="dv-name">{s.year}</span>
                      <strong className="dv-amt">{formatInrCompact(s.amount)}</strong>
                      <span className="dv-pct">{plural(s.count, 'deposit')}</span>
                    </div>
                    <div className="dv-bar alt" aria-hidden="true">
                      <span style={{ width: `${(s.amount / biggest) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ol>
              <p className="muted small">What each deposit pays on its date, including interest.</p>
            </div>
          </div>
        )}

        {(people.length > 1 || o.accountTypes.length > 0) && !empty && (
          <div className="bv-splits">
            {people.length > 1 && (
              <div className="bv-split">
                <WhyHead why={ex['deposits.people']}>
                  <h3 className="bv-h">Whose deposits</h3>
                </WhyHead>
                <SplitBar
                  caption="Whose deposits"
                  parts={people.map((p) => ({
                    key: p.ownerId,
                    label: p.style?.name ?? 'Unknown',
                    share: p.share,
                    className: 'person',
                    style: { background: p.style?.colour ?? 'var(--muted)' },
                  }))}
                />
                <ul className="bv-legend plain">
                  {people.map((p) => (
                    <li key={p.ownerId}>
                      <PersonBadge p={p.style} size={18} />
                      <span className="bv-lname">{p.style?.name ?? 'Unknown'}</span>
                      <strong className="bv-lamt">{formatInrCompact(p.current)}</strong>
                      <span className="bv-lpct">
                        {formatPct(p.share, 0)} ·{' '}
                        <span className={p.profit < 0 ? 'bv-neg' : 'bv-pos'}>
                          {p.profit < 0 ? '▼ ' : '▲ '}
                          {formatInrCompact(Math.abs(p.profit))}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {o.accountTypes.length > 0 && (
              <div className="bv-split">
                <WhyHead why={ex['deposits.types']}>
                  <h3 className="bv-h">NRE and NRO</h3>
                </WhyHead>
                <SplitBar
                  caption="NRE and NRO"
                  parts={o.accountTypes.map((t) => ({
                    key: t.key,
                    label: t.label,
                    share: t.share,
                    className: `type-${t.key}`,
                  }))}
                />
                <TypeLegend types={o.accountTypes} names={typeNames} sample={sample} />
              </div>
            )}
          </div>
        )}

        <details className="bv-how">
          <summary>How these figures are worked out</summary>
          <ul className="list small muted">
            <li>
              Invested (principal) is the amount each running deposit was booked with; a deposit
              renewed with its interest counts at its new amount, so earlier interest can be inside
              it. Current value is what each is worth now on its own rate and terms; maturity value
              is what it pays on its date. Profit (interest earned) is current value less invested;
              interest already paid out to your account is booked profit and is not in it.
            </li>
            <li>
              Today’s change is an estimate: the difference between each deposit’s current value and
              yesterday on its own terms. A deposit past its date, or waiting for you to confirm
              where the money went, is left out.
            </li>
            <li>
              The insured limit is counted per bank and per name across every deposit and savings
              account, so it can differ from the deposits alone. Foreign banks are left out of it.
            </li>
          </ul>
        </details>
      </div>
    </section>
  );
}
