import Link from 'next/link';
import {
  formatInr,
  type FundView,
  type HarvestPlan,
  type PersonHarvest,
  type PersonLossHarvest,
  type PersonStyle,
} from '@fwos/core';
import { Meter } from '@/components/Meter';
import { PersonBadge } from '@/components/Person';

export const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const signed = (n: number) => `${n < 0 ? '−' : ''}${formatInr(Math.abs(Math.round(n)))}`;
const units = (n: number | null) =>
  n === null ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const STATUS: Record<FundView['status'], string> = {
  picked: 'In this plan',
  ready_not_needed: 'Ready, allowance used',
  waiting: 'Waiting',
  no_gain: 'No gain',
  no_lots: 'Needs history',
  excluded: 'Not harvestable',
};

/** Every unit of a fund that turns ready later, soonest first, for one person: the instalment calendar. */
function calendarRows(funds: FundView[]) {
  const rows = funds.flatMap((f) =>
    (f.ladder?.upcoming ?? []).map((t) => ({
      ...t,
      fund: f.fund,
      assetId: f.assetId,
      estimated: f.lotsEstimated,
    })),
  );
  rows.sort((a, b) => a.on.localeCompare(b.on) || a.fund.localeCompare(b.fund));
  let cum = 0;
  return rows.map((r) => ({ ...r, cumulative: (cum += r.gain) }));
}

