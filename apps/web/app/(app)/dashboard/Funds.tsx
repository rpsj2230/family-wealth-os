import { formatInr, formatInrCompact, formatPct, type PersonStyle } from '@fwos/core';
import { plural, whole } from '@/app/(app)/accounts/BankOverview';
import { Sparkline } from '@/components/charts';
import { Est } from '@/components/Est';
import { PersonBadge } from '@/components/Person';
import type { HomeModel } from '@/lib/home';
import { CardHead, MaybeLink, Signed, homeLink, pct, rupees, tone } from './parts';

const SPARK_WIDTH = 220;

/** The mutual funds in one place: value, gain, annual return, today's move, best and weakest, and each person's share. */
export function Funds({
  m,
  styles,
  sample,
}: {
  m: HomeModel;
  styles: Record<string, PersonStyle>;
  sample: boolean;
}) {
  const f = m.funds;
  return (
    <section className="card hm-card hm-span2" aria-labelledby="hm-funds">
      <CardHead
        title="Mutual funds"
        id="hm-funds"
        href={homeLink('/investments', sample)}
        linkLabel="All funds"
      />
      {!f ? (
        <p className="muted small">No mutual fund is recorded yet.</p>
      ) : (
        <>
          <div className="hm-funds-top">
            <div>
              <div className="hm-figure" data-testid="hm-funds-total">
                {formatInrCompact(f.totals.value)}
              </div>
              <div className="bv-exact">{whole(f.totals.value)}</div>
              <p className="muted small">
                put in {formatInrCompact(f.totals.invested)} · {plural(f.totals.funds, 'fund')}
                {f.totals.sipMonthly > 0
                  ? ` · SIPs ${formatInr(Math.round(f.totals.sipMonthly))} a month`
                  : ''}
              </p>
            </div>
            <div className="hm-funds-chips">
              <Signed label="Total gain" amount={f.totals.gain} />
              <span className={`hm-xirr ${tone(f.totals.xirr)}`}>
                {f.totals.xirr === null
                  ? 'Annual return not available'
                  : `${pct(f.totals.xirr, 1)} a year (XIRR)${f.totals.xirrEstimated ? ', estimated' : ''}`}
              </span>
              {f.totals.dayPct === null ? (
                <span className="muted small">no price move yet today</span>
              ) : (
                <Signed label="Today" amount={f.totals.dayAmount} pct={f.totals.dayPct} />
              )}
            </div>
            {f.sparkline.length > 1 && (
              <div className="hm-spark">
                <Sparkline
                  points={f.sparkline}
                  label="Value of all mutual funds"
                  width={SPARK_WIDTH}
                  height={46}
                />
                <span className="muted small">value, month by month</span>
              </div>
            )}
          </div>

          {f.bestWorst && (
            <ul className="hm-bw">
              <li>
                <span className="hm-tag ok">Best</span>
                <span className="hm-mname">{f.bestWorst.best.name}</span>
                <strong className="gain">
                  {pct(f.bestWorst.best.xirr as number, 1)}
                  {f.bestWorst.best.estimated && <Est />}
                </strong>
              </li>
              <li>
                <span className="hm-tag bad">Weakest</span>
                <span className="hm-mname">{f.bestWorst.weakest.name}</span>
                <strong className={tone(f.bestWorst.weakest.xirr)}>
                  {pct(f.bestWorst.weakest.xirr as number, 1)}
                  {f.bestWorst.weakest.estimated && <Est />}
                </strong>
              </li>
            </ul>
          )}

          {f.people.length > 0 && (
            <table className="tbl lines responsive hm-people">
              <thead>
                <tr>
                  <th>Person</th>
                  <th className="num">Value</th>
                  <th className="num">Today</th>
                  <th className="num">Total gain</th>
                  <th className="num">XIRR</th>
                </tr>
              </thead>
              <tbody>
                {f.people.map((g) => (
                  <tr key={g.ownerId}>
                    <td data-label="Person">
                      <PersonBadge p={styles[g.ownerId]} name size={18} />
                    </td>
                    <td className="num" data-label="Value">
                      {formatInr(Math.round(g.totals.value))}
                    </td>
                    <td
                      className={`num ${tone(g.totals.dayPct === null ? null : g.totals.dayAmount)}`}
                      data-label="Today"
                    >
                      {g.totals.dayPct === null ? '–' : rupees(g.totals.dayAmount)}
                    </td>
                    <td className={`num ${tone(g.totals.gain)}`} data-label="Total gain">
                      {rupees(g.totals.gain)}
                    </td>
                    <td className={`num ${tone(g.totals.xirr)}`} data-label="XIRR">
                      {g.totals.xirr === null ? '–' : pct(g.totals.xirr, 1)}
                      {g.totals.xirr !== null && g.totals.xirrEstimated ? ' ~' : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {f.pace && (
            <p className="muted small">
              At today&apos;s SIPs and {formatPct(f.pace.rate, 1)} a year
              {f.pace.assumed ? ' (assumed)' : ''}:{' '}
              {f.pace.projections
                .map((x) => `${formatInrCompact(x.expected)} in ${x.years}y`)
                .join(' · ')}
              . An illustration, not a forecast.
            </p>
          )}
          <p className="muted small">
            A fund statement is on file for {f.statements.withStatement} of{' '}
            {plural(f.statements.total, 'fund')}; ~ marks a return worked out from the plan you
            entered.{' '}
            <MaybeLink href={homeLink('/investments?tab=update', sample)}>Update funds</MaybeLink>
          </p>
        </>
      )}
    </section>
  );
}
