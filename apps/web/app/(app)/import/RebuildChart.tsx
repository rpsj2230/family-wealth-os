'use client';

import { useState } from 'react';
import { rebuildText } from '@/lib/history-view';
import { rebuildHistoryChart } from './history-actions';

/**
 * "Rebuild the history chart": works out net worth for every past month end from the records on file and stores it as a point marked
 * "rebuilt from history". Safe to press again: it only adds, and a day recorded on the day is never touched.
 */
export function RebuildChart({
  months,
  withPoint,
  rebuilt,
  demo = false,
}: {
  /** month ends the records reach back to, before this month */
  months: number;
  /** of those, months that have a point on the chart, and how many of the points are rebuilt */
  withPoint: number;
  rebuilt: number;
  demo?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  async function run() {
    setBusy(true);
    setMessage(null);
    if (demo) {
      setMessage(
        `${rebuildText({ ok: true, written: months - withPoint, planned: months, keptRecorded: 0, from: null })} This is a sample: nothing was saved.`,
      );
      setBusy(false);
      return;
    }
    try {
      const r = await rebuildHistoryChart();
      setMessage(r.message);
    } catch {
      setMessage('The connection stopped. Press the button again.');
    }
    setBusy(false);
  }
  return (
    <div className="cov-rebuild" data-testid="cov-rebuild">
      <p className="small">
        <strong data-testid="cov-chart-summary">
          {withPoint} of {months} {months === 1 ? 'month' : 'months'}
        </strong>{' '}
        before this one {withPoint === 1 ? 'has' : 'have'} a point on the net-worth chart
        {rebuilt > 0 ? ` (${rebuilt} rebuilt from history, the rest recorded on the day)` : ''}.
        Rebuilding works each month end out from the balances, deposit terms and fund units on file;
        a point recorded on the day is never replaced.
      </p>
      <button type="button" className="btn" onClick={run} disabled={busy}>
        {busy ? 'Rebuilding…' : 'Rebuild the history chart'}
      </button>
      {message && (
        <p className="small" role="status" data-testid="cov-rebuild-result">
          {message}
        </p>
      )}
    </div>
  );
}
