import Link from 'next/link';
import {
  GRANULARITIES,
  formatInr,
  signedInr,
  signedPct,
  type ExplainSet,
  type Granularity,
  type ValuationHistory,
  type ValuationRow,
} from '@fwos/core';
import { Est } from '@/components/Est';
import { WhyHead, Why } from '@/components/Why';
import { Chips } from '@/components/invest/PerfParts';
import './valuebyperiod.css';

const tone = (n: number | null) =>
  n === null ? '' : Math.round(n) < 0 ? 'loss' : Math.round(n) > 0 ? 'gain' : '';

/** A signed figure: a real minus and red when it is a loss, plain "no data" when there is none. */
function Signed({
  n,
  pct = false,
  estimated = false,
}: {
  n: number | null;
  pct?: boolean;
  estimated?: boolean;
}) {
  if (n === null) return <span className="vbp-nil">–</span>;
  return (
    <span className={tone(n)}>
      {pct ? signedPct(n) : signedInr(n)}
      {estimated && (
        <>
          {' '}
          <Est />
        </>
      )}
    </span>
  );
}

/**
 * The bars of the total valuation. Plain SVG that prints and reads aloud: every bar has its own title and the table below carries
 * the same figures. A bar that rests on an estimate is lighter; a period with no data is an empty slot, not a short bar.
 */
