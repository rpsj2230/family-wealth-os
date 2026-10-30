import Link from 'next/link';
import {
  TERMS,
  formatInr,
  formatInrCompact,
  type Explain,
  type Hero,
  type SeriesPoint,
} from '@fwos/core';
import { Est, LEDGER_EST_TITLE } from '@/components/Est';
import { pct, rupees, tone } from '@/components/InvestHeadline';
import { Why } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import './invest.css';
import '@/components/headline.css';

/** The explainers the hero carries: one for each headline figure. */
export interface HeroExplain {
  'invest.value': Explain;
  'invest.profit': Explain;
  'invest.today': Explain;
  'invest.ring': Explain;
  'invest.moneyIn': Explain;
  'invest.xirr': Explain;
  'invest.booked': Explain;
  'invest.totalGain': Explain;
  'invest.sip': Explain;
  'invest.longTerm': Explain;
  'invest.statements': Explain;
  'invest.projection': Explain;
}

export interface HeroProjection {
  years: number;
  expected: number;
}

const SIZE = 132;

/**
 * A ring: the share of today's value that is Invested and the share that is Profit, with the overall return (Profit ÷ Invested) in
 * the centre. Text beside it says the same in words.
 */
function Ring({ cost, growth, overall }: { cost: number; growth: number; overall: number | null }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="hero-ring"
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      width={SIZE}
      height={SIZE}
      role="img"
      aria-label={`Of the current value, ${Math.round(cost * 100)}% is invested and ${Math.round(growth * 100)}% is profit${overall === null ? '' : `: ${overall < 0 ? '−' : '+'}${Math.abs(overall * 100).toFixed(1)}% overall`}`}
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
        {overall === null
          ? '–'
          : `${overall < 0 ? '−' : '+'}${Math.abs(overall * 100).toFixed(1)}%`}
      </text>
      <text x="50%" y="62%" textAnchor="middle" className="ring-sm">
        overall
      </text>
    </svg>
  );
}

