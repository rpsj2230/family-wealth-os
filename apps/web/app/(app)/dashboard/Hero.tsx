import {
  formatInr,
  formatInrCompact,
  LADDER_DAYS,
  formatPct,
  coverageWords,
  sinceWords,
  sourceTag,
  type Explain,
  type HeadlineTile,
  type ExplainSet,
} from '@fwos/core';
import { Delta, SplitBar, Stat, plural, whole } from '@/app/(app)/accounts/BankOverview';
import { UpdatedCell } from '@/components/BankTable';
import { Why, WhyHead } from '@/components/Why';
import type { HomeModel } from '@/lib/home';
import { niceDate } from '@/lib/dates';
import { Money } from './Money';
import { MaybeLink, homeLink } from './parts';

const monthsText = (months: number) =>
  months >= 24 ? `${(months / 12).toFixed(1)} years` : plural(Math.round(months), 'month');

/** What was earned over a period, from the records on file, with where the period begins and how many holdings it rests on. */
function TileDelta({ label, tile, why }: { label: string; tile: HeadlineTile; why?: Explain }) {
  if (tile.dataStarts === null || (tile.empty && tile.from >= tile.to))
    return (
      <div className="bv-delta flat">
        <div className="bv-delta-label">
          {label}
          {why && <Why explain={why} />}
        </div>
        <div className="bv-delta-value">
          <strong>–</strong>
        </div>
        <div className="bv-delta-note">
          {tile.dataStarts === null
            ? 'shows once balances or deposits are recorded'
            : `nothing was recorded in this period: data starts ${niceDate(tile.dataStarts)}`}
        </div>
      </div>
    );
  const moved = tile.netWorth.change;
  return (
    <Delta
      label={label}
      amount={tile.amount}
      pct={tile.pct}
      estimate={tile.estimated}
      note={`${sinceWords(tile)}; % of the money at work`}
      extra={`${coverageWords(tile)}. Net worth moved ${moved < 0 ? '−' : '+'}${formatInrCompact(Math.abs(moved))}, money added or taken out included.`}
      why={why}
    />
  );
}

/**
 * One small line under the period tiles while funds with no transaction ledger exist (more than the Settings threshold): their gains
 * rest on monthly values, prices and the SIP plan until a fund statement is imported. It links to where the statement is imported.
 */
export function FundNote({
  m,
  sample,
  testId = 'hm-fund-note',
}: {
  m: HomeModel;
  sample: boolean;
  testId?: string;
}) {
  const n = m.fundNote;
  if (!n.show) return null;
  const href = homeLink('/import?tab=cas', sample);
  return (
    <p className="hm-approx small muted" data-testid={testId}>
      {n.text}. <MaybeLink href={href}>Import a fund statement</MaybeLink>
      {href ? '' : ' (Import > Fund statement)'}
    </p>
  );
}

/**
 * The top of Home: what the family is worth, how it changed today, this month and this financial year, how much of that is
 * verified, and the few figures that say what to look at next. Every figure comes from buildHome(); this only draws it.
 */