function Bars({ rows }: { rows: ValuationRow[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value ?? 0));
  const W = 640;
  const H = 150;
  const slot = W / Math.max(1, rows.length);
  const bw = Math.max(2, Math.min(40, slot * 0.7));
  const every = Math.ceil(rows.length / 8);
  const short = (r: ValuationRow) =>
    r.period.label
      .replace(' (to date)', '')
      .replace(/^Week of /, '')
      .replace(/ FY /, ' ');
  return (
    <svg
      className="vbp-chart"
      viewBox={`0 0 ${W} ${H + 24}`}
      role="img"
      aria-label={`Total valuation by period: ${rows
        .filter((r) => r.value !== null)
        .map((r) => `${r.period.label} ${formatInr(Math.round(r.value!))}`)
        .join('; ')}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--border)" />
      {rows.map((r, i) => {
        const x = i * slot + (slot - bw) / 2;
        const h = r.value === null ? 0 : Math.max(1, (r.value / max) * (H - 8));
        return (
          <g key={r.period.key}>
            {r.value !== null && (
              <rect
                x={x}
                y={H - h}
                width={bw}
                height={h}
                rx="2"
                fill="var(--viz-1, var(--primary))"
                opacity={r.estimated ? 0.5 : 1}
              >
                <title>{`${r.period.label}: ${formatInr(Math.round(r.value))}${r.estimated ? ' (estimated)' : ''}`}</title>
              </rect>
            )}
            {i % every === 0 && (
              <text x={x + bw / 2} y={H + 16} textAnchor="middle" fontSize="10" fill="var(--muted)">
                {short(r)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Investments > Value by period: a bar chart of the total valuation and a table of how it changed. Weeks, months, quarters and years
 * and the range are links, so each choice has an address and works without scripts. The first two change columns are the plain change
 * in value (new money included, as a fund statement shows it); the last two take the money put in out, so a big purchase never reads
 * as a good month.
 */
export function ValueByPeriod({
  h,
  ex,
  href,
  csvHref,
  action,
  keep,
  recent,
  who,
  demo = false,
}: {
  h: ValuationHistory;
  ex: ExplainSet<'valuation'>;
  /** the address of this tab with some choices changed */
  href: (patch: Record<string, string | undefined>) => string;
  csvHref: string;
  /** where the from-to form sends (the tab's own address) and the choices it keeps */
  action: string;
  keep: Record<string, string>;
  /** Settings: how many periods "recent" shows */
  recent: number;
  who: string;
  demo?: boolean;
}) {
  const g = h.granularity;
  const noun = GRANULARITIES.find((x) => x.key === g)!;
  const plural = g === 'year' ? 'financial years' : `${noun.noun}s`;
  const range = h.range.kind === 'between' ? 'between' : h.range.kind;
  const rows = h.rows;
  const any = rows.some((r) => r.value !== null);
  return (
    <section className="card vbp" aria-labelledby="vbp-h" data-testid="vbp">
      <WhyHead why={ex['valuation.table']}>
        <h2 id="vbp-h">Portfolio value by period</h2>
      </WhyHead>
      <p className="muted small">
        What {who === 'everyone' ? 'all the mutual funds' : `${who}’s funds`} were worth at the end
        of each {noun.noun}, and how much of each change was new money and how much was a gain.
        {demo ? ' Invented funds for this sample.' : ''}
      </p>

      <div className="vbp-controls">
        <Chips<Granularity>
          label="Show"
          items={GRANULARITIES.map((x) => ({ key: x.key, label: x.label }))}
          current={g}
          href={(k) => href({ g: k })}
        />
        <Chips<'recent' | 'double' | 'all'>
          label="Range"
          items={[
            { key: 'recent', label: `Last ${recent}` },
            { key: 'double', label: `Last ${recent * 2}` },
            { key: 'all', label: 'All' },
          ]}
          current={range === 'between' ? 'all' : range}
          href={(k) => href({ range: k, from: undefined, to: undefined })}
        />
        <form className="vbp-between" method="get" action={action} aria-label="Choose dates">
          {Object.entries(keep).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label>
            From{' '}
            <input
              type="date"
              name="from"
              defaultValue={h.range.kind === 'between' ? h.range.from : ''}
              required
            />
          </label>
          <label>
            To{' '}
            <input
              type="date"
              name="to"
              defaultValue={h.range.kind === 'between' ? h.range.to : ''}
              required
            />
          </label>
          <button type="submit" className="btn">
            Show
          </button>
        </form>
        <a className="btn" href={csvHref} download data-testid="vbp-csv">
          Download CSV
        </a>
      </div>

      {rows.length === 0 || !any ? (
        <p className="empty" data-testid="vbp-empty">
          No fund has a value on record for this selection yet. Import a fund statement, or enter
          units and prices on the Update funds tab.
        </p>
      ) : (
        <>
          <div className="vbp-chartbox">
            <div className="vbp-charthead">
              <strong>Total valuation</strong>
              <Why explain={ex['valuation.chart']} />
              <span className="muted small">
                {' '}
                {rows.length} {rows.length === 1 ? noun.noun : plural}; lighter bars are estimated
              </span>
            </div>
            <Bars rows={rows} />
          </div>
          <div className="vbp-tablebox">
            <table className="vbp-table" data-testid="vbp-table">
              <caption className="sr-only">Portfolio value, change and gain by {noun.noun}</caption>
              <thead>
                <tr>
                  <th scope="col">Period</th>
                  <th scope="col" className="num">
                    Portfolio value (₹)
                  </th>
                  <th scope="col" className="num">
                    Change (₹)
                  </th>
                  <th scope="col" className="num">
                    Change (%)
                  </th>
                  <th scope="col" className="num">
                    Money put in, net of sales (₹)
                  </th>
                  <th scope="col" className="num">
                    Gain (₹)
                  </th>
                  <th scope="col" className="num">
                    Gain (%)
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map((r) => (
                  <tr key={r.period.key} data-testid="vbp-row">
                    <th scope="row" data-label="Period" className="vbp-period">
                      {r.period.label}
                      <span className="vbp-sub">
                        {r.period.startsInside
                          ? `data starts ${r.period.from.split('-').reverse().join('/')}`
                          : r.period.sub}
                      </span>
                    </th>
                    <td className="num" data-label="Portfolio value (₹)">
                      {r.value === null ? (
                        <span className="vbp-nil">no data</span>
                      ) : (
                        <>
                          {formatInr(Math.round(r.value))}
                          {r.estimated && (
                            <>
                              {' '}
                              <Est />
                            </>
                          )}
                        </>
                      )}
                    </td>
                    <td className="num" data-label="Change (₹)">
                      <Signed n={r.change} />
                    </td>
                    <td className="num" data-label="Change (%)">
                      <Signed n={r.changePct} pct />
                    </td>
                    <td className="num" data-label="Money put in, net of sales (₹)">
                      {r.value === null ? (
                        <span className="vbp-nil">–</span>
                      ) : (
                        signedInr(r.netIn, false)
                      )}
                    </td>
                    <td className="num" data-label="Gain (₹)">
                      <Signed n={r.gain} />
                    </td>
                    <td className="num" data-label="Gain (%)">
                      <Signed n={r.gainPct} pct />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="cardnote">
            Change is the plain move in value, as a fund statement shows it, so it includes money
            you put in. Gain takes that money out: the change less purchases plus sales, as a share
            of the money at work in the period. The latest row stops at today (
            {h.today.split('-').reverse().join('/')}) and says “to date”; “no data” means no price
            or record was near the end of that period. Values are the units held times the price on
            the last day; est. marks a value moved forward from an earlier record.
            {h.total > rows.length ? (
              <>
                {' '}
                Showing {rows.length} of {h.total} {plural} on record:{' '}
                <Link href={href({ range: 'all', from: undefined, to: undefined })} scroll={false}>
                  show all
                </Link>
                .
              </>
            ) : null}
          </p>
        </>
      )}
    </section>
  );
}
