import Link from 'next/link';
import { formatInr, formatInrCompact, type Hero, type SeriesPoint } from '@fwos/core';
import { pct, rupees, tone } from '@/components/InvestHeadline';
import { niceDate } from '@/lib/dates';
import './invest.css';

export interface HeroProjection {
  years: number;
  expected: number;
}

const SIZE = 132;

/** A ring: the share of today's value that is the money put in, and the share that is growth. Text beside it says the same in words. */
function Ring({ cost, growth }: { cost: number; growth: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="hero-ring"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={`Of today's value, ${Math.round(cost * 100)}% is the money put in and ${Math.round(growth * 100)}% is growth`}
    >
      <circle cx={SIZE / 2} cy={SIZE / 2} r={r} className="ring-track" />
      <circle
        cx={SIZE / 2}
        cy={SIZE / 2}
        r={r}
        className="ring-cost"
        strokeDasharray={`${c * cost} ${c}`}
        transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
      />
      {growth > 0 && (
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={r}
          className="ring-growth"
          strokeDasharray={`${c * growth} ${c}`}
          strokeDashoffset={-c * cost}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
        />
      )}
      <text x="50%" y="47%" textAnchor="middle" className="ring-big">
        {Math.round(growth * 100)}%
      </text>
      <text x="50%" y="62%" textAnchor="middle" className="ring-sm">
        {growth > 0 ? 'is growth' : 'no growth yet'}
      </text>
    </svg>
  );
}

