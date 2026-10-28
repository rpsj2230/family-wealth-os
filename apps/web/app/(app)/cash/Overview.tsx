import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  formatPct,
  type BankOverview as Overview,
  type CashBankShare,
  type ExplainSet,
  type PersonStyle,
} from '@fwos/core';
import { Delta, SplitBar, Stat, plural, whole } from '@/app/(app)/accounts/BankOverview';
import '@/app/(app)/accounts/bankoverview.css';
import '@/app/(app)/deposits/overview.css';
import { ForeignCashLines } from '@/components/ForeignCash';
import { PersonBadge } from '@/components/Person';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';

/**
 * The overview at the top of Cash: what the savings accounts hold today, what they are estimated to earn, which bank holds how much, and
 * how fresh the balances are. Every figure comes from @fwos/core (bankOverview over the savings alone, cashByBank, largestCash).
 */
export function CashOverviewPanel({
  o,
  banks,
  interestYear,
  avgRate,
  largest,
  styles,
  scope = null,
  sample = false,
  ex,
}: {
  ex: ExplainSet<'cash'>;
  o: Overview;
  banks: CashBankShare[];
  /** estimated interest a year at the rates in force, after tax at source */
  interestYear: number;
  avgRate: number | null;
  largest: { code: string; bank: string; amount: number } | null;
  styles: Record<string, PersonStyle>;
  scope?: string | null;
  sample?: boolean;
}) {
  const to = (path: string) => (sample ? `/demo${path}` : path);
  const empty = o.accounts === 0;
  const people = o.people.map((p) => ({ ...p, style: styles[p.ownerId] }));
  const topShare = Math.max(0.0001, banks[0]?.share ?? 0);
  const stale = banks.reduce((s, b) => s + b.stale, 0);
  const oldest =
    banks
      .map((b) => b.oldest)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;

  return (
    <section className="card bv dv" aria-label="Savings and cash overview">
      <div className="bv-top">
        <div className="bv-hero">
          <WhyHead why={ex['cash.total']}>
            <h2 className="bv-eyebrow">Cash available today{scope ? ` · ${scope}` : ''}</h2>
          </WhyHead>
          <div className="bv-big" data-testid="cv-current">
            {formatInrCompact(o.current)}
          </div>
          <div className="bv-exact">{whole(o.current)}</div>
          <ForeignCashLines items={o.foreign} testid="cv-fx" />
          <p className="bv-count">
            {empty
              ? 'No savings account is recorded.'
              : `${plural(o.accounts, 'account')} in ${plural(banks.length, 'bank')}${avgRate !== null ? ` · ${formatPct(avgRate, 2)} a year on average` : ''}`}
          </p>
          <div className="bv-deltas">
            <Delta
              label="Since the last balances"
              amount={o.profit}
              pct={o.profitPct}
              note="today's estimate against the balance last recorded; % of that balance"
              estimate
              why={ex['cash.sinceLast']}
            />
            <Delta
              label="Earned today"
              amount={o.today.change}
              pct={o.today.changePct}
              note="a day of interest at each account's rate; % of yesterday’s value"
              estimate
              why={ex['cash.today']}
            />
          </div>
        </div>

        <div className="bv-journey">
          <WhyHead why={ex['cash.earns']}>
            <h3 className="bv-h">What it earns</h3>
          </WhyHead>
          <dl className="bv-ends">
            <div>
              <dt>A year</dt>
              <dd>{formatInrCompact(interestYear)}</dd>
            </div>
            <div className="mid">
              <dt>A month</dt>
              <dd>{formatInrCompact(interestYear / 12)}</dd>
            </div>
            <div className="end">
              <dt>A day</dt>
              <dd>{formatInrCompact(interestYear / 365)}</dd>
            </div>
          </dl>
          <p className="bv-jnote">
            At the rates in force, after the tax taken at source set in Settings. Rates come from
            the account, else the <Link href={to('/rates')}>Rates list</Link> for its bank, else the
            assumed rate in Settings.
          </p>
        </div>
      </div>

      {!empty && (
        <div className="dv-banks">
          <WhyHead why={ex['cash.banks']}>
            <h3 className="bv-h">Which bank holds how much</h3>
          </WhyHead>
          <ol className="dv-list" data-testid="cv-banks">
            {banks.map((b) => (
              <li key={b.bankId}>
                <div className="dv-line">
                  <span className="dv-name">{b.bank}</span>
                  <strong className="dv-amt">{formatInrCompact(b.balance)}</strong>
                  <span className="dv-pct">{formatPct(b.share, 0)}</span>
                </div>
                <div className="dv-bar" aria-hidden="true">
                  <span style={{ width: `${(b.share / topShare) * 100}%` }} />
                </div>
                <div className="dv-sub">
                  {plural(b.count, 'account')}
                  {b.avgRate !== null ? ` · ${formatPct(b.avgRate, 2)}` : ''} ·{' '}
                  {formatInrCompact(b.interestYear)} a year
                  {b.stale > 0
                    ? ` · ${b.stale} balance${b.stale === 1 ? '' : 's'} out of date`
                    : ''}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      <dl className="bv-grid" aria-label="More figures">
        <Stat
          label="Savings today"
          value={formatInrCompact(o.current)}
          sub={`${formatInrCompact(o.invested)} last recorded`}
        />
        <Stat
          label="Interest a year"
          value={formatInrCompact(interestYear)}
          sub={
            avgRate !== null ? `${formatPct(avgRate, 2)} on average, an estimate` : 'no rate known'
          }
          why={ex['cash.interestYear']}
        />
        <Stat
          label="Largest balance"
          value={largest ? formatInrCompact(largest.amount) : '–'}
          sub={largest ? `${largest.code} · ${largest.bank}` : 'no account yet'}
          why={ex['cash.largestBalance']}
        />
        <Stat
          label="Largest bank"
          value={banks[0] ? formatPct(banks[0].share, 0) : '–'}
          sub={
            banks[0]
              ? `${banks[0].bank} holds ${formatInrCompact(banks[0].balance)} of the savings`
              : 'no bank yet'
          }
          why={ex['cash.largestBank']}
        />
        <Stat
          label="Balances out of date"
          value={stale === 0 ? 'None' : stale}
          sub={
            stale === 0
              ? oldest
                ? `oldest balance ${niceDate(oldest)}`
                : 'all recent'
              : 'update them on the Monthly update'
          }
          tone={stale > 0 ? 'warn' : undefined}
          href={to('/monthly')}
          why={ex['cash.stale']}
        />
        <Stat
          label="Fixed deposits"
          value="See Deposits"
          sub="the other part of the money in banks"
          href={to('/deposits')}
        />
      </dl>

      {(people.length > 1 || o.accountTypes.length > 0) && !empty && (
        <div className="bv-splits">
          {people.length > 1 && (
            <div className="bv-split">
              <WhyHead why={ex['cash.people']}>
                <h3 className="bv-h">Whose cash</h3>
              </WhyHead>
              <SplitBar
                caption="Whose cash"
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
                    <span className="bv-lpct">{formatPct(p.share, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {o.accountTypes.length > 0 && (
            <div className="bv-split">
              <WhyHead why={ex['cash.types']}>
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
              <ul className="bv-legend plain">
                {o.accountTypes.map((t) => (
                  <li key={t.key}>
                    <span className={`bv-swatch type-${t.key}`} aria-hidden="true" />
                    <span className="bv-lname">{t.label}</span>
                    <strong className="bv-lamt">{formatInrCompact(t.amount)}</strong>
                    <span className="bv-lpct">{formatPct(t.share, 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <details className="bv-how">
        <summary>How these figures are worked out</summary>
        <ul className="list small muted">
          <li>
            A savings balance is the last one recorded, moved forward at the account&apos;s rate
            when it is old. “Since the last balances” is that movement; a foreign-currency balance
            is counted at today&apos;s rupee value with no gain, and shown on its own under the
            total with its rupee value, the rate and the day of the rate (the latest exchange rate
            on file, refreshed every day).
          </li>
          <li>
            Interest is an estimate: balance times rate, less the tax taken at source set in
            Settings. The bank credits it in lumps, so the real figure moves in steps. Money held by
            others and closed accounts are left out. Insurance cover counts savings and deposits
            together; see <Link href={to('/deposits?tab=cover')}>Deposits, Insurance cover</Link>.
          </li>
          <li>
            Amounts are in rupees; {formatInr(Math.round(o.current))} is today&apos;s estimate.
          </li>
        </ul>
      </details>
    </section>
  );
}
