/** A value over time as a plain SVG line, with its range written out for anyone who cannot see the picture. */
export function HistoryLine({
  points,
  label,
  money = true,
}: {
  points: { date: string; value: number }[];
  /** what the line shows, e.g. "Balance" */
  label: string;
  money?: boolean;
}) {
  if (points.length < 2)
    return (
      <p className="detail-empty">
        Not enough history yet for a chart ({points.length} value recorded).
      </p>
    );
  const W = 640;
  const H = 150;
  const padL = 8;
  const padR = 8;
  const padT = 8;
  const padB = 20;
  const t0 = Date.parse(`${points[0]!.date}T00:00:00Z`);
  const t1 = Date.parse(`${points[points.length - 1]!.date}T00:00:00Z`);
  const lo = Math.min(...points.map((p) => p.value));
  const hi = Math.max(...points.map((p) => p.value));
  const x = (d: string) =>
    padL + ((Date.parse(`${d}T00:00:00Z`) - t0) * (W - padL - padR)) / (t1 - t0 || 1);
  const y = (v: number) => H - padB - ((v - lo) * (H - padT - padB)) / (hi - lo || 1);
  const line = points.map((p) => `${x(p.date).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const fmt = (v: number) =>
    money
      ? `₹${Math.round(v).toLocaleString('en-IN')}`
      : v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="historyline"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label} from ${first.date} (${fmt(first.value)}) to ${last.date} (${fmt(last.value)}); lowest ${fmt(lo)}, highest ${fmt(hi)}`}
      >
        <line className="axis" x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} />
        <polygon
          points={`${padL},${H - padB} ${line} ${W - padR},${H - padB}`}
          fill="currentColor"
          opacity="0.08"
        />
        <polyline
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx={x(last.date)} cy={y(last.value)} r="3.5" fill="currentColor" />
        <text x={padL} y={H - 5}>
          {first.date}
        </text>
        <text x={W - padR} y={H - 5} textAnchor="end">
          {last.date}
        </text>
        <text x={W - padR} y={padT + 6} textAnchor="end">
          {fmt(hi)}
        </text>
        <text x={W - padR} y={H - padB - 4} textAnchor="end">
          {fmt(lo)}
        </text>
      </svg>
      <figcaption className="small muted">
        {label}: {fmt(first.value)} on {first.date}, {fmt(last.value)} on {last.date} (
        {points.length} values).
      </figcaption>
    </figure>
  );
}