/** Value against money put in over the whole history: two lines and a filled area, drawn from the monthly series. */
function Spark({ points }: { points: SeriesPoint[] }) {
  const pts = points.filter((p) => Number.isFinite(p.value));
  if (pts.length < 2) return null;
  const W = 360;
  const H = 96;
  const padY = 8;
  const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
  const x0 = t(pts[0]!.date);
  const x1 = t(pts[pts.length - 1]!.date);
  const hi = Math.max(...pts.map((p) => Math.max(p.value, p.invested ?? 0)));
  const X = (d: string) => ((t(d) - x0) / (x1 - x0 || 1)) * W;
  const Y = (v: number) => padY + (1 - v / (hi || 1)) * (H - 2 * padY);
  const line = pts.map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`).join(' ');
  const inv = pts
    .filter((p) => p.invested !== null)
    .map((p) => `${X(p.date).toFixed(1)},${Y(p.invested as number).toFixed(1)}`)
    .join(' ');
  const last = pts[pts.length - 1]!;
  return (
    <svg
      className="hero-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`Value against money put in, ${niceDate(pts[0]!.date)} to ${niceDate(last.date)}`}
    >
      <defs>
        <linearGradient id="heroFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={`0,${H} ${line} ${W},${H}`} fill="url(#heroFill)" />
      {inv && (
        <polyline
          points={inv}
          fill="none"
          stroke="#fff"
          strokeOpacity="0.55"
          strokeWidth="1.6"
          strokeDasharray="5 4"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <polyline
        points={line}
        fill="none"
        stroke="#fff"
        strokeWidth="2.2"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={X(last.date)} cy={Y(last.value)} r="3.5" fill="#fff" />
    </svg>
  );
}

function Cell({
  label,
  value,
  sub,
  cls,
  href,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  cls?: string | null | undefined;
  href?: string | undefined;
}) {
  const body = (
    <>
      <dt>{label}</dt>
      <dd className={`v ${cls ?? ''}`}>{value}</dd>
      {sub && <dd className="s">{sub}</dd>}
    </>
  );
  return <div>{href ? <Link href={href}>{body}</Link> : body}</div>;
}

/**
 * The top of the Investments page: what the funds are worth, what was put in, the profit or loss in rupees and per cent, today's
 * move and the annual return, with a ring for "your money against growth" and a line of the value over time. Under it the rest of
 * the figures an investor looks for. Every figure arrives worked out (see `heroModel` in packages/core).
 */
export function PortfolioHero({
  hero,
  asOf,
  history,
  projection,
  projectionRate,
  projectionAssumed,
  holdingMonths,
  base,
  tabLinks,
}: {
  hero: Hero;
  asOf: string;
  history: SeriesPoint[];
  projection: HeroProjection[];
  projectionRate: number;
  projectionAssumed: boolean;
  holdingMonths: number | null;
  base: string;
  tabLinks: { performance: string; transactions: string; breakdown: string };
}) {
  const h = hero;
  const day = h.dayPct === null ? null : h.dayAmount;
  return (
    <section className="invhero" aria-label="Mutual funds at a glance">
      <div className="invhero-top">
        <div className="invhero-main">
          <div className="hero-label">Current value of mutual funds</div>
          <div className="hero-value">{formatInr(Math.round(h.value))}</div>
          <div className="hero-pills">
            <span className={`hpill ${tone(h.unrealised) === 'gain' ? 'up' : 'down'}`}>
              <span aria-hidden="true">{h.unrealised >= 0 ? '▲' : '▼'}</span>
              {rupees(h.unrealised)}
              {h.unrealisedPct !== null && <b>{pct(h.unrealisedPct, 1)}</b>}
              <span className="hp-sub">profit or loss on units held</span>
            </span>
            <span className={`hpill ${day === null ? '' : day >= 0 ? 'up' : 'down'}`}>
              {day === null ? (
                'Today: no price change yet'
              ) : (
                <>
                  <span aria-hidden="true">{day >= 0 ? '▲' : '▼'}</span>
                  {rupees(day)}
                  <b>{pct(h.dayPct!)}</b>
                  <span className="hp-sub">today</span>
                </>
              )}
            </span>
          </div>
          <div className="hero-asof">
            As of {niceDate(asOf)} · {h.funds} fund{h.funds === 1 ? '' : 's'}
            {h.folios > 0 ? ` · ${h.folios} folio${h.folios === 1 ? '' : 's'}` : ''}
          </div>
        </div>
        <div className="invhero-ring">
          {h.split ? (
            <>
              <Ring cost={h.split.cost} growth={h.split.growth} />
              <ul className="hero-key">
                <li>
                  <span className="sw cost" aria-hidden="true" />
                  <span>Your money</span>
                  <b>{formatInrCompact(Math.min(h.invested, h.value))}</b>
                </li>
                <li>
                  <span className="sw growth" aria-hidden="true" />
                  <span>{h.value >= h.invested ? 'Growth' : 'Shortfall'}</span>
                  <b>{formatInrCompact(Math.abs(h.value - h.invested))}</b>
                </li>
              </ul>
            </>
          ) : (
            <p className="hero-note">The money put in is needed to split the value.</p>
          )}
        </div>
        <div className="invhero-spark">
          <Spark points={history} />
          <div className="spark-key">
            <span>
              <i className="ln" aria-hidden="true" /> Value
            </span>
            <span>
              <i className="ln dash" aria-hidden="true" /> Money put in
            </span>
            <Link href={tabLinks.performance}>See performance</Link>
          </div>
        </div>
      </div>

      <dl className="invhero-grid">
        <Cell
          label="Invested"
          value={formatInrCompact(h.invested)}
          sub="cost of the units still held"
        />
        <Cell
          label="Profit or loss"
          value={rupees(h.unrealised)}
          sub={
            h.unrealisedPct === null
              ? 'no cost recorded'
              : `${pct(h.unrealisedPct, 1)} on money put in`
          }
          cls={tone(h.unrealised)}
        />
        <Cell
          label="Annual return (XIRR)"
          value={h.xirr === null ? '–' : pct(h.xirr, 1)}
          sub={
            h.xirr === null
              ? 'needs a start date or statement'
              : h.xirrEstimated
                ? 'partly estimated'
                : 'from statement transactions'
          }
          cls={tone(h.xirr)}
          href={tabLinks.performance}
        />
        <Cell
          label="Booked by selling"
          value={h.realised.sales === 0 ? 'None' : rupees(h.realised.total)}
          sub={
            h.realised.sales === 0
              ? 'no sale on statements'
              : `${h.realised.sales} sale line${h.realised.sales === 1 ? '' : 's'}${h.realised.unknown ? `, ${h.realised.unknown} cost unknown` : ''}`
          }
          cls={h.realised.sales === 0 ? null : tone(h.realised.total)}
          href={tabLinks.breakdown}
        />
        <Cell
          label="Total gain"
          value={rupees(h.totalGain)}
          sub="held plus booked"
          cls={tone(h.totalGain)}
        />
        <Cell
          label="SIP a month"
          value={h.sipMonthly > 0 ? formatInrCompact(h.sipMonthly) : 'None'}
          sub={h.sipMonthly > 0 ? 'running instalments' : 'no running SIP'}
        />
        <Cell
          label="Long-term share"
          value={h.longShare === null ? '–' : `${Math.round(h.longShare * 100)}%`}
          sub={
            h.longShare === null
              ? 'needs statement or prices'
              : `equity funds held over ${holdingMonths} months`
          }
          href={tabLinks.breakdown}
        />
        <Cell
          label="Statements"
          value={`${h.withStatement} of ${h.funds}`}
          sub={h.estimated > 0 ? `${h.estimated} estimated` : 'every fund is exact'}
          href={tabLinks.transactions}
        />
      </dl>

      <p className="invhero-foot">
        <b>Maturity value:</b> not applicable, because mutual funds have no fixed end date.
        {projection.length > 0 && (
          <>
            {' '}
            <span className="muted-on">
              A projection, not a promise: carrying on at {(projectionRate * 100).toFixed(1)}% a
              year ({projectionAssumed ? 'assumed' : 'your return so far'}) with today&apos;s SIPs
              gives{' '}
              {projection
                .slice(0, 3)
                .map(
                  (p) =>
                    `${formatInrCompact(p.expected)} in ${p.years} year${p.years === 1 ? '' : 's'}`,
                )
                .join(', ')}
              .
            </span>
          </>
        )}
        <span className="sr-only"> {base}</span>
      </p>
    </section>
  );
}
