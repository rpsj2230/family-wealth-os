import Link from 'next/link';
import {
  TERMS,
  clipSeries,
  formatInr,
  formatInrCompact,
  rebase,
  type PerfExplainSet,
  type PersonStyle,
  type PortfolioPerformance,
  type StatBlock,
  type YearKind,
} from '@fwos/core';
import { MonthColumns, RangeSwitch, StatList, type Stat } from '@/components/FundViz';
import { pct, rupees } from '@/components/InvestHeadline';
import {
  Chips,
  DrawdownCard,
  EstimateNote,
  Extremes,
  Heatmap,
  HowToRead,
  PlSection,
  RiskCard,
  RollingCard,
  ReturnsByPeriod,
  WhatIfCard,
  type PeriodRow,
} from '@/components/invest/PerfParts';
import { PlotChart, type PlotMarker, type PlotSeries } from '@/components/PlotChart';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import type { Growth } from '@/lib/growth-view';
import type { PlView } from '@/lib/invest-pl';
import type { fundPace, InvestmentView } from '@/lib/investments';

const tone = (n: number | null): 'gain' | 'fail' | null =>
  n === null ? null : n >= 0 ? 'gain' : 'fail';
const at = (points: { date: string; value: number }[], d: string) => {
  let best: number | null = null;
  for (const p of points) {
    if (p.date > d) break;
    best = p.value;
  }
  return best;
};

/**
 * The Performance tab: returns over fixed periods against the benchmark, profit and loss by week, month, quarter or year with
 * comparisons, the month-by-month grid, growth of 100 against the benchmark, the fall from the highest point, rolling returns, risk
 * figures, the what-if against the index fund, current value against invested, the monthly investments and the pace forecast.
 */
