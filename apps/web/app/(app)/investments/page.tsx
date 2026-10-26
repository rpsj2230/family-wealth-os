import Link from 'next/link';
import { formatInr, personStyles } from '@fwos/core';
import { Sparkline } from '@/components/charts';
import { FundChart } from '@/components/FundChart';
import { UpdatedCell } from '@/components/BankTable';
import { GoalTag } from '@/components/GoalTag';
import { ListingTools } from '@/components/ListingTools';
import { PersonBadge, PersonFilter } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { InvestHeadline, pct, rupees, tone } from '@/components/InvestHeadline';
import { fundPace, loadInvestmentView } from '@/lib/investments';
import { loadPortfolio } from '@/lib/portfolio-data';

export const dynamic = 'force-dynamic';

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const loaded = await loadPortfolio(supabase);
  const styles = personStyles([...loaded.ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = p && styles[p] ? p : null;
  const view = await loadInvestmentView(supabase, loaded, who);
  const goalName = new Map(view.goals.map((g) => [g.id, g.name]));
  const totals = Object.fromEntries(
    view.groups.map((g) => [g.ownerId, formatInr(Math.round(g.totals.value))]),
  );

  const h = view.household;
  const { rate, projections: proj, path } = fundPace(view);

  return (
    <>
      <div className="pagehead">
        <h1>Investments</h1>
        <Link className="btn" href="/investments/update">
          Update funds
        </Link>
      </div>
      <p className="muted">
        Mutual funds by person (PAN holder). &ldquo;Today&rdquo; is the move between the last two
        fund prices; the total gain is shown with its annual return (XIRR). Tag each fund with the
        goal it counts towards.
      </p>
      <PersonFilter
        people={Object.values(styles)}
        basePath="/investments"
        current={who}
        totals={totals}
      />

      <section className="card hero invsummary" aria-label="All funds">
        <p className="muted small">{who ? styles[who]?.name : 'Whole household'}, mutual funds</p>
        <InvestHeadline t={view.household} big />
        <FundChart
          history={view.series}
          today={view.today}
          caption="Value of all mutual funds against the money put in"
          projection={path}
        />
        <div className="pace" aria-label="If this pace holds">
          <p className="muted small">
            If you carry on like this: {formatInr(Math.round(h.sipMonthly))} a month in SIPs and{' '}
            {(rate * 100).toFixed(1)}% a year
            {h.xirr === null ? ' (assumed)' : ' (your return so far)'}. A range of ±3 points is
            shown; this is arithmetic, not a promise.
          </p>
          <div className="pacegrid">
            {proj.map((x) => (
              <div key={x.years} className="pacecell">
                <div className="muted small">
                  In {x.years} year{x.years === 1 ? '' : 's'}
                </div>
                <b className="num">{formatInr(x.expected)}</b>
                <div className="muted small">
                  {formatInr(x.low)} – {formatInr(x.high)}
                </div>
              </div>
            ))}
          </div>
        </div>
        {view.household.xirrEstimated && (
          <p className="muted small">
            XIRR marked (est.) uses each fund&apos;s start date and SIP until its fund statement is
            imported (Import page).
          </p>
        )}
      </section>

      <ListingTools name="investments">
        {view.groups.map((g) => (
          <section
            className="card bank"
            key={g.ownerId}
            style={{ ['--person' as string]: styles[g.ownerId]?.colour }}
          >
            <header className="bankhead personhead">
              <div>
                <h2>
                  <PersonBadge p={styles[g.ownerId]} name size={26} />{' '}
                  <span className="panlabel">
                    PAN
                    {g.panLast4 ? <span className="muted"> ••••{g.panLast4}</span> : ' not saved'}
                  </span>
                </h2>
                <div className="muted small">
                  {g.totals.funds} fund{g.totals.funds === 1 ? '' : 's'}
                </div>
              </div>
              <InvestHeadline t={g.totals} />
            </header>
            <table className="tbl lines responsive funds">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th>Goal</th>
                  <th className="num">Units</th>
                  <th className="num">Price (NAV)</th>
                  <th className="num">Invested</th>
                  <th className="num">Value today</th>
                  <th className="num">Today</th>
                  <th className="num">Gain</th>
                  <th className="num">XIRR</th>
                  <th>Trend</th>
                  <th className="num">SIP</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {g.funds.map((f) => (
                  <tr key={f.assetId}>
                    <td data-label="Fund">
                      <Link href={`/asset/${f.assetId}`} className="fundlink">
                        {f.name}
                      </Link>
                      <div className="small muted">
                        {f.startedOn ? `since ${f.startedOn.slice(0, 7)}` : ''}
                        {f.dayTo ? ` · price of ${f.dayTo}` : ' · no live price yet'}
                      </div>
                    </td>
                    <td data-label="Goal">
                      <GoalTag
                        assetId={f.assetId}
                        goals={view.goals}
                        current={f.goalIds}
                        fundName={f.name}
                      />
                      {f.goalIds.length === 1 && (
                        <span className="sr-only">{goalName.get(f.goalIds[0]!)}</span>
                      )}
                    </td>
                    <td className="num" data-label="Units">
                      {f.units === null
                        ? '–'
                        : f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                    </td>
                    <td className="num" data-label="Price (NAV)">
                      {f.nav === null
                        ? '–'
                        : f.nav.toLocaleString('en-IN', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 4,
                          })}
                      {f.navDate && <div className="small muted">{f.navDate.slice(5)}</div>}
                    </td>
                    <td className="num" data-label="Invested">
                      {f.invested ? formatInr(Math.round(f.invested)) : '–'}
                    </td>
                    <td className="num amount" data-label="Value today">
                      {f.value ? formatInr(Math.round(f.value)) : '–'}
                    </td>
                    <td className={`num ${tone(f.dayAmount)}`} data-label="Today">
                      {f.dayAmount === null ? '–' : rupees(f.dayAmount)}
                      {f.dayPct !== null && <div className="small">{pct(f.dayPct)}</div>}
                    </td>
                    <td className={`num ${f.invested ? tone(f.gain) : ''}`} data-label="Gain">
                      {f.invested ? rupees(f.gain) : '–'}
                    </td>
                    <td className={`num ${tone(f.xirr)}`} data-label="XIRR">
                      {f.xirr === null ? '–' : pct(f.xirr, 1)}
                      {f.xirr !== null && f.xirrEstimated && (
                        <span
                          className="muted"
                          title="Estimated from the start date and SIP; exact once the fund statement is imported"
                        >
                          {' '}
                          ~
                        </span>
                      )}
                    </td>
                    <td data-label="Trend">
                      <Sparkline points={f.history.map((x) => x.value)} label={`${f.name} value`} />
                    </td>
                    <td className="num" data-label="SIP">
                      {f.sipMonthly ? (
                        f.sipStopped ? (
                          <span className="muted">stopped</span>
                        ) : (
                          formatInr(f.sipMonthly)
                        )
                      ) : (
                        '–'
                      )}
                    </td>
                    <td className="upd" data-label="Updated">
                      <UpdatedCell asOf={f.updatedOn} source={f.updatedSource} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </ListingTools>
    </>
  );
}
