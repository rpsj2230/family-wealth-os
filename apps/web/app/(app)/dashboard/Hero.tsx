import { formatInrCompact, formatPct, sourceTag, type ExplainSet } from '@fwos/core';
import { SplitBar, Stat, plural } from '@/app/(app)/accounts/BankOverview';
import { UpdatedCell } from '@/components/BankTable';
import { WhyHead } from '@/components/Why';
import type { HomeModel } from '@/lib/home';
import { niceDate } from '@/lib/dates';
import { MaybeLink, homeLink } from './parts';

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
 * Under the headline of Home: how much of the net worth is verified, the goals and what needs a person, and how the figures are worked
 * out. Every figure comes from buildHome(); this only draws it.
 */
export function Hero({ m, sample, ex }: { m: HomeModel; sample: boolean; ex: ExplainSet<'home'> }) {
  const to = (path: string) => homeLink(path, sample);
  const t = m.trust;
  const share = (n: number) => (t.total > 0 ? n / t.total : 0);
  const bad = m.attention.filter((a) => a.tone === 'bad').length;
  const goals = to('/goals');

  return (
    <section className="card hm-hero" aria-label="How much is verified">
      <FundNote m={m} sample={sample} />

      <div className="hm-trust">
        <div>
          <WhyHead why={ex['home.verified']}>
            <h2 className="bv-h">How much is verified</h2>
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

      <dl className="bv-grid" aria-label="Goals and what needs you">
        <Stat
          label="Goals on track"
          value={
            <>
              {m.goals.onTrack}
              <span className="muted"> / {m.goals.withTarget}</span>
            </>
          }
          sub={m.goals.list.length === 0 ? 'no goal yet' : 'see each goal'}
          {...(goals ? { href: goals } : {})}
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
      </dl>

      <details className="bv-how">
        <summary>How these figures are worked out</summary>
        <ul className="list small muted">
          <li>
            Net worth adds every holding that is wealth (banks, deposits, funds, shares, money lent,
            pension accounts) at its latest recorded value moved forward to today. Property is shown
            on its own page but not counted, unless Settings counts it: deposits from their own
            terms, savings at their rate, funds with the latest price. Insurance cover is never
            counted. A deposit past its date that is still listed as running is counted at its
            maturity amount until you say where the money went; one marked unconfirmed is left out.
          </li>
          <li>
            Verified means a value recorded within its refresh window and confirmed, or a deposit
            worked out from its terms. Imported values you have not confirmed, values older than
            their window and holdings with no value make up the rest.
          </li>
          <li>
            Today is an estimate: what savings and deposits earned since yesterday at each rate,
            plus the move in fund prices over their last two prices. It is not read from a bank.
            Earned this FY is what the family’s holdings earned since 1 April: each holding is
            valued on the first day from the nearest record on or before it, moved forward at its
            rate (savings and deposits), by the fund’s price (funds) or the exchange rate, and the
            same on the last day; money you added or took out, a deposit made from savings, a fund
            bought or sold are not earnings. A period that begins before the first record begins
            where the data does (
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