export function Hero({ m, sample, ex }: { m: HomeModel; sample: boolean; ex: ExplainSet<'home'> }) {
  const to = (path: string) => homeLink(path, sample);
  const link = (path: string) => {
    const href = to(path);
    return href ? { href } : {};
  };
  const t = m.trust;
  const share = (n: number) => (t.total > 0 ? n / t.total : 0);
  const bad = m.attention.filter((a) => a.tone === 'bad').length;
  const next = m.deposits.overview.next;
  const liquid = m.liquidity;

  return (
    <section className="card hm-hero" aria-label="Net worth">
      <div className="bv-top hm-top">
        <div className="bv-hero">
          <WhyHead why={ex['home.netWorth']}>
            <h2 className="bv-eyebrow">Net worth today</h2>
          </WhyHead>
          <div className="bv-big" data-testid="hm-total">
            {formatInrCompact(m.total)}
          </div>
          <div className="bv-exact">{whole(m.total)}</div>
          <p className="bv-count">
            {plural(m.counted, 'holding')} of {plural(m.people, 'person', 'people')}
            {m.asOf ? ` · latest recorded value ${niceDate(m.asOf)}` : ''}
          </p>
        </div>

        <div className="hm-deltas" aria-label="How net worth changed">
          <Delta
            label="Today"
            amount={m.change.today.amount}
            pct={m.change.today.pct}
            note="interest at each rate and fund prices, since yesterday; % of yesterday’s net worth"
            estimate
            why={ex['home.today']}
          />
          <TileDelta
            label={`Last ${plural(m.change.monthDays, 'day')}`}
            tile={m.tiles.recent}
            why={ex['home.month']}
          />
          <TileDelta label="This financial year" tile={m.tiles.fy} why={ex['home.fy']} />
        </div>
      </div>

      <FundNote m={m} sample={sample} />

      <Money m={m} ex={ex} />

      <div className="hm-trust">
        <div>
          <WhyHead why={ex['home.verified']}>
            <h3 className="bv-h">How much is verified</h3>
          </WhyHead>
          <p className="hm-trust-line">
            <strong data-testid="hm-verified">{formatPct(t.verifiedShare, 0)}</strong> of the total
            is verified or recent
          </p>
        </div>
        <div>
          <SplitBar
            caption="How the total is known"
            parts={[
              {
                key: 'c',
                label: 'Confirmed recently',
                share: share(t.confirmed),
                className: 'hm-t-confirmed',
              },
              {
                key: 'k',
                label: 'Worked out from deposit terms',
                share: share(t.calculated),
                className: 'hm-t-calc',
              },
              {
                key: 'u',
                label: 'Older or not yet confirmed',
                share: share(t.unconfirmed),
                className: 'hm-t-old',
              },
            ]}
          />
          <ul className="bv-legend hm-legend" style={{ ['--cols' as string]: 3 }}>
            <li>
              <span className="bv-swatch hm-t-confirmed" aria-hidden="true" />
              <span className="bv-lname">Confirmed recently</span>
              <strong className="bv-lamt">{formatInrCompact(t.confirmed)}</strong>
              <span className="bv-lpct">
                {formatPct(share(t.confirmed), 0)} · {plural(t.counts.confirmed, 'holding')}
              </span>
            </li>
            <li>
              <span className="bv-swatch hm-t-calc" aria-hidden="true" />
              <span className="bv-lname">From deposit terms</span>
              <strong className="bv-lamt">{formatInrCompact(t.calculated)}</strong>
              <span className="bv-lpct">
                {formatPct(share(t.calculated), 0)} · {plural(t.counts.calculated, 'deposit')}
              </span>
            </li>
            <li>
              <span className="bv-swatch hm-t-old" aria-hidden="true" />
              <span className="bv-lname">Older or unconfirmed</span>
              <strong className="bv-lamt">{formatInrCompact(t.unconfirmed)}</strong>
              <span className="bv-lpct">
                {formatPct(share(t.unconfirmed), 0)} · {plural(t.counts.unconfirmed, 'holding')}
              </span>
            </li>
          </ul>
        </div>
      </div>

      <dl className="bv-grid" aria-label="More figures">
        <Stat
          label="Cash and deposits"
          value={formatInrCompact(liquid.cashAndDeposits)}
          sub={`${m.total > 0 ? Math.round((liquid.cashAndDeposits / m.total) * 100) : 0}% of net worth${
            liquid.months !== null ? ` · covers ${monthsText(liquid.months)} of spending` : ''
          }`}
          {...link('/accounts')}
          why={ex['home.cashAndDeposits']}
        />
        <Stat
          label={`Free within ${plural(LADDER_DAYS.d30, 'day')}`}
          value={formatInrCompact(liquid.within30)}
          sub="cash plus deposits that mature, nothing sold"
          {...link('/raise')}
          why={ex['home.free30']}
        />
        <Stat
          label="Next maturity"
          value={next ? formatInrCompact(next.amount) : '–'}
          sub={
            next
              ? `${niceDate(next.date)} · ${next.days === 0 ? 'today' : `in ${plural(next.days, 'day')}`} · ${next.bank}${next.count > 1 ? ` and ${next.count - 1} more` : ''}`
              : 'no deposit is running'
          }
          {...link('/deposits?tab=maturities')}
          why={ex['home.nextMaturity']}
        />
        <Stat
          label={`Interest in ${m.deposits.interest.fy}`}
          value={formatInrCompact(m.deposits.interest.thisYear)}
          sub={`on running deposits · ${formatInrCompact(m.deposits.interest.ahead)} more over the next 12 months if held`}
          {...link('/deposits')}
          why={ex['home.interest']}
        />
        <Stat
          label="Mutual funds"
          value={m.funds ? formatInrCompact(m.funds.totals.value) : '–'}
          sub={
            m.funds
              ? `${m.funds.totals.gain >= 0 ? 'gain' : 'loss'} ${formatInrCompact(Math.abs(m.funds.totals.gain))}${
                  m.funds.totals.xirr !== null
                    ? ` · ${formatPct(m.funds.totals.xirr, 1)} a year${m.funds.totals.xirrEstimated ? ' (est.)' : ''}`
                    : ''
                }`
              : 'none recorded'
          }
          {...link('/investments')}
          why={ex['home.fundsStat']}
        />
        <Stat
          label="Goals on track"
          value={
            <>
              {m.goals.onTrack}
              <span className="muted"> / {m.goals.withTarget}</span>
            </>
          }
          sub={m.goals.list.length === 0 ? 'no goal yet' : 'see each goal'}
          {...link('/goals')}
          why={ex['home.goalsStat']}
        />
        <Stat
          label="Needs you"
          value={m.attention.length}
          sub={
            m.attention.length === 0
              ? 'nothing waiting'
              : `${bad > 0 ? `${bad} late or urgent · ` : ''}${plural(m.openTasks, 'open task')}`
          }
          tone={m.attention.length > 0 ? 'warn' : undefined}
          href="#hm-needs"
          why={ex['home.needsStat']}
        />
        <Stat
          label="Above the insured limit"
          value={
            m.deposits.cover.uninsured > 0 ? formatInrCompact(m.deposits.cover.uninsured) : 'None'
          }
          sub={
            m.deposits.cover.uninsured > 0
              ? `in ${plural(m.deposits.cover.banksOver, 'bank')} · limit ${formatInr(m.deposits.cover.limit)} per bank and name`
              : `all within ${formatInr(m.deposits.cover.limit)} per bank and name`
          }
          tone={m.deposits.cover.uninsured > 0 ? 'warn' : undefined}
          {...link('/deposits?tab=cover')}
          why={ex['home.insured']}
        />
      </dl>

      <details className="bv-how">
        <summary>How these figures are worked out</summary>
        <ul className="list small muted">
          <li>
            Net worth adds every holding that is wealth (banks, deposits, funds, shares, property,
            money lent, pension accounts) at its latest recorded value moved forward to today:
            deposits from their own terms, savings at their rate, funds with the latest price.
            Insurance cover is never counted. A deposit past its date that is still listed as
            running is counted at its maturity amount until you say where the money went; one marked
            unconfirmed is left out.
          </li>
          <li>
            Verified means a value recorded within its refresh window and confirmed, or a deposit
            worked out from its terms. Imported values you have not confirmed, values older than
            their window and holdings with no value make up the rest.
          </li>
          <li>
            Today is an estimate: what savings and deposits earned since yesterday at each rate,
            plus the move in fund prices over their last two prices. It is not read from a bank. The
            last {m.change.monthDays} days and the financial year are what the family’s holdings
            earned in that time: each holding is valued on the first day from the nearest record on
            or before it, moved forward at its rate (savings and deposits), by the fund’s price
            (funds) or the exchange rate, and the same on the last day; money you added or took out,
            a deposit made from savings, a fund bought or sold are not earnings. A period that
            begins before the first record begins where the data does (
            {m.dataStarts ? niceDate(m.dataStarts) : 'once something is recorded'}).
          </li>
          <li>
            Of the total, {formatInrCompact(m.trustDetail.byBasis.calculated)} is calculated from
            contracts or units, {formatInrCompact(m.trustDetail.byBasis.estimated)} is estimated
            (interest or price moved on from the last record) and{' '}
            {formatInrCompact(m.trustDetail.byBasis.carried_forward)} is carried forward from the
            last entry.
            {m.trustDetail.assumptions > 0
              ? ` ${plural(m.trustDetail.assumptions, 'account')} use an assumed savings rate until you set the real one.`
              : ''}
            {m.trustDetail.statements
              ? ` A fund statement is on file for ${m.trustDetail.statements.withStatement} of ${plural(m.trustDetail.statements.total, 'fund')}; the rest use the plan you entered, so their return is an estimate.`
              : ''}
          </li>
        </ul>
        {m.recent.length > 0 && (
          <>
            <h3 className="bv-h hm-how-h">Latest recorded values</h3>
            <ul className="hm-recent">
              {m.recent.map((o) => (
                <li key={o.id}>
                  <MaybeLink href={to(`/asset/${o.assetId}`)}>{o.name}</MaybeLink>
                  <span className="num small"> {formatInrCompact(o.amount)}</span>
                  <span className="small muted">
                    {' '}
                    <UpdatedCell asOf={o.asOf} source={sourceTag(o.source, o.asOf, false)} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="small muted">
          <MaybeLink href={to('/monthly')}>Update balances</MaybeLink>
        </p>
      </details>
    </section>
  );
}
