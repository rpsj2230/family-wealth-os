/** Money invested over time (purchases less sales, cumulative), drawn as a plain SVG line so it needs no chart library. */
export function ContributionChart({ points }: { points: { month: string; cumulative: number }[] }) {
  if (points.length < 2) return null;
  const W = 640;
  const H = 120;
  const pad = 6;
  const max = Math.max(...points.map((p) => p.cumulative), 1);
  const min = Math.min(...points.map((p) => p.cumulative), 0);
  const x = (i: number) => pad + (i * (W - 2 * pad)) / (points.length - 1);
  const y = (v: number) => H - pad - ((v - min) * (H - 2 * pad)) / (max - min || 1);
  const line = points.map((p, i) => `${x(i).toFixed(1)},${y(p.cumulative).toFixed(1)}`).join(' ');
  const area = `${pad},${H - pad} ${line} ${W - pad},${H - pad}`;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <figure style={{ margin: '8px 0 0' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Money invested in funds, from ${first.month} to ${last.month}, now ${last.cumulative.toLocaleString('en-IN')} rupees`}
        style={{ width: '100%', height: 'auto', display: 'block' }}
      >
        <polygon points={area} fill="currentColor" opacity="0.08" />
        <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" />
      </svg>
      <figcaption className="small muted">
        Money invested in funds over time ({first.month} to {last.month}), less what was withdrawn.
      </figcaption>
    </figure>
  );
}
