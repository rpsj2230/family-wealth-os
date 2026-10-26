'use client';

import { useMemo, useState } from 'react';
import {
  RANGES,
  changeOver,
  formatInr,
  formatInrCompact,
  pointsInRange,
  type RangeKey,
} from '@fwos/core';

export interface HistoryPoint {
  date: string;
  value: number;
}

const W = 640;
const H = 220;
const PAD = { l: 8, r: 8, t: 14, b: 22 };

export function HistoryChart({ points, today }: { points: HistoryPoint[]; today: string }) {
  const [range, setRange] = useState<RangeKey>('ALL');
  const shown = useMemo(() => pointsInRange(points, range, today), [points, range, today]);
  const change = changeOver(shown);

  const path = useMemo(() => {
    if (shown.length < 2) return null;
    const xs = shown.map((p) => new Date(p.date + 'T00:00:00Z').getTime());
    const ys = shown.map((p) => p.value);
    const x0 = xs[0]!,
      x1 = xs[xs.length - 1]!;
    const lo = Math.min(...ys),
      hi = Math.max(...ys);
    const span = hi - lo || Math.max(1, Math.abs(hi) * 0.02);
    const sx = (x: number) => PAD.l + ((x - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r);
    const sy = (y: number) =>
      H - PAD.b - ((y - (lo - span * 0.1)) / (span * 1.2)) * (H - PAD.t - PAD.b);
    return {
      d: xs.map((x, i) => `${i ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(ys[i]!).toFixed(1)}`).join(' '),
      lo,
      hi,
    };
  }, [shown]);

  return (
    <section className="card" aria-labelledby="hist">
      <h2 id="hist">Net worth over time</h2>
      <div className="row" role="group" aria-label="Time range">
        {RANGES.map((r) => (
          <button
            key={r}
            type="button"
            className={`btn ${r === range ? 'primary' : ''} compact`}
            onClick={() => setRange(r)}
            aria-pressed={r === range}
          >
            {r === 'ALL' ? 'All' : r}
          </button>
        ))}
      </div>
      {shown.length < 2 || !path ? (
        <p className="muted">
          {shown.length === 0
            ? 'No history yet.'
            : `History starts on ${shown[0]!.date}. A line appears once there are at least two daily snapshots.`}
        </p>
      ) : (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            className="chart"
            aria-label={`Net worth from ${formatInrCompact(shown[0]!.value)} on ${shown[0]!.date} to ${formatInrCompact(shown[shown.length - 1]!.value)} on ${shown[shown.length - 1]!.date}`}
          >
            <path
              d={path.d}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            <text x={PAD.l} y={H - 4} className="axis">
              {shown[0]!.date}
            </text>
            <text x={W - PAD.r} y={H - 4} textAnchor="end" className="axis">
              {shown[shown.length - 1]!.date}
            </text>
            <text x={PAD.l} y={PAD.t} className="axis">
              {formatInrCompact(path.hi)}
            </text>
          </svg>
          {change && (
            <p className="small">
              Change over this period: <strong>{formatInr(change.amount)}</strong>
              {change.pct !== null ? ` (${(change.pct * 100).toFixed(2)}%)` : ''}
            </p>
          )}
        </>
      )}
      <p className="muted small">
        Each point is a daily estimate. A rise combines new money, interest and market movement;
        separating them needs transaction data, which arrives with the mutual-fund statement import.
      </p>
    </section>
  );
}
