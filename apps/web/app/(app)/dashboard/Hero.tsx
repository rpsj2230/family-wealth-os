import {
  formatInr,
  formatInrCompact,
  LADDER_DAYS,
  formatPct,
  sourceTag,
  type Change,
} from '@fwos/core';
import { Delta, SplitBar, Stat, plural, whole } from '@/app/(app)/accounts/BankOverview';
import { UpdatedCell } from '@/components/BankTable';
import type { HomeModel } from '@/lib/home';
import { niceDate } from '@/lib/dates';
import { Money } from './Money';
import { MaybeLink, homeLink } from './parts';

const monthsText = (months: number) =>
  months >= 24 ? `${(months / 12).toFixed(1)} years` : plural(Math.round(months), 'month');

/** A change over a period, or a plain note when the saved history is too short to measure it. */
function PeriodDelta({
  label,
  change,
  note,
  missing,
}: {
  label: string;
  change: Change | null;
  note: (c: Change) => string;
  missing: string;
}) {
  if (!change)
    return (
      <div className="bv-delta flat">
        <div className="bv-delta-label">{label}</div>
        <div className="bv-delta-value">
          <strong>–</strong>
        </div>
        <div className="bv-delta-note">{missing}</div>
      </div>
    );
  return <Delta label={label} amount={change.amount} pct={change.pct} note={note(change)} />;
}

/**
 * The top of Home: what the family is worth, how it changed today, this month and this financial year, how much of that is
 * verified, and the few figures that say what to look at next. Every figure comes from buildHome(); this only draws it.
 */
export function Hero({ m, sample }: { m: HomeModel; sample: boolean }) {
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
          <h2 className="bv-eyebrow">Net worth today</h2>
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
            note="interest at each rate and fund prices, since yesterday"
            estimate
          />
          <PeriodDelta
            label={`Last ${plural(m.change.monthDays, 'day')}`}
            change={m.change.month}
            note={(c) =>
              c.partial
                ? `since your first record, ${niceDate(c.from)}`
                : `since ${niceDate(c.from)}`
            }
            missing="shows once two days of history are saved"
          />
          <PeriodDelta
            label="This financial year"
            change={m.change.fy}
            note={(c) =>
              c.partial
                ? `since your first record, ${niceDate(c.from)}`
                : `since the close of last year, ${niceDate(c.from)}`
            }
            missing="shows once two days of history are saved"
          />
        </div>
      </div>

      <Money m={m} />

      <div className="hm-trust">
        <div>
          <h3 className="bv-h">How much is verified</h3>
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
        />
        <Stat
          label={`Free within ${plural(LADDER_DAYS.d30, 'day')}`}
          value={formatInrCompact(liquid.within30)}
          sub="cash plus deposits that mature, nothing sold"
          {...link('/raise')}
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
        />
        <Stat
          label={`Interest in ${m.deposits.interest.fy}`}
          value={formatInrCompact(m.deposits.interest.thisYear)}
          sub={`on running deposits · ${formatInrCompact(m.deposits.interest.ahead)} more over the next 12 months if held`}
          {...link('/deposits')}
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
            last {m.change.monthDays} days and the financial year compare today with the net worth
            saved each day, so money you added or took out is part of them; with less history they
            start from the first record.
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
