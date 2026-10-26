'use client';

import { useId, useMemo, useState } from 'react';
import { inrCompact } from './charts';

export interface TrendPoint {
  date: string;
  value: number;
}
export interface TrendSeries {
  name: string;
  points: TrendPoint[];
  colour: string;
  dashed?: boolean;
  /** drawn as a faint area under the line */
  area?: boolean;
}

const RANGES = [
  { key: '3m', label: '3M', days: 92 },
  { key: '6m', label: '6M', days: 183 },
  { key: '1y', label: '1Y', days: 366 },
  { key: 'all', label: 'All', days: Infinity },
] as const;

const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const monthLabel = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    month: 'short',
    year: '2-digit',
    timeZone: 'UTC',
  });

/**
 * One or more lines over time, with a range switch, three value gridlines, date ticks and a hover read-out. Series marked `dashed`
 * (a projection) are drawn after today and are never cut by the range.
 */
export function TrendChart({
  series,
  height = 220,
  caption,
  today,
  defaultRange = '1y',
}: {
  series: TrendSeries[];
  height?: number;
  caption: string;
  today: string;
  defaultRange?: (typeof RANGES)[number]['key'];
}) {
  const [range, setRange] = useState<(typeof RANGES)[number]['key']>(defaultRange);
  const [hover, setHover] = useState<number | null>(null);
  const id = useId();
  const W = 720;
  const padL = 56;
  const padR = 14;
  const padT = 12;
  const padB = 26;

  const model = useMemo(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const from =
      days === Infinity
        ? '0000-01-01'
        : new Date(t(today) - days * 86_400_000).toISOString().slice(0, 10);
    const lines = series.map((s) => ({
      ...s,
      points: s.dashed ? s.points : s.points.filter((p) => p.date >= from),
    }));
    const all = lines.flatMap((l) => l.points);
    if (all.length < 2) return null;
    const x0 = Math.min(...all.map((p) => t(p.date)));
    const x1 = Math.max(...all.map((p) => t(p.date)));
    const ys = all.map((p) => p.value);
    const lo = Math.min(...ys);
    const hi = Math.max(...ys);
    const span = hi - lo || Math.abs(hi) || 1;
    const yMin = Math.max(0, lo - span * 0.08);
    const yMax = hi + span * 0.08;
    return { lines, x0, x1, yMin, yMax };
  }, [series, range, today]);

  if (!model)
    return (
      <div className="trend-empty muted small" role="note">
        The graph appears once there are at least two dated values.
      </div>
    );
  const { lines, x0, x1, yMin, yMax } = model;
  const X = (d: string) => padL + ((t(d) - x0) / (x1 - x0 || 1)) * (W - padL - padR);
  const Y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin || 1)) * (height - padT - padB);
  const grid = [0, 0.5, 1].map((f) => yMin + f * (yMax - yMin));
  const ticks = (() => {
    const n = 5;
    return Array.from({ length: n }, (_, i) =>
      new Date(x0 + ((x1 - x0) * i) / (n - 1)).toISOString().slice(0, 10),
    );
  })();
  const base = lines.find((l) => !l.dashed) ?? lines[0]!;
  const hoverPoint = hover !== null ? base.points[hover] : null;

  return (
    <figure className="trend" aria-label={caption}>
      <div className="trend-tools noprint" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            className={`btn compact ${range === r.key ? 'primary' : 'ghost'}`}
            aria-pressed={range === r.key}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </button>
        ))}
        <span className="trend-read small" aria-live="polite">
          {hoverPoint
            ? `${monthLabel(hoverPoint.date)} · ${new Date(`${hoverPoint.date}T00:00:00Z`).getUTCDate()} · ${inrCompact(hoverPoint.value)}`
            : ''}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        width="100%"
        role="img"
        aria-labelledby={`${id}-t`}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - box.left) / box.width) * W;
          let best = 0;
          let bd = Infinity;
          base.points.forEach((p, i) => {
            const d = Math.abs(X(p.date) - px);
            if (d < bd) {
              bd = d;
              best = i;
            }
          });
          setHover(best);
        }}
      >
        <title id={`${id}-t`}>{caption}</title>
        {grid.map((g, i) => (
          <g key={i}>
            <line
              x1={padL}
              x2={W - padR}
              y1={Y(g)}
              y2={Y(g)}
              stroke="var(--border, #e5e7eb)"
              strokeDasharray="3 4"
            />
            <text x={padL - 8} y={Y(g) + 4} textAnchor="end" className="axis">
              {inrCompact(g)}
            </text>
          </g>
        ))}
        {ticks.map((d, i) => (
          <text
            key={i}
            x={X(d)}
            y={height - 6}
            textAnchor={i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'}
            className="axis"
          >
            {monthLabel(d)}
          </text>
        ))}
        {lines.map((l) => {
          const pts = l.points
            .map((p) => `${X(p.date).toFixed(1)},${Y(p.value).toFixed(1)}`)
            .join(' ');
          if (l.points.length < 2) return null;
          return (
            <g key={l.name}>
              {l.area && (
                <polygon
                  points={`${X(l.points[0]!.date)},${Y(yMin)} ${pts} ${X(l.points[l.points.length - 1]!.date)},${Y(yMin)}`}
                  fill={l.colour}
                  opacity="0.1"
                />
              )}
              <polyline
                points={pts}
                fill="none"
                stroke={l.colour}
                strokeWidth={l.dashed ? 2 : 2.4}
                strokeDasharray={l.dashed ? '6 5' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {hoverPoint && (
          <circle
            cx={X(hoverPoint.date)}
            cy={Y(hoverPoint.value)}
            r="4.5"
            fill={base.colour}
            stroke="var(--card, #fff)"
            strokeWidth="2"
          />
        )}
      </svg>
      <figcaption className="legend inline">
        {lines.map((l) => (
          <span key={l.name}>
            <span
              className="swatch"
              style={{ background: l.colour, opacity: l.dashed ? 0.6 : 1 }}
              aria-hidden="true"
            />
            {l.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