export function HarvestCard({
  pp,
  person,
  today,
}: {
  pp: PersonHarvest;
  person: PersonStyle | undefined;
  today: string;
}) {
  const calendar = calendarRows(pp.funds).slice(0, 14);
  return (
    <section className="card personcard" style={{ ['--person' as string]: person?.colour }}>
      <header className="sectionhead" style={{ marginTop: 0 }}>
        <h2>
          <PersonBadge p={person} name size={26} />
        </h2>
        <div className="small muted">
          Allowance {formatInr(pp.exemption)} a year, lost on 31 March if unused
        </div>
      </header>
      <Meter
        total={pp.exemption}
        format={(n) => formatInr(Math.round(n))}
        parts={[
          { label: 'Already used this year', value: pp.alreadyUsed, colour: '#94a3b8' },
          { label: 'In this plan', value: pp.totalGain, colour: 'var(--primary, #4f46e5)' },
          { label: 'Still free', value: Math.max(0, pp.room - pp.totalGain), colour: '#d1d5db' },
        ]}
      />

      {pp.picks.length > 0 ? (
        <>
          <div className="sectionhead">
            <h3 style={{ margin: 0 }}>Do this</h3>
            <span className="small muted">
              Redeem by units, oldest units first (the fund house does this on its own)
            </span>
          </div>
          <div className="cardgrid">
            {pp.picks.map((x) => (
              <article className="pickcard" key={x.assetId}>
                <h3>
                  <Link href={`/asset/${x.assetId}`}>{x.fund}</Link>
                </h3>
                <div className="small muted">
                  {x.fullExit ? 'Sell everything, then buy it back' : 'Sell part, then buy it back'}
                </div>
                <dl>
                  <dt>Units to redeem</dt>
                  <dd>
                    <b>{x.fullExit ? 'All units' : units(x.units)}</b>
                  </dd>
                  <dt>Worth about</dt>
                  <dd>{formatInr(x.sellAmount)}</dd>
                  <dt>Tax-free gain booked</dt>
                  <dd className="gain">+{formatInr(x.estimatedGain)}</dd>
                  <dt>Buy back</dt>
                  <dd>{formatInr(x.buyBackAmount)}</dd>
                  <dt>Stamp duty and transaction tax</dt>
                  <dd>{formatInr(x.frictionCost)}</dd>
                </dl>
                <div className="chips2">
                  {x.lotsEstimated && (
                    <span
                      className="pill warn"
                      title="The purchase dates are worked out from the SIP plan, not read from a fund statement"
                    >
                      lots estimated
                    </span>
                  )}
                  <span className="pill">no exit load: units are past the window</span>
                </div>
              </article>
            ))}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            Tax avoided later on these gains, if you would otherwise have sold them: about{' '}
            {formatInr(pp.futureTaxMayBeAvoided)}.
            {pp.tdsWithheld > 0 &&
              ` As a non-resident the fund house will withhold about ${formatInr(pp.tdsWithheld)}; all of it comes back when you file, because these gains stay inside the allowance.`}
          </p>
        </>
      ) : (
        <p className="callout" style={{ marginTop: 12 }}>
          {pp.notes[0] ?? 'Nothing qualifies right now.'} See below for when more units turn ready.
        </p>
      )}

      <div className="sectionhead">
        <h3 style={{ margin: 0 }}>When more units become ready</h3>
        <span className="small muted">Each SIP instalment has its own one-year clock</span>
      </div>
      {calendar.length === 0 ? (
        <p className="muted small">
          No unit is waiting: everything held is either ready now or not eligible.
        </p>
      ) : (
        <div className="xlwrap">
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Ready from</th>
                <th>Fund</th>
                <th className="num">Instalments</th>
                <th className="num">Units</th>
                <th className="num">Gain then</th>
                <th className="num">Gain ready by then</th>
              </tr>
            </thead>
            <tbody>
              {calendar.map((r, i) => (
                <tr key={`${r.assetId}${r.on}${i}`}>
                  <td data-label="Ready from">
                    {niceDate(r.on)}
                    <div className="small muted">{r.daysAway} days</div>
                  </td>
                  <td data-label="Fund">
                    {r.fund}
                    {r.estimated && <span className="pill warn"> est.</span>}
                  </td>
                  <td className="num" data-label="Instalments">
                    {r.lots}
                  </td>
                  <td className="num" data-label="Units">
                    {units(r.units)}
                  </td>
                  <td className="num" data-label="Gain then">
                    {signed(r.gain)}
                  </td>
                  <td className="num" data-label="Gain ready by then">
                    {signed(r.cumulative)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <details className="disclose">
        <summary>Every fund, and why it is or is not in the plan</summary>
        <div className="xlwrap">
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Status</th>
                <th className="num">Ready now</th>
                <th className="num">Waiting</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {pp.funds.map((f) => (
                <tr key={f.assetId}>
                  <td data-label="Fund">
                    <Link href={`/asset/${f.assetId}`}>{f.fund}</Link>
                    <div className="small muted">
                      {f.className}
                      {f.classGuess ? ' (from the name)' : ''}
                      {f.ladder?.firstPurchase
                        ? ` · first bought ${niceDate(f.ladder.firstPurchase)}`
                        : ''}
                    </div>
                  </td>
                  <td data-label="Status">
                    <span className={`status ${f.status}`}>{STATUS[f.status]}</span>
                  </td>
                  <td className="num" data-label="Ready now">
                    {f.ladder && f.ladder.ready.lots > 0 ? (
                      <>
                        {units(f.ladder.ready.units)} units
                        <div className="small gain">
                          +{formatInr(Math.round(f.ladder.ready.gain))}
                        </div>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="num" data-label="Waiting">
                    {f.ladder && f.ladder.waiting.lots > 0 ? (
                      <>
                        {f.ladder.waiting.lots} lots
                        <div className="small muted">next {niceDate(f.ladder.upcoming[0]!.on)}</div>
                      </>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td className="small" data-label="Why">
                    {f.reason}
                    {f.lotsEstimated && (
                      <div className="muted">
                        Lots are estimated from the SIP plan; import the fund statement for exact
                        ones.
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className="small muted">Valid as of {niceDate(today)}. Nothing is sold for you.</p>
    </section>
  );
}

export function LossCard({
  pl,
  person,
}: {
  pl: PersonLossHarvest;
  person: PersonStyle | undefined;
}) {
  return (
    <section className="card personcard" style={{ ['--person' as string]: person?.colour }}>
      <header className="sectionhead" style={{ marginTop: 0 }}>
        <h2>
          <PersonBadge p={person} name size={26} />
        </h2>
        <div className="small muted">
          Gains booked this year: short-term {formatInr(pl.stcgYtd)} · long-term{' '}
          {formatInr(pl.ltcgYtd)}
        </div>
      </header>
      {pl.candidates.length === 0 ? (
        <p className="empty">
          No fund is in a net loss on its oldest units, so there is no loss to book.
        </p>
      ) : (
        <>
          <div className="cardgrid">
            {pl.candidates.map((c) => (
              <article className="pickcard" key={c.assetId}>
                <h3>
                  <Link href={`/asset/${c.assetId}`}>{c.fund}</Link>
                </h3>
                <div className="small muted">
                  Sells the oldest {c.lots} lot{c.lots === 1 ? '' : 's'}: {units(c.units)} units
                </div>
                <dl>
                  <dt>Proceeds</dt>
                  <dd>{formatInr(c.proceeds)}</dd>
                  <dt>Short-term loss</dt>
                  <dd className="fail">{c.shortLoss > 0 ? `−${formatInr(c.shortLoss)}` : '–'}</dd>
                  <dt>Long-term loss</dt>
                  <dd className="fail">{c.longLoss > 0 ? `−${formatInr(c.longLoss)}` : '–'}</dd>
                  <dt>Exit load on recent units</dt>
                  <dd>{c.exitLoad > 0 ? formatInr(c.exitLoad) : 'none'}</dd>
                </dl>
                {c.lotsEstimated && (
                  <div className="chips2">
                    <span className="pill warn">lots estimated</span>
                  </div>
                )}
              </article>
            ))}
          </div>
          <div className="callout" style={{ marginTop: 12 }}>
            <b>
              Saves about {formatInr(pl.taxSavedNow)} this year
              {pl.carryForward > 0
                ? `; ${formatInr(pl.carryForward)} would be carried forward`
                : ''}
              .
            </b>
            <div className="small">
              Losses are set off before the tax-free allowance. A short-term loss meets short-term
              gains first, then long-term gains; a long-term loss meets long-term gains only.
            </div>
          </div>
          {pl.notes.map((n) => (
            <p key={n} className="small muted">
              {n}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

/** What to check at the redemption screen, with this year's dates filled in. */
export function Checklist({ plan, today }: { plan: HarvestPlan; today: string }) {
  const deadline = new Date(`${plan.deadline}T00:00:00Z`);
  // keep clear of the last working days: orders after the cut-off count on the next day, and a holiday can push it past 31 March
  const safe = new Date(deadline.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  return (
    <section className="card">
      <h2>Before you press sell</h2>
      <ol className="stepper">
        <li>
          <b>Redeem by units, not by amount.</b> The plan shows the units. The fund house sells your
          oldest units first, which are the long-term ones, so the gain is what is planned.
        </li>
        <li>
          <b>Place the order well before {niceDate(safe)}.</b> The last day is{' '}
          {niceDate(plan.deadline)}, but an order after the 3 pm cut-off, or on a holiday, is priced
          on the next working day and may fall into the next financial year ({niceDate(today)} is
          today).
        </li>
        <li>
          <b>Buy first, then sell, to stay invested.</b> Buying the same fund first adds new units
          at the end of the queue, so the sale still uses the old units. If you sell first, buy back
          the same day; the proceeds arrive in a day or two, so use other money for the purchase.
        </li>
        <li>
          <b>The new units start fresh clocks.</b> Their one-year clock for long-term gain and their
          exit-load window start on the day they are bought. Do not plan to sell them within a year.
        </li>
        <li>
          <b>Equity-oriented funds only.</b> International, gold, debt and unclear hybrid funds are
          left out because the allowance does not apply to them. ELSS units are locked for 3 years,
          and buying back starts a new lock-in.
        </li>
        <li>
          <b>Keep the contract notes.</b> They show the units sold, the price and any tax withheld.
          You will need them for the refund and for schedule 112A in your return.
        </li>
        <li>
          <b>Count other gains.</b> The allowance covers all listed shares and equity funds
          together. The plan only sees your mutual funds, so reduce the amount if you booked gains
          on shares or ETFs this year.
        </li>
      </ol>
    </section>
  );
}
