import Link from 'next/link';
import { formatInr, personStyles } from '@fwos/core';
import { ContributionChart } from '@/components/ContributionChart';
import { GoalTag } from '@/components/GoalTag';
import { ListingTools } from '@/components/ListingTools';
import { PersonBadge, PersonFilter } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { InvestHeadline, pct, rupees, tone } from '@/components/InvestHeadline';
import { loadInvestmentView } from '@/lib/investments';
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

  return (
    <>
      <h1>Investments</h1>
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
        <ContributionChart points={view.series} />
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
                  <th className="num">Invested</th>
                  <th className="num">Value today</th>
                  <th className="num">Today</th>
                  <th className="num">Gain</th>
                  <th className="num">XIRR</th>
                  <th className="num">SIP</th>
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
