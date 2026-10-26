import { niceDay, ratePct, type TopRatePoint } from '@fwos/core';
import './rates.css';

const W = 640;
const H = 190;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

const t = (d: string) => Date.parse(`${d}T00:00:00Z`);

/**
 * The bank's best NRE deposit rate and best savings rate over time, drawn as steps (a rate holds until the next change).
 * Plain SVG; the values are also written out in the legend and the table below, so nothing depends on seeing the picture.
 */
export function HistoryChart({ points, today }: { points: TopRatePoint[]; today: string }) {
  const hasFd = points.some((p) => p.fd !== null);
  const hasSv = points.some((p) => p.savings !== null);
  if (points.length === 0 || (!hasFd && !hasSv))
    return (
      <p className="muted small">
        The chart starts when the first rate is logged. Each change you or the refresh makes is
        added.
      </p>
    );
  const vals = points.flatMap((p) => [p.fd, p.savings]).filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...vals) - 0.004) * 200) / 200);
  const hi = Math.ceil((Math.max(...vals) + 0.004) * 200) / 200;
  const t0 = t(points[0]!.date);
  const t1 = Math.max(t(today), t(points[points.length - 1]!.date), t0 + 86_400_000);
  const x = (d: string) => PAD.l + ((t(d) - t0) * (W - PAD.l - PAD.r)) / (t1 - t0);
  const y = (v: number) => H - PAD.b - ((v - lo) * (H - PAD.t - PAD.b)) / (hi - lo || 1);
  const steps = (pick: (p: TopRatePoint) => number | null) => {
    const pts = points.filter((p) => pick(p) !== null);
    if (pts.length === 0) return '';
    let d = '';
    pts.forEach((p, i) => {
      const px = x(p.date);
      const py = y(pick(p)!);
      d += i === 0 ? `M${px.toFixed(1)},${py.toFixed(1)}` : `H${px.toFixed(1)}V${py.toFixed(1)}`;
    });
    // hold the last rate to today
    d += `H${x(today > pts[pts.length - 1]!.date ? today : pts[pts.length - 1]!.date).toFixed(1)}`;
    return d;
  };
  const ticks = [lo, (lo + hi) / 2, hi];
  const last = points[points.length - 1]!;
  const first = points[0]!;
  return (
    <figure style={{ margin: 0 }}>
      <svg
        className="rt-chart"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Best rates over time. Deposit: ${hasFd ? `${ratePct(first.fd ?? last.fd ?? 0)} on ${niceDay(first.date)} to ${last.fd !== null ? ratePct(last.fd) : 'none'} now` : 'none on file'}. Savings: ${last.savings !== null ? ratePct(last.savings) : 'none on file'} now.`}
      >
        {ticks.map((v) => (
          <g key={v}>
            <line className="grid" x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text x={PAD.l - 6} y={y(v) + 4} textAnchor="end">
              {+(v * 100).toFixed(2)}%
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} textAnchor="start">
          {niceDay(points[0]!.date)}
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end">
          {niceDay(today)}
        </text>
        {hasSv && <path className="line-sv" d={steps((p) => p.savings)} />}
        {hasFd && <path className="line-fd" d={steps((p) => p.fd)} />}
        {points.map((p) => (
          <g key={p.date}>
            {p.fd !== null && <circle cx={x(p.date)} cy={y(p.fd)} r="3" fill="var(--primary)" />}
            {p.savings !== null && <circle cx={x(p.date)} cy={y(p.savings)} r="3" fill="#0d9488" />}
          </g>
        ))}
      </svg>
      <figcaption>
        <ul className="rt-legend">
          {hasFd && (
            <li>
              <span
                className="swatch"
                style={{ background: 'var(--primary)' }}
                aria-hidden="true"
              />{' '}
              Best NRE deposit: <b className="num">{last.fd !== null ? ratePct(last.fd) : '–'}</b>{' '}
              now
            </li>
          )}
          {hasSv && (
            <li>
              <span className="swatch" style={{ background: '#0d9488' }} aria-hidden="true" /> Best
              savings (dashed):{' '}
              <b className="num">{last.savings !== null ? ratePct(last.savings) : '–'}</b> now
            </li>
          )}
        </ul>
      </figcaption>
    </figure>
  );
}
