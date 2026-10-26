import Link from 'next/link';
import {
  CATEGORY_ORDER,
  clipSeries,
  foldShares,
  formatInr,
  formatInrCompact,
  type PersonStyle,
  type ShareRow,
  type StatBlock,
} from '@fwos/core';
import { BarList, Donut } from '@/components/charts';
import {
  BasisChip,
  GainBars,
  MonthColumns,
  RangeSwitch,
  StackBar,
  StatList,
  type Stat,
} from '@/components/FundViz';
import { pct, rupees } from '@/components/InvestHeadline';
import { PersonBadge } from '@/components/Person';
import { PlotChart, type PlotMarker, type PlotSeries } from '@/components/PlotChart';
import { niceDate } from '@/lib/dates';
import type { Growth } from '@/lib/growth-view';
import type { fundPace, InvestmentView } from '@/lib/investments';
import { colourOf, slotColours } from '@/lib/viz';

const tone = (n: number | null): 'gain' | 'fail' | null =>
  n === null ? null : n >= 0 ? 'gain' : 'fail';
const share = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

const monthsText = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [
    y ? `${y} year${y === 1 ? '' : 's'}` : '',
    m || !y ? `${m} month${m === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/* ---------------------------------------------------------------------------------------- breakdown */

function ByPerson({
  view,
  stats,
  styles,
}: {
  view: InvestmentView;
  stats: Record<string, StatBlock>;
  styles: Record<string, PersonStyle>;
}) {
  const total = view.household.value;
  return (
    <section className="card wide" aria-labelledby="bp">
      <div className="cardhead">
        <h2 id="bp">By person</h2>
        <span className="small muted">Each PAN holder on one line</span>
      </div>
      <div className="cmpwrap">
        <table className="tbl lines cmp">
          <thead>
            <tr>
              <th>Person</th>
              <th className="num">Funds</th>
              <th className="num">Invested</th>
              <th className="num">Value</th>
              <th className="num">Gain</th>
              <th className="num">XIRR</th>
              <th className="num">Share</th>
              <th className="num">SIP a month</th>
              <th className="num">Long-term</th>
              <th className="num">Top {view.config.concentrationTop}</th>
            </tr>
          </thead>
          <tbody>
            {view.groups.map((g) => {
              const s = stats[g.ownerId];
              if (!s) return null;
              return (
                <tr key={g.ownerId}>
                  <td data-label="Person">
                    <span className="personline">
                      <PersonBadge p={styles[g.ownerId]} name size={20} />
                    </span>
                  </td>
                  <td className="num" data-label="Funds">
                    {s.funds}
                  </td>
                  <td className="num" data-label="Invested">
                    {formatInr(Math.round(s.invested))}
                  </td>
                  <td className="num" data-label="Value">
                    {formatInr(Math.round(s.value))}
                  </td>
                  <td className={`num ${tone(s.unrealised)}`} data-label="Gain">
                    {rupees(s.unrealised)}
                    {s.unrealisedPct !== null && (
                      <div className="small">{pct(s.unrealisedPct, 1)}</div>
                    )}
                  </td>
                  <td className={`num ${tone(g.totals.xirr)}`} data-label="XIRR">
                    {g.totals.xirr === null ? '–' : pct(g.totals.xirr, 1)}
                    {g.totals.xirr !== null && g.totals.xirrEstimated && (
                      <span className="muted" title="Partly estimated from start dates">
                        {' '}
                        ~
                      </span>
                    )}
                  </td>
                  <td className="num" data-label="Share">
                    {total > 0 ? share(s.value / total) : '–'}
                  </td>
                  <td className="num" data-label="SIP a month">
                    {s.sip.monthly ? formatInr(Math.round(s.sip.monthly)) : '–'}
                  </td>
                  <td className="num" data-label="Long-term">
                    {s.holding.longShare === null ? '–' : share(s.holding.longShare)}
                  </td>
                  <td className="num" data-label={`Top ${view.config.concentrationTop}`}>
                    {s.concentration.top.length > 0 ? share(s.concentration.topShare) : '–'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Allocation({ view, stats }: { view: InvestmentView; stats: StatBlock }) {
  const cfg = view.config;
  const catColour = slotColours(CATEGORY_ORDER.filter((k) => view.palette.categories.includes(k)));
  const amcColour = slotColours(view.palette.amcs);
  const fundColour = slotColours(view.palette.funds);
  const cat = foldShares(stats.byCategory, cfg.maxSlices);
  const amc = foldShares(stats.byAmc, cfg.maxSlices);
  const funds = foldShares(stats.byFund, cfg.maxSlices);
  const parts = (rows: ShareRow[], plan: Map<string, string>, withGain = false) =>
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      colour: colourOf(plan, r.key === '__none' ? '__none' : r.key),
      ...(withGain && r.gainPct !== null ? { note: pct(r.gainPct, 1) } : {}),
    }));
  const c = stats.concentration;
  return (
    <div className="insightgrid">
      <section className="card" aria-labelledby="al1">
        <div className="cardhead">
          <h2 id="al1">By kind of fund</h2>
          <span className="small muted">Large, mid, small, hybrid, debt…</span>
        </div>
        {cat.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <Donut
            caption="Mutual fund value by kind of fund"
            size={150}
            slices={parts(cat, catColour)}
            centre={{ top: formatInrCompact(stats.value), bottom: 'value' }}
          />
        )}
        {stats.byCategory.some((r) => r.key === 'unknown') && (
          <p className="cardnote">
            “Kind not known” means the fund is not matched to the official list and its name does
            not say. <Link href="/investments?tab=match">Match it</Link>.
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="al2">
        <div className="cardhead">
          <h2 id="al2">By fund house</h2>
          <span className="small muted">Share of value</span>
        </div>
        {amc.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <StackBar caption="Mutual fund value by fund house" parts={parts(amc, amcColour)} />
        )}
        {stats.byAmc.some((r) => r.key === '__none') && (
          <p className="cardnote">
            The fund house comes from the official scheme list, so it appears once a fund is
            matched.
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="al3">
        <div className="cardhead">
          <h2 id="al3">By fund</h2>
          <span className="small muted">
            Top {cfg.concentrationTop} = {share(c.topShare)}
          </span>
        </div>
        {funds.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <StackBar caption="Mutual fund value by fund" parts={parts(funds, fundColour)} />
        )}
        {c.effectiveFunds !== null && stats.funds > 1 && (
          <p className="cardnote">
            Spread like {c.effectiveFunds.toFixed(1)} equal-sized funds, though you hold{' '}
            {stats.funds}.
          </p>
        )}
      </section>
    </div>
  );
}

export function BreakdownTab({
  view,
  stats,
  byOwner,
  who,
  styles,
}: {
  view: InvestmentView;
  stats: StatBlock;
  byOwner: Record<string, StatBlock>;
  who: string | null;
  styles: Record<string, PersonStyle>;
}) {
  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>.
      </p>
    );
  const h = view.household;
  const months = view.holdingMonths;
  const hold = stats.holding;
  const sip = stats.sip;
  const real = stats.realised;

  const headline: Stat[] = [
    {
      label: 'Money put in',
      value: formatInr(Math.round(stats.invested)),
      note: 'cost of the units held',
    },
    { label: 'Value now', value: formatInr(Math.round(stats.value)) },
    {
      label: 'Gain on units held',
      value: rupees(stats.unrealised),
      note:
        stats.unrealisedPct === null ? undefined : `${pct(stats.unrealisedPct, 1)} on money put in`,
      tone: tone(stats.unrealised),
    },
    {
      label: 'Return a year (XIRR)',
      value: (
        <>
          {h.xirr === null ? '–' : pct(h.xirr, 1)}
          {h.xirr !== null && (
            <BasisChip
              real={!h.xirrEstimated}
              text={h.xirrEstimated ? 'partly estimated' : 'statement'}
            />
          )}
        </>
      ),
      note:
        stats.estimated > 0
          ? `${stats.estimated} of ${stats.funds} funds have no fund statement`
          : 'every fund has a fund statement',
      tone: tone(h.xirr),
    },
    stats.best
      ? {
          label: 'Best fund',
          value: pct(stats.best.pct, 1),
          note: <Link href={`/asset/${stats.best.assetId}`}>{stats.best.name}</Link>,
          tone: tone(stats.best.pct),
        }
      : { label: 'Best fund', value: '–', note: 'needs two funds with a cost' },
    stats.worst
      ? {
          label: 'Weakest fund',
          value: pct(stats.worst.pct, 1),
          note: <Link href={`/asset/${stats.worst.assetId}`}>{stats.worst.name}</Link>,
          tone: tone(stats.worst.pct),
        }
      : { label: 'Weakest fund', value: '–', note: 'needs two funds with a cost' },
    stats.bestDay
      ? {
          label: 'Best today',
          value: pct(stats.bestDay.pct, 2),
          note: <Link href={`/asset/${stats.bestDay.assetId}`}>{stats.bestDay.name}</Link>,
          tone: tone(stats.bestDay.pct),
        }
      : { label: 'Best today', value: '–', note: 'needs two live prices' },
    stats.worstDay
      ? {
          label: 'Weakest today',
          value: pct(stats.worstDay.pct, 2),
          note: <Link href={`/asset/${stats.worstDay.assetId}`}>{stats.worstDay.name}</Link>,
          tone: tone(stats.worstDay.pct),
        }
      : { label: 'Weakest today', value: '–', note: 'needs two live prices' },
    {
      label: 'Funds and folios',
      value: `${stats.funds} · ${stats.folios}`,
      note:
        stats.folios === 0 ? 'folio numbers come from a fund statement' : 'last four digits only',
    },
  ];

  return (
    <>
      <p className="lead muted">
        {who ? `${styles[who]?.name}'s funds` : 'All funds'}: where the money is, what has made or
        lost it, how much is already long-term, the monthly investments and the gains already
        booked.
      </p>
      {!who && view.groups.length > 1 && <ByPerson view={view} stats={byOwner} styles={styles} />}

      <section className="card wide" aria-labelledby="kf">
        <div className="cardhead">
          <h2 id="kf">Key figures</h2>
          <span className="small muted">As of {niceDate(view.today)}</span>
        </div>
        <StatList items={headline} label="Key figures for the mutual funds shown" />
      </section>

      <Allocation view={view} stats={stats} />

      <section className="card wide" aria-labelledby="gb">
        <div className="cardhead">
          <h2 id="gb">Gain or loss by fund</h2>
          <span className="small muted">Value less money put in, on the units still held</span>
        </div>
        {stats.gainBars.length === 0 ? (
          <p className="empty">No fund has both a cost and a value yet.</p>
        ) : (
          <GainBars
            caption="Gain or loss on each fund"
            rows={stats.gainBars.map((g) => ({
              key: g.assetId,
              label: <Link href={`/asset/${g.assetId}`}>{g.label}</Link>,
              gain: g.gain,
              pctValue: g.gainPct,
            }))}
          />
        )}
      </section>

      <div className="insightgrid">
        <section className="card" aria-labelledby="hp">
          <div className="cardhead">
            <h2 id="hp">How much is long-term already</h2>
            {months !== null && (
              <span className="small muted">Equity funds, over {months} months</span>
            )}
          </div>
          {months === null ? (
            <p className="empty">No long-term period is set in the tax rules in Settings.</p>
          ) : hold.longShare === null ? (
            <p className="empty">
              The purchase dates are needed for this. Import a fund statement on the{' '}
              <Link href="/import">Import page</Link>, or match the fund to its official price so
              the SIPs can be estimated.
            </p>
          ) : (
            <>
              <StackBar
                caption="Equity fund value held past and within the long-term period"
                parts={[
                  {
                    key: 'long',
                    label: `Held over ${months} months`,
                    value: hold.longValue,
                    colour: 'var(--viz-1)',
                  },
                  {
                    key: 'short',
                    label: 'Held for less',
                    value: hold.shortValue,
                    colour: 'var(--viz-2)',
                  },
                  {
                    key: 'unknown',
                    label: 'Purchases not known',
                    value: hold.unknownValue,
                    colour: 'var(--viz-other)',
                  },
                ]}
              />
              <p className="cardnote">
                Gain on the older units {rupees(hold.longGain)}, on the newer units{' '}
                {rupees(hold.shortGain)}.
                {hold.nextTurn && (
                  <>
                    {' '}
                    {formatInr(Math.round(hold.nextTurn.value))} of {hold.nextTurn.fund} passes{' '}
                    {months} months on {niceDate(hold.nextTurn.on)}.
                  </>
                )}
              </p>
              <p className="cardnote">
                {hold.fundsByBasis.statement > 0 && (
                  <>
                    <BasisChip real text="statement" /> {hold.fundsByBasis.statement} fund
                    {hold.fundsByBasis.statement === 1 ? '' : 's'} from purchases on a fund
                    statement.{' '}
                  </>
                )}
                {hold.fundsByBasis.estimated > 0 && (
                  <>
                    <BasisChip real={false} /> {hold.fundsByBasis.estimated} fund
                    {hold.fundsByBasis.estimated === 1 ? '' : 's'} rebuilt from the SIP plan and
                    published prices.{' '}
                  </>
                )}
                {hold.otherValue > 0 &&
                  `${formatInrCompact(hold.otherValue)} is in debt, gold, international or hybrid funds, which follow a different rule and are not counted here.`}
              </p>
              {hold.byFund.length > 1 && (
                <details className="disclose">
                  <summary>By fund</summary>
                  <GainBars
                    caption="Long-term value by fund"
                    rows={hold.byFund.map((f) => ({
                      key: f.assetId,
                      label: <Link href={`/asset/${f.assetId}`}>{f.name}</Link>,
                      gain: f.longValue,
                      pctValue:
                        f.longValue + f.shortValue > 0
                          ? f.longValue / (f.longValue + f.shortValue)
                          : null,
                    }))}
                  />
                  <p className="cardnote">
                    Bars show the long-term value; the percentage is the long-term share of that
                    fund.
                  </p>
                </details>
              )}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="sp">
          <div className="cardhead">
            <h2 id="sp">Monthly investments (SIP)</h2>
            <span className="small muted">
              {sip.running} running{sip.stopped ? `, ${sip.stopped} stopped` : ''}
            </span>
          </div>
          {sip.running + sip.stopped === 0 ? (
            <p className="empty">No fund has a monthly investment recorded.</p>
          ) : (
            <StatList
              label="Monthly investment figures"
              items={[
                {
                  label: 'Going in each month',
                  value: formatInr(Math.round(sip.monthly)),
                  note: `${sip.running} fund${sip.running === 1 ? '' : 's'}`,
                },
                {
                  label: 'Paid so far',
                  value: sip.totalPaid === null ? '–' : formatInr(sip.totalPaid),
                  note:
                    sip.totalPaid === null
                      ? 'needs a fund statement'
                      : `from fund statements of ${sip.paidFunds} fund${sip.paidFunds === 1 ? '' : 's'}`,
                },
                {
                  label: 'Longest running',
                  value: sip.longestMonths === null ? '–' : monthsText(sip.longestMonths),
                },
                {
                  label: 'Next instalment',
                  value: sip.next ? niceDate(sip.next.on) : '–',
                  note: sip.next
                    ? `${formatInr(Math.round(sip.next.amount))} · ${sip.next.fund}${sip.next.estimated ? ' (expected)' : ''}`
                    : 'no running SIP',
                },
              ]}
            />
          )}
        </section>
      </div>

      <section className="card wide" aria-labelledby="rg">
        <div className="cardhead">
          <h2 id="rg">Gains already booked by selling</h2>
          <span className="small muted">From the sales on fund statements, oldest units first</span>
        </div>
        {real.sales === 0 ? (
          <p className="empty">
            No sale appears on the fund statements imported so far. Nothing has been booked, or the
            statements are not imported yet.
          </p>
        ) : (
          <>
            <StatList
              label="Gains already booked"
              items={[
                {
                  label: 'Sales on statements',
                  value: String(real.sales),
                  note: `${formatInr(real.proceeds)} received`,
                },
                {
                  label: `Short-term (under ${months ?? '?'} months)`,
                  value: rupees(real.stcg),
                  note: 'equity-oriented funds',
                  tone: tone(real.stcg),
                },
                {
                  label: `Long-term (over ${months ?? '?'} months)`,
                  value: rupees(real.ltcg),
                  note: 'equity-oriented funds',
                  tone: tone(real.ltcg),
                },
                {
                  label: 'Other funds',
                  value: rupees(real.other),
                  note: 'debt, gold, international: taxed another way',
                  tone: tone(real.other),
                },
              ]}
            />
            {real.unknownCost > 0 && (
              <p className="cardnote">
                {real.unknownCost} sale{real.unknownCost === 1 ? '' : 's'} used units whose purchase
                is not on the statement, so{' '}
                {real.unknownCost === 1 ? 'its gain is' : 'their gains are'} left out.
              </p>
            )}
            {real.byYear.length > 0 && (
              <div className="cmpwrap">
                <table className="tbl lines cmp">
                  <thead>
                    <tr>
                      <th>Financial year</th>
                      <th className="num">Received</th>
                      <th className="num">Short-term gain</th>
                      <th className="num">Long-term gain</th>
                      <th className="num">Other funds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {real.byYear.map((y) => (
                      <tr key={y.fy}>
                        <td data-label="Financial year">{y.fy}</td>
                        <td className="num" data-label="Received">
                          {formatInr(y.proceeds)}
                        </td>
                        <td className={`num ${tone(y.stcg)}`} data-label="Short-term gain">
                          {rupees(y.stcg)}
                        </td>
                        <td className={`num ${tone(y.ltcg)}`} data-label="Long-term gain">
                          {rupees(y.ltcg)}
                        </td>
                        <td className={`num ${tone(y.other)}`} data-label="Other funds">
                          {rupees(y.other)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="cardnote">
              These are gains, not tax. The tax and the schedule for filing are on{' '}
              <Link href="/tax/filing">Tax filing papers</Link>.
            </p>
          </>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------------------------------ growth */

const at = (points: { date: string; value: number }[], d: string) => {
  let best: number | null = null;
  for (const p of points) {
    if (p.date > d) break;
    best = p.value;
  }
  return best;
};

export function GrowthTab({
  view,
  growth,
  pace,
  who,
  styles,
  base,
}: {
  view: InvestmentView;
  growth: Growth;
  pace: ReturnType<typeof fundPace>;
  who: string | null;
  styles: Record<string, PersonStyle>;
  /** the page address, for the range switch */
  base: string;
}) {
  const h = view.household;
  const colour = who ? (styles[who]?.colour ?? 'var(--viz-1)') : 'var(--viz-1)';
  const c = growth.change;
  const valuePoints = growth.points.map((p) => ({ date: p.date, value: p.value }));
  const investedPoints = growth.points
    .filter((p) => p.invested !== null)
    .map((p) => ({ date: p.date, value: p.invested as number }));
  const markers: PlotMarker[] = growth.markers.map((m) => ({
    date: m.date,
    value: at(valuePoints, m.date) ?? valuePoints[0]?.value ?? 0,
    shape: m.kind === 'lump' ? 'dot' : 'down',
    colour: m.kind === 'lump' ? 'var(--viz-2)' : 'var(--viz-bad)',
    label: `${m.kind === 'lump' ? 'One-off purchase' : 'Sale'} ${formatInr(m.amount)}: ${m.funds.join(', ')}`,
  }));
  const valueSeries: PlotSeries[] = [
    { key: 'value', name: 'Value', points: valuePoints, colour, area: true },
    { key: 'in', name: 'Money put in', points: investedPoints, colour: 'var(--viz-line)' },
  ];
  const retSeries: PlotSeries[] = [
    { key: 'ret', name: 'Gain on money put in', points: growth.returns, colour: 'var(--viz-3)' },
    ...(growth.xirr.length >= 2
      ? [{ key: 'xirr', name: 'Return a year (XIRR)', points: growth.xirr, colour: 'var(--viz-2)' }]
      : []),
  ];
  const personSeries: PlotSeries[] = view.groups.map((g) => ({
    key: g.ownerId,
    name: g.name,
    colour: styles[g.ownerId]?.colour ?? 'var(--viz-1)',
    points: clipSeries(g.trend, view.range, view.today).points.map((p) => ({
      date: p.date,
      value: p.value,
    })),
  }));
  const stats: Stat[] = [
    {
      label: 'Value now',
      value: formatInr(Math.round(h.value)),
      note: `as of ${niceDate(view.today)}`,
    },
    c
      ? {
          label: `Change in ${growth.rangeWords}`,
          value: rupees(c.endValue - c.startValue),
          note: `since ${niceDate(c.from)}`,
          tone: tone(c.endValue - c.startValue),
        }
      : { label: 'Change', value: '–', note: 'needs two dated values' },
    {
      label: 'New money put in',
      value: c?.netIn === null || c?.netIn === undefined ? '–' : rupees(c.netIn),
      note:
        c?.netIn === null || c?.netIn === undefined
          ? 'cost not recorded for the start'
          : 'purchases less sales',
    },
    {
      label: 'Made by the market',
      value: c?.gain === null || c?.gain === undefined ? '–' : rupees(c.gain),
      note:
        c?.returnPct === null || c?.returnPct === undefined
          ? 'change in value less new money'
          : `${pct(c.returnPct, 1)} on average money at work, approximate`,
      tone: tone(c?.gain ?? null),
    },
    {
      label: 'Return a year (XIRR)',
      value: h.xirr === null ? '–' : pct(h.xirr, 1),
      note: h.xirrEstimated ? 'partly estimated from start dates' : 'from fund statements',
      tone: tone(h.xirr),
    },
  ];
  const keep = who ? { p: who, tab: 'growth' } : { tab: 'growth' };
  const sellMarkers = growth.markers.some((m) => m.kind === 'sale');
  const lumpMarkers = growth.markers.some((m) => m.kind === 'lump');
  return (
    <>
      <RangeSwitch base={base} current={view.range} keep={keep} />
      <section className="card wide" aria-labelledby="gr">
        <div className="cardhead">
          <h2 id="gr">
            {who ? `${styles[who]?.name}'s funds` : 'All funds'}: value and money put in
          </h2>
          <span className="small muted">{growth.rangeWords}</span>
        </div>
        <StatList items={stats} label="Change over the chosen period" />
        <div style={{ height: 14 }} />
        <PlotChart
          unit="inr"
          caption={`Value of mutual funds against the money put in, ${growth.rangeWords}`}
          series={valueSeries}
          markers={markers}
          legendMarkers={[
            ...(lumpMarkers
              ? [{ label: 'One-off purchase', shape: 'dot' as const, colour: 'var(--viz-2)' }]
              : []),
            ...(sellMarkers
              ? [{ label: 'Sale', shape: 'down' as const, colour: 'var(--viz-bad)' }]
              : []),
          ]}
          note={[
            growth.startsLate ? 'History starts later than this range.' : '',
            growth.statementFunds < growth.totalFunds
              ? `${growth.totalFunds - growth.statementFunds} of ${growth.totalFunds} funds have no fund statement: their line follows the values you recorded, and the money put in is the amount recorded.`
              : '',
            growth.markers.length === 0 && growth.statementFunds > 0
              ? 'No one-off purchase or sale in this period.'
              : growth.statementFunds === 0
                ? 'One-off purchases and sales appear once a fund statement is imported.'
                : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </section>

      <section className="card wide" aria-labelledby="rt">
        <div className="cardhead">
          <h2 id="rt">Return over time</h2>
          <span className="small muted">{growth.rangeWords}</span>
        </div>
        <PlotChart
          unit="pct"
          caption={`Gain on the money put in${growth.xirr.length >= 2 ? ' and the return a year' : ''}, ${growth.rangeWords}`}
          series={retSeries}
          empty="The return graph appears once there are at least two dated values with the money put in."
          note={
            growth.xirr.length >= 2
              ? 'The return a year is worked out from the transactions on fund statements, month by month.'
              : `The return a year needs fund-statement transactions and at least ${view.config.annualiseAfterMonths} months of history, so it is not drawn yet.`
          }
        />
      </section>

      <section className="card wide" aria-labelledby="mc">
        <div className="cardhead">
          <h2 id="mc">Money put in each month</h2>
          <span className="small muted">Last {view.config.contributionMonths} months</span>
        </div>
        {growth.statementFunds === 0 ? (
          <p className="empty">
            Month-by-month purchases come from fund statements. Import one on the{' '}
            <Link href="/import">Import page</Link> to see them.
          </p>
        ) : (
          <>
            <MonthColumns
              months={growth.contributions}
              caption="Money put into funds in each of the last months"
            />
            {growth.statementFunds < growth.totalFunds && (
              <p className="cardnote">
                Shows {growth.statementFunds} of {growth.totalFunds} funds: the others have no fund
                statement.
              </p>
            )}
          </>
        )}
      </section>

      {!who && view.groups.length > 1 && (
        <section className="card wide" aria-labelledby="vp">
          <div className="cardhead">
            <h2 id="vp">Value by person</h2>
            <span className="small muted">{growth.rangeWords}</span>
          </div>
          <PlotChart
            unit="inr"
            caption={`Value of mutual funds for each person, ${growth.rangeWords}`}
            series={personSeries}
          />
        </section>
      )}

      <section className="card pace" aria-labelledby="pc">
        <div className="cardhead">
          <h2 id="pc">If you carry on like this</h2>
          <span className="small muted">Arithmetic, not a promise</span>
        </div>
        <p className="muted small">
          {formatInr(Math.round(h.sipMonthly))} a month in SIPs and {(pace.rate * 100).toFixed(1)}%
          a year ({h.xirr === null ? 'assumed' : 'your return so far'}), with a range of ±3 points.
        </p>
        <div className="pacegrid">
          {pace.projections.map((x) => (
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
      </section>
      {!who && view.groups.length > 1 && (
        <section className="card" aria-labelledby="share">
          <div className="cardhead">
            <h2 id="share">Who holds what</h2>
          </div>
          <BarList
            caption="Value of mutual funds by person"
            format={formatInrCompact}
            items={view.groups.map((g) => ({
              label: <PersonBadge p={styles[g.ownerId]} name size={18} />,
              value: g.totals.value,
              colour: styles[g.ownerId]?.colour ?? 'var(--primary, #4f46e5)',
              sub: `${rupees(g.totals.gain)} gain${g.totals.xirr === null ? '' : ` · ${pct(g.totals.xirr, 1)} a year`}`,
            }))}
          />
        </section>
      )}
    </>
  );
}
