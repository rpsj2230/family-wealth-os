'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { inrCompact } from './charts';
import { dayMonth, dayMonthYear, monthYear } from './viz-dates';
import './fundviz.css';

export interface PlotPoint {
  date: string;
  value: number;
}
export interface PlotSeries {
  key: string;
  name: string;
  points: PlotPoint[];
  colour: string;
  /** a faint area down to the baseline (the axis then starts at zero) */
  area?: boolean;
  /** fill towards this value instead of the bottom of the chart (for a line that only falls, such as a drawdown) */
  areaBase?: number;
  dashed?: boolean;
  /** held flat until the next change, for counts such as units */
  step?: boolean;
}
export interface PlotMarker {
  date: string;
  value: number;
  shape: 'dot' | 'up' | 'down';
  colour: string;
  /** read out on hover and by screen readers */
  label: string;
}
export interface PlotRef {
  value: number;
  label: string;
  colour: string;
}
export type PlotUnit = 'inr' | 'pct' | 'nav' | 'units' | 'index';

const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const DAY = 86_400_000;

const fmtAxis = (unit: PlotUnit, v: number) =>
  unit === 'inr'
    ? inrCompact(v)
    : unit === 'pct'
      ? `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`
      : unit === 'nav'
        ? `₹${v.toLocaleString('en-IN', { maximumFractionDigits: v < 100 ? 1 : 0 })}`
        : unit === 'index'
          ? v.toFixed(0)
          : v.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtFull = (unit: PlotUnit, v: number) =>
  unit === 'inr'
    ? `${v < 0 ? '−' : ''}₹${Math.abs(Math.round(v)).toLocaleString('en-IN')}`
    : unit === 'pct'
      ? `${v < 0 ? '−' : '+'}${Math.abs(v * 100).toFixed(1)}%`
      : unit === 'nav'
        ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`
        : unit === 'index'
          ? v.toFixed(1)
          : v.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const longDate = dayMonthYear;

function niceTicks(lo: number, hi: number, n: number): number[] {
  const span = hi - lo || Math.abs(hi) || 1;
  const raw = span / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

/**
 * Lines and areas over time as plain SVG: gridlines, a zero line when needed, labelled reference lines, marker dots and
 * triangles, a crosshair with a read-out of every series (hover, touch or arrow keys), and the same figures as a table.
 * It measures its own width so the text keeps its size on a phone.
 */
export function PlotChart({
  series,
  markers = [],
  refs = [],
  unit,
  caption,
  empty = 'The graph appears once there are at least two dated values.',
  legendMarkers = [],
  note,
}: {
  series: PlotSeries[];
  markers?: PlotMarker[];
  refs?: PlotRef[];
  unit: PlotUnit;
  caption: string;
  empty?: string | undefined;
  legendMarkers?: { label: string; shape: 'dot' | 'up' | 'down'; colour: string }[];
  note?: string | undefined;
}) {
  const id = useId();
  const box = useRef<HTMLElement>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const set = () => setW(Math.max(260, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const m = useMemo(() => {
    const lines = series.filter((s) => s.points.length >= 2);
    if (lines.length === 0) return null;
    const all = lines.flatMap((s) => s.points);
    const x0 = Math.min(...all.map((p) => t(p.date)));
    const x1 = Math.max(...all.map((p) => t(p.date)));
    const vals = [...all.map((p) => p.value), ...refs.map((r) => r.value)];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.08;
    const wantsZero = lines.some((s) => s.area) && lo >= 0;
    lo = wantsZero ? 0 : lo - pad;
    hi = hi + pad;
    if (unit !== 'pct' && lo < 0 && Math.min(...vals) >= 0) lo = 0;
    const dates = [...new Set(lines.flatMap((s) => s.points.map((p) => p.date)))].sort();
    return { lines, x0, x1, lo, hi, dates };
  }, [series, refs, unit]);

  if (!m)
    return (
      <div className="viz-empty" role="note">
        {empty}
      </div>
    );

  const H = w < 460 ? 210 : 260;
  const padL = unit === 'inr' ? 52 : 46;
  const padR = 12;
  const padT = 10;
  const padB = 24;
  const X = (d: string) => padL + ((t(d) - m.x0) / (m.x1 - m.x0 || 1)) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - (v - m.lo) / (m.hi - m.lo || 1)) * (H - padT - padB);
  const yTicks = niceTicks(m.lo, m.hi, w < 460 ? 3 : 4);
  const spanDays = (m.x1 - m.x0) / DAY;
  const nx = w < 460 ? 3 : 5;
  const xTicks = Array.from({ length: nx }, (_, i) =>
    new Date(m.x0 + ((m.x1 - m.x0) * i) / (nx - 1)).toISOString().slice(0, 10),
  );
  const xLabel = (d: string) => (spanDays <= 120 ? dayMonth(d) : monthYear(d));
  const valueAt = (s: PlotSeries, d: string): number | null => {
    let best: PlotPoint | null = null;
    for (const p of s.points) {
      if (p.date > d) break;
      best = p;
    }
    return best ? best.value : null;
  };
  const pathOf = (s: PlotSeries) => {
    const pts = s.points.map((p) => [X(p.date), Y(p.value)] as const);
    if (!s.step) return pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    return pts
      .flatMap(([x, y], i) =>
        i === 0
          ? [[x, y]]
          : [
              [x, pts[i - 1]![1]],
              [x, y],
            ],
      )
      .map(([x, y]) => `${x!.toFixed(1)},${y!.toFixed(1)}`)
      .join(' ');
  };
  const hd = hover !== null ? (m.dates[hover] ?? null) : null;

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    let best = 0;
    let bd = Infinity;
    m.dates.forEach((d, i) => {
      const dist = Math.abs(X(d) - px);
      if (dist < bd) {
        bd = dist;
        best = i;
      }
    });
    setHover(best);
  };
  const key = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      setHover((h) => Math.min(m.dates.length - 1, Math.max(0, (h ?? m.dates.length - 1) + dir)));
    } else if (e.key === 'Escape') setHover(null);
  };

  const tipRows =
    hd === null ? [] : m.lines.map((s) => ({ s, v: valueAt(s, hd) })).filter((r) => r.v !== null);
  const tipMarkers = hd === null ? [] : markers.filter((mk) => mk.date === hd);
  const tipLeft = hd === null ? 0 : Math.min(Math.max(X(hd) - 90, 0), Math.max(0, w - 190));

  const tableDates = (() => {
    const keep = 14;
    if (m.dates.length <= keep) return m.dates;
    return Array.from(
      { length: keep },
      (_, i) => m.dates[Math.round((i * (m.dates.length - 1)) / (keep - 1))]!,
    );
  })();

  const shape = (mk: Pick<PlotMarker, 'shape' | 'colour'>, x: number, y: number, size = 4.5) =>
    mk.shape === 'dot' ? (
      <circle cx={x} cy={y} r={size} fill={mk.colour} stroke="var(--viz-surface)" strokeWidth="2" />
    ) : (
      <path
        d={
          mk.shape === 'up'
            ? `M${x},${y - size - 1} L${x + size + 1},${y + size} L${x - size - 1},${y + size} Z`
            : `M${x},${y + size + 1} L${x + size + 1},${y - size} L${x - size - 1},${y - size} Z`
        }
        fill={mk.colour}
        stroke="var(--viz-surface)"
        strokeWidth="1.5"
      />
    );

  return (
    <figure className="plot" ref={box} aria-label={caption} style={{ position: 'relative' }}>
      <svg
        width={w}
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-labelledby={`${id}-t`}
        aria-describedby={`${id}-d`}
        tabIndex={0}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        <title id={`${id}-t`}>{caption}</title>
        {yTicks.map((v) => (
          <g key={v}>
            <line
              className={v === 0 && unit === 'pct' ? 'zeroline' : 'gridline'}
              x1={padL}
              x2={w - padR}
              y1={Y(v)}
              y2={Y(v)}
            />
            <text className="axis" x={padL - 7} y={Y(v) + 4} textAnchor="end">
              {fmtAxis(unit, v)}
            </text>
          </g>
        ))}
        {xTicks.map((d, i) => (
          <text
            key={d + i}
            className="axis"
            x={X(d)}
            y={H - 6}
            textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
          >
            {xLabel(d)}
          </text>
        ))}
        {m.lines
          .filter((s) => s.area)
          .map((s) => (
            <polygon
              key={`${s.key}-a`}
              points={`${X(s.points[0]!.date)},${Y(s.areaBase ?? m.lo)} ${pathOf(s)} ${X(s.points[s.points.length - 1]!.date)},${Y(s.areaBase ?? m.lo)}`}
              fill={s.colour}
              opacity="0.14"
            />
          ))}
        {refs.map((r) => (
          <g key={r.label}>
            <line
              x1={padL}
              x2={w - padR}
              y1={Y(r.value)}
              y2={Y(r.value)}
              stroke={r.colour}
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text className="reflabel" x={w - padR - 2} y={Y(r.value) - 5} textAnchor="end">
              {r.label}
            </text>
          </g>
        ))}
        {m.lines.map((s) => (
          <polyline
            key={s.key}
            points={pathOf(s)}
            fill="none"
            stroke={s.colour}
            strokeWidth="2"
            strokeDasharray={s.dashed ? '6 5' : undefined}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {markers
          .filter((mk) => t(mk.date) >= m.x0 && t(mk.date) <= m.x1)
          .map((mk, i) => (
            <g key={`${mk.date}-${i}`}>
              <title>{mk.label}</title>
              {shape(mk, X(mk.date), Y(mk.value), markers.length > 30 ? 2.6 : 4)}
            </g>
          ))}
        {hd !== null && (
          <g>
            <line
              x1={X(hd)}
              x2={X(hd)}
              y1={padT}
              y2={H - padB}
              stroke="var(--viz-line)"
              strokeWidth="1"
            />
            {tipRows.map(({ s, v }) => (
              <circle
                key={s.key}
                cx={X(hd)}
                cy={Y(v!)}
                r="4.5"
                fill={s.colour}
                stroke="var(--viz-surface)"
                strokeWidth="2"
              />
            ))}
          </g>
        )}
      </svg>
      {hd !== null && (
        <div className="plot-tip" style={{ left: tipLeft }} aria-hidden="true">
          <div className="tipdate">{longDate(hd)}</div>
          {tipRows.map(({ s, v }) => (
            <div className="tiprow" key={s.key}>
              <span
                className="sw"
                style={{ background: s.colour, width: 10, height: 10, borderRadius: 3 }}
              />
              {s.name}
              <b>{fmtFull(unit, v!)}</b>
            </div>
          ))}
          {tipMarkers.map((mk, i) => (
            <div className="tipnote" key={i}>
              {mk.label}
            </div>
          ))}
        </div>
      )}
      <span id={`${id}-d`} className="sr-only" aria-live="polite">
        {hd === null
          ? ''
          : `${longDate(hd)}: ${tipRows.map(({ s, v }) => `${s.name} ${fmtFull(unit, v!)}`).join(', ')}`}
      </span>
      <ul className="vizlegend">
        {m.lines.map((s) => (
          <li key={s.key}>
            <span
              className={`sw ${s.dashed ? 'dash' : 'line'}`}
              style={{ background: s.colour, color: s.colour }}
              aria-hidden="true"
            />
            {s.name}
          </li>
        ))}
        {refs.map((r) => (
          <li key={r.label}>
            <span className="sw dash" style={{ color: r.colour }} aria-hidden="true" />
            {r.label}
          </li>
        ))}
        {legendMarkers.map((l) => (
          <li key={l.label}>
            <span
              className={`sw ${l.shape === 'dot' ? 'dot' : l.shape === 'down' ? 'tri' : 'dot'}`}
              style={{ background: l.colour, color: l.colour }}
              aria-hidden="true"
            />
            {l.label}
          </li>
        ))}
      </ul>
      {note && <p className="plotnote">{note}</p>}
      <details className="viztable">
        <summary>Show the figures as a table</summary>
        <table>
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              {m.lines.map((s) => (
                <th scope="col" key={s.key}>
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableDates.map((d) => (
              <tr key={d}>
                <td>{longDate(d)}</td>
                {m.lines.map((s) => {
                  const v = valueAt(s, d);
                  return <td key={s.key}>{v === null ? '–' : fmtFull(unit, v)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
