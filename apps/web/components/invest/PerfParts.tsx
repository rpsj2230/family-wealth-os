import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  formatInr,
  formatInrCompact,
  shownReturn,
  type DrawdownResult,
  type HeatRow,
  type MonthReturn,
  type PeriodDef,
  type PeriodGain,
  type PlBucket,
  type PlKind,
  type PlRow,
  type PlSeries,
  type RiskStats,
  type RollingResult,
  type TrailingReturn,
  type Versus,
  type WhatIf,
  type YearKind,
  PL_KINDS,
} from '@fwos/core';
import { pct, rupees, rupeesCompact, tone } from '@/components/InvestHeadline';
import { PlotChart, type PlotSeries } from '@/components/PlotChart';
import { niceDate } from '@/lib/dates';
import { PL_COMPARES, type PlCompareMode, type PlView } from '@/lib/invest-pl';
import './invest.css';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const FY_MON = [...MON.slice(3), ...MON.slice(0, 3)];
const inr = (n: number) => formatInr(Math.round(n));
const monthName = (ym: string) => `${MON[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

/** A heading line with one sentence under it, used by every card of the Performance tab. */
export function CardHead({ id, title, hint }: { id: string; title: string; hint?: ReactNode }) {
  return (
    <div className="cardhead">
      <h2 id={id}>{title}</h2>
      {hint && <span className="small muted">{hint}</span>}
    </div>
  );
}

/** The two kinds of return, in one line each. */
export function HowToRead() {
  return (
    <aside className="howread" aria-label="How the returns are measured">
      <p>
        <b>Time-weighted return</b> shows how the funds themselves did, whatever the dates you put
        money in. It is what the period tables and the month grid show.
      </p>
      <p>
        <b>Money-weighted return (XIRR)</b> shows what you earned on your own money, given when each
        rupee went in. It is the annual return in the headline.
      </p>
    </aside>
  );
}

export function EstimateNote({ share }: { share: number }) {
  if (share <= 0) return null;
  return (
    <p className="cardnote">
      <span className="estchip">estimated</span> {Math.round(share * 100)}% of today&apos;s value is
      in funds with no fund statement. For them the money put in each month is worked out from the
      start date and the SIP, so the figures that use it are marked estimated and become exact once
      a statement is imported.
    </p>
  );
}

/* ------------------------------------------------------------------------------------ returns by period */

export interface PeriodRow {
  def: PeriodDef;
  r: TrailingReturn | null;
  gain: PeriodGain | undefined;
  v: Versus;
}

const retText = (r: TrailingReturn | null) => (r === null ? '–' : pct(shownReturn(r), 1));

export function ReturnsByPeriod({
  rows,
  benchName,
  hasBench,
  bars = true,
  showGain = true,
}: {
  rows: PeriodRow[];
  benchName: string | null;
  hasBench: boolean;
  /** also draw the bars under the table */
  bars?: boolean;
  /** the rupee profit or loss column */
  showGain?: boolean;
}) {
  // with nothing below zero the bars start at the left edge and use the whole width
  const oneSided = rows.every((x) => (x.v.yours ?? 0) >= 0 && (x.v.benchmark ?? 0) >= 0);
  const span = oneSided ? 100 : 50;
  const max = Math.max(
    0.01,
    ...rows.flatMap((x) => [Math.abs(x.v.yours ?? 0), Math.abs(x.v.benchmark ?? 0)]),
  );
  return (
    <>
      <div className="cmpwrap">
        <table className="tbl lines cmp perftbl keepcols">
          <thead>
            <tr>
              <th>Period</th>
              <th className="num">Return</th>
              {showGain && <th className="num gaincol">Profit or loss</th>}
              {hasBench && <th className="num">Benchmark (proxy)</th>}
              {hasBench && <th className="num">Difference</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ def, r, gain, v }) => (
              <tr key={def.key}>
                <td data-label="Period">
                  <b>{def.label}</b>
                  <span className="muted small">
                    {' '}
                    {r && r.annualised !== null ? 'a year' : r ? 'total' : ''}
                  </span>
                </td>
                <td
                  className={`num ${tone(r ? shownReturn(r) : null)}`}
                  data-label="Return"
                  title={
                    r
                      ? `${niceDate(r.from)} to ${niceDate(r.to)}`
                      : 'The history does not reach back this far'
                  }
                >
                  {retText(r)}
                  {showGain && gain && (
                    <span className={`fl-s gainline ${tone(gain.gain)}`}>{rupees(gain.gain)}</span>
                  )}
                </td>
                {showGain && (
                  <td
                    className={`num gaincol ${gain ? tone(gain.gain) : ''}`}
                    data-label="Profit or loss"
                  >
                    {gain ? rupees(gain.gain) : '–'}
                  </td>
                )}
                {hasBench && (
                  <td className={`num ${tone(v.benchmark)}`} data-label="Benchmark (proxy)">
                    {v.benchmark === null ? '–' : pct(v.benchmark, 1)}
                  </td>
                )}
                {hasBench && (
                  <td className={`num ${tone(v.diff)}`} data-label="Difference">
                    {v.diff === null
                      ? '–'
                      : `${v.diff >= 0 ? '+' : '−'}${Math.abs(v.diff * 100).toFixed(1)} pts`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {bars && (
        <>
          <ul
            className={`perbars ${oneSided ? 'onesided' : ''}`}
            aria-label="Return over each period"
            role="list"
          >
            {rows
              .filter((x) => x.v.yours !== null || x.v.benchmark !== null)
              .map(({ def, v }) => (
                <li key={def.key}>
                  <span className="lab">{def.label}</span>
                  <span className="track" role="presentation">
                    {v.yours !== null && (
                      <span
                        className={`bar yours ${v.yours >= 0 ? 'pos' : 'neg'}`}
                        style={{ width: `${(Math.abs(v.yours) / max) * span}%` }}
                      />
                    )}
                    {hasBench && v.benchmark !== null && (
                      <span
                        className={`bar bench ${v.benchmark >= 0 ? 'pos' : 'neg'}`}
                        style={{ width: `${(Math.abs(v.benchmark) / max) * span}%` }}
                      />
                    )}
                  </span>
                  <span className="val">
                    <span className={tone(v.yours)}>
                      {v.yours === null ? '–' : pct(v.yours, 1)}
                    </span>
                    {hasBench && (
                      <span className="muted">
                        {' '}
                        · {v.benchmark === null ? '–' : pct(v.benchmark, 1)}
                      </span>
                    )}
                  </span>
                </li>
              ))}
          </ul>
          <ul className="vizlegend">
            <li>
              <span className="sw" style={{ background: 'var(--viz-good)' }} aria-hidden="true" />{' '}
              Your funds (green gain, red loss)
            </li>
            {hasBench && (
              <li>
                <span
                  className="sw"
                  style={{ background: 'var(--viz-other)' }}
                  aria-hidden="true"
                />{' '}
                {benchName ?? 'Benchmark'} (proxy)
              </li>
            )}
          </ul>
        </>
      )}
      <p className="cardnote">
        Under a year the plain change is shown; from a year, the rate per year. A dash means the
        history does not reach back that far.
        {hasBench
          ? ' The benchmark is the price of an index fund that follows the Nifty 50, a stand-in for the index itself (it carries the fund’s small costs).'
          : ' No benchmark is loaded yet: the daily market-data job fetches an index fund’s prices once it is set (Settings, benchmark fund code).'}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------------------------ profit and loss by period */

/** A row of chips that are links, one of which is on. */
export function Chips<T extends string>({
  label,
  items,
  current,
  href,
}: {
  label: string;
  items: { key: T; label: string }[];
  current: T;
  href: (k: T) => string;
}) {
  return (
    <nav className="rangeswitch" aria-label={label}>
      <span className="rangelabel">{label}</span>
      {items.map((i) => (
        <Link
          key={i.key}
          href={href(i.key)}
          scroll={false}
          className={`fchip ${current === i.key ? 'on' : ''}`}
          aria-current={current === i.key ? 'true' : undefined}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

const shortLabel = (b: { key: string; label: string }, kind: PlKind) =>
  kind === 'month'
    ? MON[Number(b.key.slice(5, 7)) - 1]!
    : kind === 'week'
      ? b.label.split(' to ')[0]!
      : kind === 'quarter'
        ? b.label.slice(0, 2)
        : kind === 'fy'
          ? b.key.slice(2)
          : b.key;

/**
 * Bars for the profit or loss of each period (green above the line, red below), with the running total as a line over them.
 * For a comparison the bars sit side by side in each person's or fund's colour and show the return per cent.
 */
export function PlChart({
  v,
  styles,
}: {
  v: PlView;
  styles: Record<string, { colour: string; name: string }>;
}) {
  void styles;
  const compare = v.mode === 'person' || v.mode === 'fund';
  const rows: PlRow[] = v.rows;
  if (rows.length === 0) return <p className="empty">Not enough history yet for this view.</p>;
  const val = (c: { gain: number | null; ret: number | null }) => (compare ? c.ret : c.gain);
  const nums = rows.flatMap((r) => r.cells.map(val)).filter((x): x is number => x !== null);
  const up = Math.max(0, ...nums);
  const down = Math.max(0, ...nums.map((x) => -x));
  const span = up + down || 1;
  const upShare = up / span;
  const cum = !compare ? v.main.map((b) => b.cumGain) : [];
  const cmin = Math.min(0, ...cum);
  const cmax = Math.max(0, ...cum);
  const cy = (x: number) => (1 - (x - cmin) / (cmax - cmin || 1)) * 96 + 2;
  const step = Math.ceil(rows.length / 8);
  const fmt = (x: number) => (compare ? pct(x, 1) : rupeesCompact(x));
  return (
    <div className="plchart">
      <div className="colsmax">
        <span>
          Highest {compare ? 'return' : 'gain'} {up > 0 ? fmt(up) : '–'}
        </span>
        <span>Lowest {down > 0 ? fmt(-down) : '–'}</span>
      </div>
      <div
        className="plbars"
        role="img"
        aria-label={`Profit or loss by ${v.kind}`}
        style={{ ['--up' as string]: `${upShare * 100}%` }}
      >
        <div className="axisline" style={{ top: `${upShare * 100}%` }} />
        {rows.map((r) => (
          <div
            className={`plcol ${compare ? 'multi' : ''}`}
            key={r.key}
            title={`${r.label}${r.partial ? ' (not a full period)' : ''}: ${r.cells.map((c) => `${v.series.find((s) => s.id === c.id)?.label ?? ''} ${c.gain === null ? '–' : rupees(c.gain)}${c.ret === null ? '' : ` (${pct(c.ret, 1)})`}`).join('; ')}`}
          >
            {r.cells.map((c) => {
              const x = val(c);
              const s = v.series.find((q) => q.id === c.id)!;
              return (
                <div className="plbar" key={c.id}>
                  <div className="plup">
                    {x !== null && x > 0 && (
                      <span
                        className={c.estimated && !v.allEstimated ? 'est' : ''}
                        style={{
                          height: `${(x / (up || 1)) * 100}%`,
                          background: compare ? s.colour : 'var(--viz-good)',
                        }}
                      />
                    )}
                  </div>
                  <div className="pldown">
                    {x !== null && x < 0 && (
                      <span
                        className={c.estimated && !v.allEstimated ? 'est' : ''}
                        style={{
                          height: `${(-x / (down || 1)) * 100}%`,
                          background: compare ? s.colour : 'var(--viz-bad)',
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
        {!compare && cum.length >= 2 && (
          <svg
            className="plline"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline
              points={cum.map((c, i) => `${((i + 0.5) / cum.length) * 100},${cy(c)}`).join(' ')}
              fill="none"
              stroke="var(--viz-1)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <div className="colslabels" aria-hidden="true">
        {rows.map((r, i) => (
          <span key={r.key}>
            {i % step === 0 ? shortLabel({ key: r.key, label: r.label }, v.kind) : ''}
          </span>
        ))}
      </div>
      <ul className="vizlegend">
        {compare ? (
          v.series.map((s) => (
            <li key={s.id}>
              <span className="sw" style={{ background: s.colour }} aria-hidden="true" /> {s.label}
            </li>
          ))
        ) : (
          <>
            <li>
              <span className="sw" style={{ background: 'var(--viz-good)' }} aria-hidden="true" />{' '}
              Profit
            </li>
            <li>
              <span className="sw" style={{ background: 'var(--viz-bad)' }} aria-hidden="true" />{' '}
              Loss
            </li>
            <li>
              <span className="sw line" style={{ background: 'var(--viz-1)' }} aria-hidden="true" />{' '}
              Running total ({cum.length > 0 ? rupeesCompact(cum[cum.length - 1]!) : '–'})
            </li>
          </>
        )}
        {!v.allEstimated && rows.some((r) => r.cells.some((c) => c.estimated)) && (
          <li>
            <span className="sw hatch" aria-hidden="true" /> estimated
          </li>
        )}
      </ul>
    </div>
  );
}

const flag = (b: { partial: boolean; estimated: boolean }, showEst = true) => (
  <>
    {b.partial && (
      <span
        className="partchip"
        title="The period is not over, or the history began part-way through it"
      >
        part
      </span>
    )}
    {b.estimated && showEst && (
      <span
        className="estchip"
        title="Includes funds whose money put in is worked out from the start date and SIP"
      >
        est.
      </span>
    )}
  </>
);

/** The same figures as a table, newest first. A comparison has a column pair per person or fund. */
export function PlTable({ v }: { v: PlView }) {
  const compare = v.mode === 'person' || v.mode === 'fund';
  if (compare) {
    const rows = [...v.rows].reverse();
    return (
      <div className="cmpwrap">
        <table className="tbl lines cmp pltbl keepcols">
          <thead>
            <tr>
              <th>Period</th>
              {v.series.map((s) => (
                <th key={s.id} className="num" title={s.label}>
                  <span className="sw" style={{ background: s.colour }} aria-hidden="true" />{' '}
                  {s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td data-label="Period">
                  {r.label}
                  {flag({ partial: r.partial, estimated: false })}
                </td>
                {r.cells.map((c) => {
                  const s = v.series.find((x) => x.id === c.id)!;
                  return (
                    <td key={c.id} className={`num ${tone(c.gain)}`} data-label={s.label}>
                      {c.gain === null ? '–' : rupees(c.gain)}
                      <span className="fl-s">{c.ret === null ? '' : pct(c.ret, 1)}</span>
                      {c.estimated && <span className="estchip">est.</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const rows = [...v.main].reverse();
  return (
    <div className="cmpwrap">
      <table className="tbl lines cmp pltbl keepcols">
        <thead>
          <tr>
            <th>Period</th>
            <th className="num">Profit or loss</th>
            <th className="num wide-only">Return</th>
            <th className="num wide-only">Money added</th>
            <th className="num wide-only">Value at the end</th>
            <th className="num">Running total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.key}>
              <td data-label="Period">
                {b.label}
                {flag(b, !v.allEstimated)}
              </td>
              <td className={`num ${tone(b.gain)}`} data-label="Profit or loss">
                {rupees(b.gain)}
                <span className="fl-s narrow-only">{b.ret === null ? '' : pct(b.ret, 2)}</span>
              </td>
              <td className={`num wide-only ${tone(b.ret)}`} data-label="Return">
                {b.ret === null ? '–' : pct(b.ret, 2)}
              </td>
              <td className={`num wide-only ${b.netIn < 0 ? 'out' : ''}`} data-label="Money added">
                {Math.abs(b.netIn) < 1 ? '–' : rupees(b.netIn)}
              </td>
              <td className="num wide-only" data-label="Value at the end">
                {inr(b.endValue)}
              </td>
              <td className={`num ${tone(b.cumGain)}`} data-label="Running total">
                {rupees(b.cumGain)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function PlPrev({ v }: { v: PlView }) {
  const c = v.prev;
  if (!c) return null;
  const cell = (b: PlBucket, title: string) => (
    <div className="prevcell">
      <div className="muted small">{title}</div>
      <b>{b.label}</b>
      <div className={`big ${tone(b.gain)}`}>{rupees(b.gain)}</div>
      <div className={`small ${tone(b.ret)}`}>{b.ret === null ? '' : pct(b.ret, 2)}</div>
    </div>
  );
  return (
    <div className="prevcmp" aria-label="This period against the one before">
      {cell(c.current, c.partial ? 'This period (so far)' : 'This period')}
      {cell(c.previous, 'The one before')}
      <div className="prevcell diff">
        <div className="muted small">Difference</div>
        <div className={`big ${tone(c.diffGain)}`}>{rupees(c.diffGain)}</div>
        <div className={`small ${tone(c.diffRet)}`}>
          {c.diffRet === null
            ? ''
            : `${c.diffRet >= 0 ? '+' : '−'}${Math.abs(c.diffRet * 100).toFixed(2)} points`}
        </div>
        {c.partial && <div className="muted small">a part of a period against a whole one</div>}
      </div>
    </div>
  );
}

/** The whole profit and loss section: switches, chart, comparison and table. */
export function PlSection({
  v,
  styles,
  hrefFor,
  weeks,
  rowsShown,
}: {
  v: PlView;
  styles: Record<string, { colour: string; name: string }>;
  hrefFor: (p: { by?: PlKind; compare?: PlCompareMode }) => string;
  weeks: number;
  rowsShown: number;
}) {
  const unit = PL_KINDS.find((k) => k.key === v.kind)?.unit ?? 'period';
  return (
    <>
      <Chips
        label="By"
        items={PL_KINDS.map((k) => ({ key: k.key, label: k.label }))}
        current={v.kind}
        href={(k) => hrefFor({ by: k })}
      />
      <Chips
        label="Compare"
        items={PL_COMPARES}
        current={v.mode}
        href={(k) => hrefFor({ compare: k })}
      />
      <PlPrev v={v} />
      <PlChart v={v} styles={styles} />
      <p className="cardnote">
        Money you put in or take out is never counted as profit: each {unit}&apos;s profit is the
        change in value less the net money added, and the per cent is the time-weighted return.
        {v.kind === 'week' &&
          ` Weeks go back ${weeks} weeks, as the funds are valued month by month before that.`}
        {v.cut && ` Showing the latest ${rowsShown} ${unit}s.`}
        {v.estimated &&
          (v.allEstimated
            ? ' Every period here includes funds with no fund statement, whose money put in is worked out from the start date and SIP.'
            : ' Periods marked est. include funds with no fund statement.')}
      </p>
      <PlTable v={v} />
    </>
  );
}

/* ------------------------------------------------------------------------------------ heat map */

const heatBg = (x: number, max: number) => {
  const k = Math.min(1, Math.abs(x) / (max || 1));
  const share = 14 + Math.round(k * 62);
  return `color-mix(in srgb, ${x >= 0 ? 'var(--viz-good)' : 'var(--viz-bad)'} ${share}%, var(--card))`;
};

export function Heatmap({
  rows,
  kind,
  months,
}: {
  rows: HeatRow[];
  kind: YearKind;
  months: MonthReturn[];
}) {
  const names = kind === 'calendar' ? MON : FY_MON;
  const all = rows.flatMap((r) => r.cells).filter((c): c is number => c !== null);
  const max = Math.max(0.01, ...all.map((c) => Math.abs(c)));
  const partial = new Set(months.filter((m) => m.partial).map((m) => m.month));
  const ymOf = (key: string, slot: number) => {
    const mo = kind === 'calendar' ? slot + 1 : ((slot + 3) % 12) + 1;
    const y = kind === 'calendar' ? Number(key) : Number(key.slice(0, 4)) + (mo < 4 ? 1 : 0);
    return `${y}-${String(mo).padStart(2, '0')}`;
  };
  if (rows.length === 0)
    return <p className="empty">The month grid appears once there are two months of history.</p>;
  return (
    <div className="heat" role="table" aria-label={`Return in each month, by ${kind} year`}>
      <div className="heat-head" role="row">
        <span role="columnheader" className="ycol">
          {kind === 'calendar' ? 'Year' : 'FY'}
        </span>
        {names.map((n) => (
          <span key={n} role="columnheader">
            {n}
          </span>
        ))}
        <span role="columnheader" className="tcol">
          Year
        </span>
      </div>
      {rows.map((r) => (
        <div className="heat-row" role="row" key={r.key}>
          <span role="rowheader" className="ycol">
            {r.key}
          </span>
          {r.cells.map((c, i) => {
            const ym = ymOf(r.key, i);
            return c === null ? (
              <span
                key={i}
                role="cell"
                className="hc none"
                aria-label={`${monthName(ym)}: no figure`}
              >
                ·
              </span>
            ) : (
              <span
                key={i}
                role="cell"
                className={`hc ${partial.has(ym) ? 'part' : ''}`}
                style={{ background: heatBg(c, max) }}
                title={`${monthName(ym)}: ${pct(c, 2)}${partial.has(ym) ? ' (not a full month)' : ''}`}
                aria-label={`${monthName(ym)}: ${pct(c, 2)}`}
              >
                <span className="d">{pct(c, 1).replace('%', '')}</span>
                <span className="i">{`${c >= 0 ? '+' : '−'}${Math.abs(Math.round(c * 100))}`}</span>
              </span>
            );
          })}
          <span
            role="cell"
            className={`hc tcol ${tone(r.total)}`}
            title={r.months < 12 ? `${r.months} months with a figure` : undefined}
          >
            {r.total === null ? '–' : pct(r.total, 1)}
            {r.months < 12 && <sup>*</sup>}
          </span>
        </div>
      ))}
      <p className="cardnote">
        Each cell is the time-weighted return of that month, in per cent; the last column joins the
        months of the year. * marks a year with fewer than twelve months of history. A dotted
        outline marks a month that is not over.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------------------------ best, worst, drawdown, rolling, risk */

export function Extremes({
  bestMonth,
  worstMonth,
  bestYear,
  worstYear,
  kind,
}: {
  bestMonth: { key: string; ret: number } | null;
  worstMonth: { key: string; ret: number } | null;
  bestYear: { key: string; ret: number } | null;
  worstYear: { key: string; ret: number } | null;
  kind: YearKind;
}) {
  const item = (label: string, e: { key: string; ret: number } | null, month: boolean) => (
    <div>
      <dt>{label}</dt>
      <dd className={`v ${e ? tone(e.ret) : ''}`}>{e ? pct(e.ret, 1) : '–'}</dd>
      <dd className="n">
        {e
          ? month
            ? monthName(e.key)
            : kind === 'calendar'
              ? e.key
              : `FY ${e.key}`
          : 'needs more history'}
      </dd>
    </div>
  );
  return (
    <dl className="statgrid" aria-label="Best and worst months and years">
      {item('Best month', bestMonth, true)}
      {item('Worst month', worstMonth, true)}
      {item('Best year', bestYear, false)}
      {item('Worst year', worstYear, false)}
    </dl>
  );
}

export function DrawdownCard({ d }: { d: DrawdownResult }) {
  if (!d.current)
    return (
      <p className="empty">
        The fall from the highest point is shown once there are a few months of history.
      </p>
    );
  const series: PlotSeries[] = [
    {
      key: 'dd',
      name: 'Below the highest point',
      colour: 'var(--viz-bad)',
      area: true,
      areaBase: 0,
      points: d.points.map((p) => ({ date: p.date, value: p.value })),
    },
  ];
  return (
    <>
      <dl className="statgrid" aria-label="Fall from the highest point">
        <div>
          <dt>Deepest fall</dt>
          <dd className={`v ${d.max ? 'fail' : ''}`}>{d.max ? pct(d.max.depth, 1) : 'None'}</dd>
          <dd className="n">
            {d.max
              ? `${niceDate(d.max.peakOn)} to ${niceDate(d.max.troughOn)}`
              : 'the line has only risen'}
          </dd>
        </div>
        <div>
          <dt>Recovered</dt>
          <dd className="v">{d.max ? (d.max.recoveredOn ? 'Yes' : 'Not yet') : '–'}</dd>
          <dd className="n">
            {d.max?.recoveredOn
              ? `by ${niceDate(d.max.recoveredOn)}`
              : d.max
                ? 'still below that peak'
                : ''}
          </dd>
        </div>
        <div>
          <dt>Now</dt>
          <dd className={`v ${d.current.depth < -0.0005 ? 'fail' : 'gain'}`}>
            {d.current.depth < -0.0005 ? pct(d.current.depth, 1) : 'At the high'}
          </dd>
          <dd className="n">
            {d.current.depth < -0.0005
              ? `below the high of ${niceDate(d.current.peakOn)}`
              : 'no fall from the highest point'}
          </dd>
        </div>
      </dl>
      <div style={{ height: 12 }} />
      <PlotChart
        unit="pct"
        caption="How far below its previous highest point the return line has been"
        series={series}
        note="Drawn from the time-weighted return line, so money you add does not hide or cause a fall. Month ends and the start of each period."
      />
    </>
  );
}

export function RollingCard({
  rolling,
  minWindows,
}: {
  rolling: RollingResult[];
  minWindows: number;
}) {
  const lines: PlotSeries[] = rolling
    .filter((r) => r.points.length >= 2)
    .map((r, i) => ({
      key: `r${r.windowMonths}`,
      name: `${r.windowMonths / 12}-year windows`,
      colour: `var(--viz-${i + 1})`,
      points: r.points.map((p) => ({ date: p.date, value: p.value })),
    }));
  if (lines.length === 0)
    return (
      <p className="empty">
        Rolling returns need at least {Math.min(...rolling.map((r) => r.windowMonths)) / 12} year(s)
        of history; they appear as it builds.
      </p>
    );
  return (
    <>
      <PlotChart
        unit="pct"
        caption="Rolling return per year over each holding window"
        series={lines}
        note="Each point is the yearly return of someone who had held for the whole window ending that month."
      />
      <div className="cmpwrap">
        <table className="tbl lines cmp">
          <thead>
            <tr>
              <th>Holding period</th>
              <th className="num">Windows</th>
              <th className="num">Lowest</th>
              <th className="num">Median</th>
              <th className="num">Highest</th>
              <th className="num">Ended above zero</th>
            </tr>
          </thead>
          <tbody>
            {rolling.map((r) => (
              <tr key={r.windowMonths}>
                <td data-label="Holding period">
                  {r.windowMonths / 12} year{r.windowMonths === 12 ? '' : 's'}
                </td>
                <td className="num" data-label="Windows">
                  {r.windows}
                </td>
                {r.min ? (
                  <>
                    <td className={`num ${tone(r.min.ret)}`} data-label="Lowest">
                      {pct(r.min.ret, 1)}
                    </td>
                    <td className={`num ${tone(r.median)}`} data-label="Median">
                      {r.median === null ? '–' : pct(r.median, 1)}
                    </td>
                    <td className={`num ${tone(r.max?.ret ?? null)}`} data-label="Highest">
                      {r.max ? pct(r.max.ret, 1) : '–'}
                    </td>
                    <td className="num" data-label="Ended above zero">
                      {r.positiveShare === null ? '–' : `${Math.round(r.positiveShare * 100)}%`}
                    </td>
                  </>
                ) : (
                  <td className="muted small" colSpan={4}>
                    {r.windows === 0
                      ? 'history too short'
                      : `only ${r.windows} windows; at least ${minWindows} are needed for a summary`}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function RiskCard({ risk, months }: { risk: RiskStats | null; months: number }) {
  if (!risk)
    return (
      <p className="empty">
        Volatility, Sharpe and Sortino need at least {months} months of history; they appear once it
        has built up.
      </p>
    );
  return (
    <>
      <dl className="statgrid" aria-label="Risk figures">
        <div>
          <dt>Volatility</dt>
          <dd className="v">
            {risk.volatility === null ? '–' : `${(risk.volatility * 100).toFixed(1)}%`}
          </dd>
          <dd className="n">spread of monthly returns, per year</dd>
        </div>
        <div>
          <dt>Sharpe ratio</dt>
          <dd className="v">{risk.sharpe === null ? '–' : risk.sharpe.toFixed(2)}</dd>
          <dd className="n">return above the risk-free rate per unit of volatility</dd>
        </div>
        <div>
          <dt>Sortino ratio</dt>
          <dd className="v">{risk.sortino === null ? '–' : risk.sortino.toFixed(2)}</dd>
          <dd className="n">the same, counting only the falls</dd>
        </div>
        <div>
          <dt>Return a year</dt>
          <dd className={`v ${tone(risk.annualReturn)}`}>{pct(risk.annualReturn, 1)}</dd>
          <dd className="n">over these {risk.months} months</dd>
        </div>
      </dl>
      <p className="cardnote">
        From the last {risk.months} monthly returns. The risk-free rate is assumed at{' '}
        {(risk.riskFree * 100).toFixed(1)}% a year (a short government bill); it is a setting, and a
        different rate gives different ratios.
      </p>
    </>
  );
}

export function WhatIfCard({
  w,
  benchName,
  yourValue,
  yourNet,
  yourXirr,
}: {
  w: WhatIf | null;
  benchName: string | null;
  yourValue: number;
  yourNet: number;
  yourXirr: number | null;
}) {
  if (!w)
    return (
      <p className="empty">
        This compares your actual purchases with the same money put into a Nifty 50 index fund on
        the same days. It appears once the benchmark&apos;s prices are loaded.
      </p>
    );
  return (
    <>
      <div className="whatif">
        <div>
          <div className="muted small">Your funds</div>
          <div className="big">{inr(yourValue)}</div>
          <div className={`small ${tone(yourValue - yourNet)}`}>
            {rupees(yourValue - yourNet)} on {inr(yourNet)} put in
          </div>
          <div className="small">
            {yourXirr === null ? '' : `${pct(yourXirr, 1)} a year (XIRR)`}
          </div>
        </div>
        <div>
          <div className="muted small">
            The same money in {benchName ?? 'the benchmark'} (proxy)
          </div>
          <div className="big">{inr(w.value)}</div>
          <div className={`small ${tone(w.gain)}`}>
            {rupees(w.gain)} on {inr(w.netIn)} put in
          </div>
          <div className="small">{w.xirr === null ? '' : `${pct(w.xirr, 1)} a year (XIRR)`}</div>
        </div>
        <div className="diff">
          <div className="muted small">Your funds ahead by</div>
          <div className={`big ${tone(yourValue - w.value)}`}>{rupees(yourValue - w.value)}</div>
          <div className="small">
            {formatInrCompact(Math.abs(yourValue - w.value))}{' '}
            {yourValue >= w.value ? 'more' : 'less'} than the index fund
          </div>
        </div>
      </div>
      <p className="cardnote">
        Each purchase is put into the index fund at that day&apos;s price and each sale taken out of
        it.
        {w.coverage < 0.999 &&
          ` Money put in before the index fund's prices begin (${Math.round((1 - w.coverage) * 100)}%) is left out of the comparison.`}{' '}
        A proxy, not the index itself.
      </p>
    </>
  );
}

export type { PlSeries };
