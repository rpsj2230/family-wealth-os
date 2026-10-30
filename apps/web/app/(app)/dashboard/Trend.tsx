import Link from 'next/link';
import {
  HOME_RANGES,
  formatInrCompact,
  formatPct,
  type ExplainSet,
  type HomeRange,
} from '@fwos/core';
import { SplitBar, plural } from '@/app/(app)/accounts/BankOverview';
import { PlotChart, type PlotSeries } from '@/components/PlotChart';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import type { HomeModel } from '@/lib/home';
import { CardHead, Signed } from './parts';

const RANGE_WORDS: Record<HomeRange, string> = {
  '1M': 'the last month',
  '3M': 'the last 3 months',
  '6M': 'the last 6 months',
  '1Y': 'the last year',
  ALL: 'all the history',
};

/** The wealth movement period in the address, kept when the chart's range changes. */
const keepPeriod = (m: HomeModel) => {
  const mv = m.capital.movement;
  return mv.key === 'custom'
    ? `&period=custom&from=${mv.from.slice(0, 7)}&to=${(mv.to === m.today ? m.today : (mv.figures?.through ?? mv.to)).slice(0, 7)}`
    : `&period=${mv.key}`;
};

/** The time-range switch: links, so each range has an address, the back button works and the server draws it. */
function RangeLinks({ base, current, keep }: { base: string; current: HomeRange; keep: string }) {
  return (
    <nav className="rangeswitch hm-range" aria-label="Time range">
      {HOME_RANGES.map((r) => (
        <Link
          key={r.key}
          href={`${base}?range=${r.key}${keep}`}
          scroll={false}
          className={`fchip ${current === r.key ? 'on' : ''}`}
          aria-current={current === r.key ? 'true' : undefined}
        >
          {r.label}
        </Link>
      ))}
    </nav>
  );
}

/**
 * Net worth over time for the range in the address, what it changed by (and by the same length of time before it), the straight-line
 * "if the pace holds" extension, and how much of the money in banks and funds is invested against the profit on it.
 */
export function Trend({ m, base, ex }: { m: HomeModel; base: string; ex: ExplainSet<'home'> }) {
  const t = m.trend;
  const v = t.view;
  const g = t.growth;
  const series: PlotSeries[] = [
    {
      key: 'nw',
      name: 'Net worth',
      colour: 'var(--viz-1)',
      points: v.points.map((p) => ({ date: p.date, value: p.value })),
    },
  ];
  const last = v.points[v.points.length - 1];
  // the dotted line is drawn only where it does not squash the history: a year ahead on the year view, two on All
  const ahead = t.range === 'ALL' ? t.projection : t.range === '1Y' ? t.projection.slice(0, 1) : [];
  if (ahead.length > 0 && last)
    series.push({
      key: 'pace',
      name: 'If the pace holds',
      colour: 'var(--viz-3)',
      dashed: true,
      points: [last, ...ahead].map((p) => ({ date: p.date, value: p.value })),
    });
  const first = v.points[0];

  return (
    <section className="card hm-card hm-span2" aria-labelledby="hm-trend">
      <CardHead title="Net worth over time" id="hm-trend" why={ex['home.trend']} />
      <RangeLinks base={base} current={t.range} keep={keepPeriod(m)} />
      {v.change ? (
        <p className="hm-line">
          <Signed label="Change" amount={v.change.amount} pct={v.change.pct} />{' '}
          <span className="muted small">
            over {RANGE_WORDS[t.range]}
            {first ? `, from ${niceDate(first.date)}` : ''}
            {v.short ? ' (all the history there is)' : ''}
            {v.before ? (
              <>
                {' '}
                · the same length before it:{' '}
                <Signed label="" amount={v.before.amount} pct={v.before.pct} />
              </>
            ) : null}
          </span>
        </p>
      ) : (
        <p className="muted small">
          The change shows once two days are saved. The page saves one a day when you open it.
        </p>
      )}
      <PlotChart
        series={series}
        unit="inr"
        caption={`Household net worth over ${RANGE_WORDS[t.range]}`}
        empty="The graph appears once two days of net worth are saved."
      />
      {t.pace && ahead.length > 0 && (
        <p className="muted small">
          Dotted line: if the last {plural(t.pace.months, 'month')}&apos; pace (
          {t.pace.monthlyChange < 0 ? '−' : '+'}
          {formatInrCompact(Math.abs(t.pace.monthlyChange))} a month) simply continues. It reaches{' '}
          {formatInrCompact(ahead[0]!.value)} in a year
          {ahead.length > 1
            ? ` and ${formatInrCompact(ahead[ahead.length - 1]!.value)} in two`
            : ''}
          . A straight extension, not a forecast.
        </p>
      )}

      {g.current > 0 && (
        <div className="hm-growth">
          <WhyHead why={ex['home.growth']}>
            <h3 className="bv-h">Invested and profit, in banks and funds</h3>
          </WhyHead>
          <SplitBar
            caption="Invested against profit"
            parts={[
              { key: 'in', label: 'Invested', share: g.investedShare, className: 'hm-g-in' },
              {
                key: 'gain',
                label: g.growth >= 0 ? 'Profit' : 'Loss',
                share: 1 - g.investedShare,
                className: 'hm-g-out',
              },
            ]}
          />
          <ul className="bv-legend hm-legend" style={{ ['--cols' as string]: 3 }}>
            <li>
              <span className="bv-swatch hm-g-in" aria-hidden="true" />
              <span className="bv-lname">Invested</span>
              <strong className="bv-lamt">{formatInrCompact(g.invested)}</strong>
              <span className="bv-lpct">deposits and savings as recorded, funds as invested</span>
            </li>
            <li>
              <span className="bv-swatch hm-g-out" aria-hidden="true" />
              <span className="bv-lname">{g.growth >= 0 ? 'Profit' : 'Loss'}</span>
              <strong className={`bv-lamt ${g.growth < 0 ? 'bv-neg' : 'bv-pos'}`}>
                {g.growth < 0 ? '▼ ' : '▲ '}
                {formatInrCompact(Math.abs(g.growth))}
              </strong>
              <span className="bv-lpct">
                {g.growthPct !== null
                  ? `${g.growthPct < 0 ? '−' : '+'}${formatPct(Math.abs(g.growthPct), 1)} overall on ${formatInrCompact(g.invested)} invested`
                  : ''}
                {g.approximate ? ' · approximate: some funds have no statement' : ''}
              </span>
            </li>
            <li>
              <span className="bv-lname">Current value</span>
              <strong className="bv-lamt">{formatInrCompact(g.current)}</strong>
              <span className="bv-lpct">
                {g.parts.map((p) => `${p.label} ${formatInrCompact(p.current)}`).join(' · ')}
              </span>
            </li>
          </ul>
          <p className="muted small">
            Property, shares and money lent have no recorded cost, so they are not in this split.
          </p>
        </div>
      )}
    </section>
  );
}