/** Current value against Invested over the whole history: two lines and a filled area, drawn from the monthly series. */
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
      aria-label={`Current value against invested, ${niceDate(pts[0]!.date)} to ${niceDate(last.date)}`}
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
  est,
  exact,
  why,
}: {
  label: string;
  value: string;
  sub?: string | undefined;
  cls?: string | null | undefined;
  href?: string | undefined;
  /** the figure rests on a fund history that does not add up */
  est?: boolean | undefined;
  /** the exact rupees, for a figure shown rounded (lakhs, crores) */
  exact?: string | undefined;
  /** the "?" that says how the figure was worked out */
  why?: Explain | undefined;
}) {
  const body = (
    <>
      <dd className={`v ${cls ?? ''}`} {...(exact ? { title: exact } : {})}>
        {value}
        {est && <Est title={LEDGER_EST_TITLE} />}
      </dd>
      {sub && <dd className="s">{sub}</dd>}
    </>
  );
  return (
    <div>
      <dt>
        {label}
        {why && <Why explain={why} tone="on-dark" />}
      </dt>
      {href ? <Link href={href}>{body}</Link> : body}
    </div>
  );
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
  ex,
  extras,
}: {
  ex: HeroExplain;
  /** "Also on this page": where the funds are held and the Regular plans that pay a yearly commission */
  extras?: {
    platforms: { name: string; value: number }[];
    regular: { value: number; count: number };
    /** the yearly tax-free allowance on long-term equity gains, and what is left of it for each person this financial year */
    taxFree?: { exemption: number; people: { name: string; left: number }[] } | null;
    /** your XIRR against the same money in the benchmark fund (Performance tab, same figures) */
    bench?: { name: string; xirr: number | null } | null;
    /** what the funds earned since 1 April: change in value less money added, plus profit booked on sales */
    earnedFy?: number | null;
  };
  hero: Hero;
  asOf: string;
  history: SeriesPoint[];
  projection: HeroProjection[];
  projectionRate: number;
  projectionAssumed: boolean;
  holdingMonths: number | null;
  base: string;
  tabLinks: { performance: string; transactions: string; breakdown: string; tax: string };
}) {
  const h = hero;
  const day = h.dayPct === null ? null : h.dayAmount;
  return (
    <section className="invhero" aria-label="Mutual funds at a glance">
      <div className="invhero-top">
        <div className="invhero-main">
          <div className="hero-label">
            {TERMS.currentValue.label} of mutual funds
            <Why explain={ex['invest.value']} tone="on-dark" />
          </div>
          <div className="hero-value">
            <span title={`${formatInr(Math.round(h.value))} exactly`}>
              {formatInr(Math.round(h.value))}
            </span>
            {h.unreconciled > 0 && <Est title={LEDGER_EST_TITLE} />}
          </div>
          <div className="hero-pills">
            <span className={`hpill ${tone(h.unrealised) === 'gain' ? 'up' : 'down'}`}>
              <span aria-hidden="true">{h.unrealised >= 0 ? '▲' : '▼'}</span>
              {rupees(h.unrealised)}
              {h.unrealisedPct !== null && <b>{pct(h.unrealisedPct, 1)}</b>}
              {h.unreconciled > 0 && <Est title={LEDGER_EST_TITLE} />}
              <span className="hp-sub">
                {h.unrealisedPct !== null ? 'overall · ' : ''}
                {TERMS.profit.label}
                {h.xirr !== null
                  ? ` · ${TERMS.xirr.label} ${pct(h.xirr, 2).replace(/^\+/, '')} a year`
                  : ''}
              </span>
              <Why explain={ex['invest.profit']} tone="on-dark" />
            </span>
            <span className={`hpill ${day === null ? '' : day >= 0 ? 'up' : 'down'}`}>
              {day === null ? (
                'Today: no price change yet'
              ) : (
                <>
                  <span aria-hidden="true">{day >= 0 ? '▲' : '▼'}</span>
                  {rupees(day)}
                  <b>{pct(h.dayPct!)}</b>
                  <span className="hp-sub">{TERMS.todayChange.label}</span>
                </>
              )}
              <Why explain={ex['invest.today']} tone="on-dark" />
            </span>
          </div>
          <div className="hero-asof">
            {h.funds} fund{h.funds === 1 ? '' : 's'}
            {extras && extras.platforms.length > 0
              ? ` · ${extras.platforms.map((p) => `${p.name} ${formatInrCompact(p.value)}`).join(' · ')}`
              : h.folios > 0
                ? ` · ${h.folios} folio${h.folios === 1 ? '' : 's'}`
                : ''}{' '}
            · as of {niceDate(asOf)} prices
          </div>
        </div>
        <div className="invhero-ring">
          {h.split ? (
            <>
              <Ring cost={h.split.cost} growth={h.split.growth} overall={h.unrealisedPct} />
              <div className="hero-keybox">
                <p className="ring-cap">
                  {h.value >= h.invested
                    ? `Invested ${Math.round(h.split.cost * 100)}% and profit ${Math.round(h.split.growth * 100)}% of the current value`
                    : `${Math.round(h.split.cost * 100)}% of what was invested is left`}
                  <Why explain={ex['invest.ring']} tone="on-dark" />
                </p>
                <ul className="hero-key">
                  <li>
                    <span className="sw cost" aria-hidden="true" />
                    <span>{TERMS.invested.label}</span>
                    <b title={formatInr(Math.round(Math.min(h.invested, h.value)))}>
                      {formatInrCompact(Math.min(h.invested, h.value))}
                    </b>
                  </li>
                  <li>
                    <span className="sw growth" aria-hidden="true" />
                    <span>{h.value >= h.invested ? TERMS.profit.label : 'Loss'}</span>
                    <b title={formatInr(Math.round(Math.abs(h.value - h.invested)))}>
                      {formatInrCompact(Math.abs(h.value - h.invested))}
                    </b>
                  </li>
                </ul>
              </div>
            </>
          ) : (
            <p className="hero-note">What was invested is needed to split the value.</p>
          )}
        </div>
        <div className="invhero-spark">
          <Spark points={history} />
          <div className="spark-key">
            <span>
              <i className="ln" aria-hidden="true" /> {TERMS.currentValue.label}
            </span>
            <span>
              <i className="ln dash" aria-hidden="true" /> {TERMS.invested.label}
            </span>
            <Link href={tabLinks.performance}>See performance</Link>
          </div>
        </div>
      </div>

      <dl className="invhero-grid">
        <Cell
          label={TERMS.invested.label}
          value={formatInrCompact(h.invested)}
          exact={formatInr(Math.round(h.invested))}
          sub="cost of the units still held"
          est={h.unreconciled > 0}
          why={ex['invest.moneyIn']}
        />
        <Cell
          label={TERMS.profit.label}
          value={rupees(h.unrealised)}
          sub={h.unrealisedPct === null ? 'no cost recorded' : `${pct(h.unrealisedPct, 1)} overall`}
          cls={tone(h.unrealised)}
          est={h.unreconciled > 0}
          why={ex['invest.profit']}
        />
        <Cell
          label={TERMS.xirr.label}
          value={h.xirr === null ? '–' : `${pct(h.xirr, 2).replace(/^\+/, '')} a year`}
          sub={
            h.xirr === null
              ? 'needs a start date or statement'
              : h.xirrEstimated
                ? 'all purchases and sales · partly estimated'
                : 'all purchases and sales'
          }
          cls={tone(h.xirr)}
          href={tabLinks.performance}
          est={h.unreconciled > 0}
          why={ex['invest.xirr']}
        />
        <Cell
          label={TERMS.booked.label}
          value={h.realised.sales === 0 ? 'None' : rupees(h.realised.total)}
          sub={
            h.realised.sales === 0
              ? 'no sale on statements'
              : `from ${h.realised.sales} sale${h.realised.sales === 1 ? '' : 's'}${h.realised.unknown ? `, ${h.realised.unknown} cost unknown` : ''}`
          }
          cls={h.realised.sales === 0 ? null : tone(h.realised.total)}
          href={tabLinks.breakdown}
          why={ex['invest.booked']}
        />
        <Cell
          label={TERMS.totalProfit.label}
          value={rupees(h.totalGain)}
          sub="Profit + Booked profit"
          cls={tone(h.totalGain)}
          est={h.unreconciled > 0}
          why={ex['invest.totalGain']}
        />
        <Cell
          label={TERMS.earnedFy.label}
          value={typeof extras?.earnedFy === 'number' ? rupees(extras.earnedFy) : '–'}
          sub="since 1 April, money added left out"
          cls={typeof extras?.earnedFy === 'number' ? tone(extras.earnedFy) : null}
          href={tabLinks.performance}
        />
      </dl>

      {extras && (
        <div className="hl-extras invhero-extras">
          <h3 className="hl-xh">Also on this page</h3>
          <ul className="hl-xg">
            <li className="hl-x" data-testid="inv-x-longterm">
              <div className="hl-xl">
                {TERMS.longTermShare.label}
                <Why explain={ex['invest.longTerm']} tone="on-dark" />
              </div>
              <div className="hl-xv num">
                {h.longShare === null ? '–' : `${Math.round(h.longShare * 100)}%`}
              </div>
              <div className="hl-xs">
                {h.longShare === null
                  ? 'needs a statement or prices'
                  : `of equity value, held over ${holdingMonths} months: taxed as long-term`}
              </div>
            </li>
            <li
              className={`hl-x${extras.regular.count > 0 ? ' warn' : ''}`}
              data-testid="inv-x-regular"
            >
              <div className="hl-xl">Regular plans</div>
              <div className="hl-xv num">
                {extras.regular.count > 0 ? formatInrCompact(extras.regular.value) : 'None'}
              </div>
              <div className="hl-xs">
                {extras.regular.count > 0
                  ? `${extras.regular.count} ${extras.regular.count === 1 ? 'fund pays' : 'funds pay'} a yearly commission; Direct does not`
                  : 'every fund is a Direct plan'}
              </div>
            </li>
            <li className="hl-x" data-testid="inv-x-taxfree">
              <div className="hl-xl">
                <Link href={tabLinks.tax} className="hl-tlink">
                  Tax-free gain left this FY
                </Link>
              </div>
              <div className="hl-xv num">
                {extras.taxFree
                  ? formatInrCompact(extras.taxFree.people.reduce((a, p) => a + p.left, 0))
                  : '–'}
              </div>
              <div className="hl-xs">
                {extras.taxFree
                  ? `${extras.taxFree.people.map((p) => `${p.name} ${formatInrCompact(p.left)}`).join(' · ')} of ${formatInrCompact(extras.taxFree.exemption)} a person, for harvesting`
                  : 'the tax rules for this year are not set yet'}
              </div>
            </li>
            <li className="hl-x" data-testid="inv-x-benchmarks">
              <div className="hl-xl">
                <Link href={tabLinks.performance} className="hl-tlink">
                  Against benchmarks
                </Link>
              </div>
              <div className="hl-xv num">
                {extras.bench && extras.bench.xirr !== null && h.xirr !== null
                  ? `${h.xirr >= extras.bench.xirr ? 'Ahead' : 'Behind'} by ${(Math.abs(h.xirr - extras.bench.xirr) * 100).toFixed(1)} points`
                  : '–'}
              </div>
              <div className="hl-xs">
                {extras.bench && extras.bench.xirr !== null && h.xirr !== null
                  ? `your XIRR ${pct(h.xirr, 2).replace(/^\+/, '')} vs ${pct(extras.bench.xirr, 2).replace(/^\+/, '')} for the same money in ${extras.bench.name} · each fund against its own index on its page`
                  : 'needs the benchmark prices: each fund against its own index on its page'}
              </div>
            </li>
          </ul>
        </div>
      )}

      <p className="invhero-foot">
        <b>{TERMS.sip.label}:</b>{' '}
        {h.sipMonthly > 0
          ? `${formatInr(Math.round(h.sipMonthly))} a month, running instalments`
          : 'no running SIP'}
        <Why explain={ex['invest.sip']} tone="on-dark" /> · <b>Statements:</b> {h.withStatement} of{' '}
        {h.funds}
        {h.estimated > 0 || h.unreconciled > 0
          ? ` (${[
              h.estimated > 0 ? `${h.estimated} estimated` : '',
              h.unreconciled > 0 ? `${h.unreconciled} not reconciled yet` : '',
            ]
              .filter(Boolean)
              .join(', ')})`
          : ', every fund is exact'}
        <Why explain={ex['invest.statements']} tone="on-dark" />
        <br />
        <b>{TERMS.maturityValue.label}:</b> not applicable, because mutual funds have no fixed end
        date.
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
            <Why explain={ex['invest.projection']} tone="on-dark" />
          </>
        )}
        <span className="sr-only"> {base}</span>
      </p>
    </section>
  );
}
