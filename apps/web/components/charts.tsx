/**
 * Small charts drawn as plain SVG, with no chart library: they print, load fast, and read to a screen reader through their labels.
 * Colours are passed in; text and gridlines use the page's own colours so dark mode works.
 */
import type { ReactNode } from 'react';

const compact = (n: number) => {
  const a = Math.abs(n);
  const s = n < 0 ? '−' : '';
  if (a >= 1e7) return `${s}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 2)} Cr`;
  if (a >= 1e5) return `${s}₹${(a / 1e5).toFixed(a >= 1e6 ? 1 : 2)} L`;
  if (a >= 1e3) return `${s}₹${(a / 1e3).toFixed(0)}k`;
  return `${s}₹${Math.round(a)}`;
};
export const inrCompact = compact;

/** A tiny trend line for a table cell or a KPI card. */
export function Sparkline({
  points,
  colour = 'currentColor',
  width = 96,
  height = 28,
  label,
}: {
  points: number[];
  colour?: string;
  width?: number;
  height?: number;
  label: string;
}) {
  if (points.length < 2) return <span className="muted small">–</span>;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const x = (i: number) => 1 + (i * (width - 2)) / (points.length - 1);
  const y = (v: number) => height - 2 - ((v - min) * (height - 4)) / (max - min || 1);
  const d = points.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const up = points[points.length - 1]! >= points[0]!;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={`${label}: ${up ? 'up' : 'down'} from ${compact(points[0]!)} to ${compact(points[points.length - 1]!)}`}
      style={{ display: 'block', color: colour }}
    >
      <polyline
        points={d}
        fill="none"
        stroke={up ? 'var(--ok, #15803d)' : 'var(--bad, #b91c1c)'}
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface Slice {
  label: string;
  value: number;
  colour: string;
  /** where it links to, if anywhere */
  href?: string;
}

/** A ring split into shares, with a legend that lists every share and its amount, so nothing depends on colour alone. */
export function Donut({
  slices,
  size = 168,
  centre,
  caption,
}: {
  slices: Slice[];
  size?: number;
  centre?: { top: string; bottom?: string };
  caption: string;
}) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = size / 2 - 14;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <figure className="donut" aria-label={caption}>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width={size}
        height={size}
        role="img"
        aria-label={caption}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--border, #e5e7eb)"
          strokeWidth="18"
        />
        {total > 0 &&
          slices
            .filter((s) => s.value > 0)
            .map((s) => {
              const len = (s.value / total) * c;
              const el = (
                <circle
                  key={s.label}
                  cx={size / 2}
                  cy={size / 2}
                  r={r}
                  fill="none"
                  stroke={s.colour}
                  strokeWidth="18"
                  strokeDasharray={`${Math.max(0, len - 1.5)} ${c}`}
                  strokeDashoffset={-offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                >
                  <title>{`${s.label}: ${compact(s.value)} (${((s.value / total) * 100).toFixed(1)}%)`}</title>
                </circle>
              );
              offset += len;
              return el;
            })}
        {centre && (
          <>
            <text
              x="50%"
              y={centre.bottom ? '47%' : '52%'}
              textAnchor="middle"
              className="donut-top"
            >
              {centre.top}
            </text>
            {centre.bottom && (
              <text x="50%" y="62%" textAnchor="middle" className="donut-sub">
                {centre.bottom}
              </text>
            )}
          </>
        )}
      </svg>
      <figcaption>
        <ul className="legend">
          {slices
            .filter((s) => s.value > 0)
            .map((s) => (
              <li key={s.label}>
                <span className="swatch" style={{ background: s.colour }} aria-hidden="true" />
                {s.href ? <a href={s.href}>{s.label}</a> : <span>{s.label}</span>}
                <span className="legend-amt">
                  {compact(s.value)}{' '}
                  <span className="muted">
                    {total > 0 ? `${((s.value / total) * 100).toFixed(0)}%` : ''}
                  </span>
                </span>
              </li>
            ))}
        </ul>
      </figcaption>
    </figure>
  );
}

export interface Bar {
  label: ReactNode;
  value: number;
  /** shown under the label */
  sub?: string;
  colour?: string;
  /** a marker on the track, e.g. a limit */
  mark?: number;
}

/** Horizontal bars, longest first, each with its amount. */
export function BarList({
  items,
  max,
  caption,
  format = compact,
}: {
  items: Bar[];
  max?: number;
  caption: string;
  format?: (n: number) => string;
}) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.max(i.value, i.mark ?? 0)));
  return (
    <ul className="barlist" aria-label={caption}>
      {items.map((b, i) => (
        <li key={i}>
          <div className="barhead">
            <span className="barlabel">{b.label}</span>
            <span className="barval">{format(b.value)}</span>
          </div>
          <div className="bartrack" role="presentation">
            <div
              className="barfill"
              style={{
                width: `${Math.min(100, (Math.max(0, b.value) / top) * 100)}%`,
                background: b.colour ?? 'var(--primary, #4f46e5)',
              }}
            />
            {b.mark !== undefined && (
              <div
                className="barmark"
                style={{ left: `${Math.min(100, (b.mark / top) * 100)}%` }}
                title="limit"
              />
            )}
          </div>
          {b.sub && <div className="small muted">{b.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