export function PerformanceTab({
  ex,
  view,
  stats,
  perf,
  growth,
  pace,
  pl,
  who,
  styles,
  heat,
  link,
}: {
  ex: PerfExplainSet;
  view: InvestmentView;
  stats: StatBlock;
  perf: PortfolioPerformance;
  growth: Growth;
  pace: ReturnType<typeof fundPace>;
  pl: PlView;
  who: string | null;
  styles: Record<string, PersonStyle>;
  heat: YearKind;
  /** a link to this tab with some query values changed */
  link: (patch: Record<string, string | undefined>) => string;
}) {
  const h = view.household;
  const bench = view.benchmark;
  const hasBench = !!bench && perf.versus.some((x) => x.v.benchmark !== null);
  const profile = perf.profile;
  const colour = who ? (styles[who]?.colour ?? 'var(--viz-1)') : 'var(--viz-1)';
  const rows: PeriodRow[] = perf.versus.map((x) => ({
    def: x.def,
    r: profile.trailing.find((t) => t.def.key === x.def.key)?.r ?? null,
    gain: perf.periodGains[x.def.key],
    v: x.v,
  }));

  // growth of 100: the time-weighted index and the benchmark from the same first day
  const idx = perf.index;
  const from = idx[0]?.date;
  const growthSeries: PlotSeries[] = [];
  if (idx.length >= 2 && from) {
    growthSeries.push({
      key: 'you',
      name: who ? `${styles[who]?.name}'s funds` : 'Your funds',
      colour,
      points: idx,
    });
    const b = bench ? rebase(bench.navs, from) : [];
    if (b.length >= 2)
      growthSeries.push({
        key: 'bench',
        name: `${bench?.name ?? 'Benchmark'} (proxy)`,
        colour: 'var(--viz-line)',
        dashed: true,
        points: b,
      });
  }

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
  const personSeries: PlotSeries[] = view.groups.map((g) => ({
    key: g.ownerId,
    name: g.name,
    colour: styles[g.ownerId]?.colour ?? 'var(--viz-1)',
    points: clipSeries(g.trend, view.range, view.today).points.map((p) => ({
      date: p.date,
      value: p.value,
    })),
  }));
  const valueStats: Stat[] = [
    {
      label: 'Current value',
      value: formatInr(Math.round(h.value)),
      note: `as of ${niceDate(view.today)}`,
      why: ex['invest.chgValue'],
    },
    c
      ? {
          label: `Change in ${growth.rangeWords}`,
          value: rupees(c.endValue - c.startValue),
          note: `since ${niceDate(c.from)}`,
          tone: tone(c.endValue - c.startValue),
          why: ex['invest.chgChange'],
        }
      : {
          label: 'Change',
          value: '–',
          note: 'needs two dated values',
          why: ex['invest.chgChange'],
        },
    {
      label: 'Added less withdrawn',
      value: c?.netIn === null || c?.netIn === undefined ? '–' : rupees(c.netIn),
      note:
        c?.netIn === null || c?.netIn === undefined
          ? 'cost not recorded for the start'
          : 'purchases less sales',
      why: ex['invest.chgNewMoney'],
    },
    {
      label: TERMS.earned.label,
      value: c?.gain === null || c?.gain === undefined ? '–' : rupees(c.gain),
      note:
        c?.returnPct === null || c?.returnPct === undefined
          ? 'change in value less new money'
          : `${pct(c.returnPct, 1)} on average money at work`,
      tone: tone(c?.gain ?? null),
      why: ex['invest.chgMarket'],
    },
  ];
  const sellMarkers = growth.markers.some((m) => m.kind === 'sale');
  const lumpMarkers = growth.markers.some((m) => m.kind === 'lump');
  const heatHref = (k: YearKind) => link({ heat: k === 'financial' ? undefined : k });

  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>.
      </p>
    );

  return (
    <>
      <HowToRead />

      <section className="card wide" aria-labelledby="rp">
        <div className="cardhead">
          <WhyHead why={ex['invest.returns']}>
            <h2 id="rp">Return over time</h2>
          </WhyHead>
          <span className="small muted">
            {who ? `${styles[who]?.name}'s funds` : 'All funds shown'}
          </span>
        </div>
        <ReturnsByPeriod rows={rows} benchName={bench?.name ?? null} hasBench={hasBench} />
        <EstimateNote share={perf.estimatedShare} />
      </section>

      <section className="card wide" aria-labelledby="plp">
        <div className="cardhead">
          <WhyHead why={ex['invest.pl']}>
            <h2 id="plp">Profit and loss by period</h2>
          </WhyHead>
          <span className="small muted">
            Rupees and per cent; money added or withdrawn is not counted as profit
          </span>
        </div>
        <PlSection
          v={pl}
          styles={Object.fromEntries(
            Object.entries(styles).map(([k, s]) => [k, { colour: s.colour, name: s.name }]),
          )}
          hrefFor={(p) => link({ by: p.by, compare: p.compare })}
          weeks={view.config.weeksShown}
          rowsShown={view.config.plRows}
        />
      </section>

      <section className="card wide" aria-labelledby="hm">
        <div className="cardhead">
          <WhyHead why={ex['invest.monthGrid']}>
            <h2 id="hm">Month by month</h2>
          </WhyHead>
          <span className="small muted">Return in each month, with the total for the year</span>
        </div>
        <Chips<YearKind>
          label="Years"
          items={[
            { key: 'financial', label: 'Financial (April to March)' },
            { key: 'calendar', label: 'Calendar' },
          ]}
          current={heat}
          href={heatHref}
        />
        <Extremes
          bestMonth={profile.bestMonth}
          worstMonth={profile.worstMonth}
          bestYear={heat === 'calendar' ? profile.bestYear : profile.bestFy}
          worstYear={heat === 'calendar' ? profile.worstYear : profile.worstFy}
          kind={heat}
        />
        <div style={{ height: 12 }} />
        <Heatmap
          rows={heat === 'calendar' ? profile.heatCalendar : profile.heatFinancial}
          kind={heat}
          months={profile.months}
        />
        {perf.estimatedShare > 0 && (
          <p className="cardnote">
            <span className="estchip">estimated</span> Months before a fund&apos;s statement starts
            use cash flows worked out from its start date and SIP.
          </p>
        )}
      </section>

      <section className="card wide" aria-labelledby="gv">
        <div className="cardhead">
          <WhyHead why={ex['invest.growth100']}>
            <h2 id="gv">Growth of 100{hasBench ? ' against the benchmark' : ''}</h2>
          </WhyHead>
          <span className="small muted">Time-weighted: money added does not lift the line</span>
        </div>
        <PlotChart
          unit="index"
          caption={`Growth of 100 for ${who ? `${styles[who]?.name}'s` : 'your'} funds${hasBench ? ' and the benchmark' : ''}`}
          series={growthSeries}
          empty="This line appears once there are two months of history."
          note={
            hasBench
              ? `Both lines start at 100 on ${niceDate(from)}. The benchmark is the price of an index fund that follows the Nifty 50: a proxy for the index.`
              : 'No benchmark is loaded yet.'
          }
        />
      </section>

      <div className="invgrid two">
        <section className="card" aria-labelledby="dd">
          <div className="cardhead">
            <WhyHead why={ex['invest.drawdown']}>
              <h2 id="dd">Fall from the highest point</h2>
            </WhyHead>
            <span className="small muted">Drawdown</span>
          </div>
          <DrawdownCard d={profile.drawdown} />
        </section>
        <section className="card" aria-labelledby="rk">
          <div className="cardhead">
            <WhyHead why={ex['invest.risk']}>
              <h2 id="rk">Risk</h2>
            </WhyHead>
            <span className="small muted">Volatility, Sharpe, Sortino</span>
          </div>
          <RiskCard risk={profile.risk} months={view.config.riskMinMonths} />
        </section>
      </div>

      <section className="card wide" aria-labelledby="ro">
        <div className="cardhead">
          <WhyHead why={ex['invest.rolling']}>
            <h2 id="ro">Rolling returns</h2>
          </WhyHead>
          <span className="small muted">What any holding period would have earned</span>
        </div>
        <RollingCard rolling={profile.rolling} minWindows={view.config.rollingMinWindows} />
      </section>

      <section className="card wide" aria-labelledby="wi">
        <div className="cardhead">
          <WhyHead why={ex['invest.whatIf']}>
            <h2 id="wi">The same money in the index fund</h2>
          </WhyHead>
          <span className="small muted">Benchmark proxy</span>
        </div>
        <WhatIfCard
          w={perf.whatIf}
          benchName={bench?.name ?? null}
          yourValue={h.value}
          yourNet={perf.whatIf?.netIn ?? h.invested}
          yourXirr={h.xirr}
        />
      </section>

      <section className="card wide" aria-labelledby="gr">
        <div className="cardhead">
          <h2 id="gr">Current value and invested</h2>
          <span className="small muted">{growth.rangeWords}</span>
        </div>
        <RangeSwitch
          current={view.range}
          hrefOf={(k) => link({ range: k === 'all' ? undefined : k })}
        />
        <StatList items={valueStats} label="Change over the chosen period" />
        <div style={{ height: 14 }} />
        <PlotChart
          unit="inr"
          caption={`Current value of mutual funds against invested, ${growth.rangeWords}`}
          series={[
            { key: 'value', name: 'Value', points: valuePoints, colour, area: true },
            { key: 'in', name: 'Invested', points: investedPoints, colour: 'var(--viz-line)' },
          ]}
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
              ? `${growth.totalFunds - growth.statementFunds} of ${growth.totalFunds} funds have no fund statement: their line follows the values you recorded.`
              : '',
          ]
            .filter(Boolean)
            .join(' ')}
        />
      </section>

      <section className="card wide" aria-labelledby="mc">
        <div className="cardhead">
          <WhyHead why={ex['invest.contrib']}>
            <h2 id="mc">Invested each month</h2>
          </WhyHead>
          <span className="small muted">Last {view.config.contributionMonths} months</span>
        </div>
        {growth.statementFunds === 0 ? (
          <p className="empty">
            Month-by-month purchases come from fund statements. Import one on the{' '}
            <Link href="/import">Import page</Link> to see them.
          </p>
        ) : (
          <MonthColumns
            months={growth.contributions}
            caption="Invested in funds in each of the last months"
          />
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
          <WhyHead why={ex['invest.pace']}>
            <h2 id="pc">If you carry on like this</h2>
          </WhyHead>
          <span className="small muted">A projection, not a promise</span>
        </div>
        <p className="muted small">
          {formatInr(Math.round(h.sipMonthly))} a month in SIPs and {(pace.rate * 100).toFixed(1)}%
          a year ({h.xirr === null ? 'assumed' : 'your return so far'}), with a range of ±
          {(pace.spread * 100).toFixed(0)} points. Funds have no maturity value; this is what the
          pace would give, the cap on the assumed return is in the saved configuration.
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
        <p className="cardnote">
          Best and weakest funds are on the <Link href={link({ tab: 'breakdown' })}>Breakdown</Link>{' '}
          tab; {formatInrCompact(stats.invested)} is invested so far.
        </p>
      </section>
    </>
  );
}
