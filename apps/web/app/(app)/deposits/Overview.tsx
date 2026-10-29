import Link from 'next/link';
import { TypeLegend } from '@/app/(app)/accounts/TypeLegend';
import {
  formatInr,
  formatInrCompact,
  formatPct,
  type BankOverview as Overview,
  type BankShare,
  type ExplainSet,
  type MaturityYear,
  type PersonStyle,
} from '@fwos/core';
import { Delta, SplitBar, Stat, plural, whole } from '@/app/(app)/accounts/BankOverview';
import '@/app/(app)/accounts/bankoverview.css';
import './overview.css';
import { PersonBadge } from '@/components/Person';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import { MONEY_WORDS as W } from '@/lib/money-words';

/**
 * The overview at the top of Deposits: what the fixed deposits are worth, what was put in, what they pay at maturity, the profit and
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
}: {
  ex: ExplainSet<'deposits'>;
  o: Overview;
  banks: BankShare[];
  ladder: MaturityYear[];
  /** insurance position of the whole household (the person filter does not narrow it) */
  cover: { limit: number; uninsured: number; banksOver: number };
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

  return (
    <section className="card bv dv" aria-label="Fixed deposits overview">
      <div className="bv-top">
        <div className="bv-hero">
          <WhyHead why={ex['deposits.total']}>
            <h2 className="bv-eyebrow">Fixed deposits today{scope ? ` · ${scope}` : ''}</h2>
          </WhyHead>
          <div className="bv-big" data-testid="dv-current">
            {formatInrCompact(o.current)}
          </div>
          <div className="bv-exact">{whole(o.current)}</div>
          <p className="bv-count">
            {empty
              ? 'No deposit is running.'
              : `${plural(o.deposits, 'deposit')} in ${plural(banks.length, 'bank')}${o.fdRate !== null ? ` · ${formatPct(o.fdRate, 2)} a year on average` : ''}`}
          </p>
          <p className="bv-view small muted" data-testid="bv-view-current">
            <strong>Amount invested now:</strong> the principal of today’s deposits (it includes
            interest reinvested from earlier deposits), against their value today. Your own money
            (never including interest) and the total profit on it are on{' '}
            <Link href={sample ? '/demo/dashboard' : '/'}>Home</Link>.
          </p>
          <div className="bv-deltas">
            <Delta
              label={W.profitOnInvested}
              amount={o.profit}
              pct={o.profitPct}
              note="interest earned so far on the principal"
              why={ex['deposits.profit']}
            />
            <Delta
              label="Earned today"
              amount={o.today.change}
              pct={o.today.changePct}
              note="since yesterday, at each rate; % of yesterday’s value"
              estimate
              why={ex['deposits.today']}
            />
          </div>
        </div>

        <div className="bv-journey">
          <WhyHead why={ex['deposits.journey']}>
            <h3 className="bv-h">From amount invested now to maturity</h3>
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
                aria-label={`${formatPct(pctDone, 0)} of the interest has been earned: ${whole(o.interest.earned)} of ${whole(o.interest.total)}`}
              >
                <span className="bv-fill" style={{ width: `${pctDone * 100}%` }} />
                <span className="bv-dot" style={{ left: `${pctDone * 100}%` }} />
              </div>
              <dl className="bv-ends">
                <div>
                  <dt>{W.investedNow}</dt>
                  <dd>{formatInrCompact(o.invested)}</dd>
                </div>
                <div className="mid">
                  <dt>{W.valueToday}</dt>
                  <dd>{formatInrCompact(o.current)}</dd>
                </div>
                <div className="end">
                  <dt>{W.atMaturity}</dt>
                  <dd>{formatInrCompact(o.maturity)}</dd>
                </div>
              </dl>
              <p className="bv-jnote">
                <strong>{formatPct(pctDone, 0)}</strong> of the interest is earned:{' '}
                {formatInrCompact(o.interest.earned)} so far, {formatInrCompact(o.interest.toEarn)}{' '}
                still to come.
              </p>
            </>
          )}
        </div>
      </div>

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
                    {plural(b.count, 'deposit')} · {formatInrCompact(b.invested)} put in
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

      <dl className="bv-grid" aria-label="More figures">
        <Stat
          label={W.principalNow}
          value={formatInrCompact(o.invested)}
          sub={`${plural(o.deposits, 'running deposit')} · principal only`}
          why={ex['deposits.invested']}
        />
        <Stat
          label="Maturity value"
          value={formatInrCompact(o.maturity)}
          sub={`${formatInrCompact(o.interest.total)} total interest over the life of the deposits`}
          why={ex['deposits.maturity']}
        />
        <Stat
          label="Interest still to earn"
          value={formatInrCompact(o.interest.toEarn)}
          sub="until every deposit matures"
          why={ex['deposits.toEarn']}
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
          label={`Maturing in ${plural(o.soon.days, 'day')}`}
          value={o.soon.count === 0 ? 'None' : formatInrCompact(o.soon.amount)}
          sub={o.soon.count === 0 ? 'nothing falls due soon' : plural(o.soon.count, 'deposit')}
          tone={o.soon.count > 0 ? 'warn' : undefined}
          href={to('/deposits?tab=maturities')}
          why={ex['deposits.soon']}
        />
        <Stat
          label="To confirm"
          value={toConfirm === 0 ? 'None' : toConfirm}
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
              ? `${banks[0].bank} holds ${formatInrCompact(banks[0].current)} of the deposits`
              : 'no bank yet'
          }
          why={ex['deposits.largest']}
        />
        <Stat
          label="Above the insured limit"
          value={cover.uninsured > 0 ? formatInrCompact(cover.uninsured) : 'None'}
          sub={
            cover.uninsured > 0
              ? `in ${plural(cover.banksOver, 'bank')} · limit ${formatInr(cover.limit)} per bank and name`
              : `all within ${formatInr(cover.limit)} per bank and name`
          }
          tone={cover.uninsured > 0 ? 'warn' : undefined}
          href={to('/deposits?tab=cover')}
          why={ex['deposits.cover']}
        />
      </dl>

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
            Invested is the amount of each running deposit. Current value is what each is worth
            today on its own rate and terms; maturity value is what it pays on its date. Profit so
            far is current value less invested.
          </li>
          <li>
            Earned today is an estimate: the difference between each deposit’s value today and
            yesterday on its own terms. A deposit past its date, or waiting for you to confirm where
            the money went, is left out.
          </li>
          <li>
            The insured limit is counted per bank and per name across every deposit and savings
            account, so it can differ from the deposits alone. Foreign banks are left out of it.
          </li>
        </ul>
      </details>
    </section>
  );
}
