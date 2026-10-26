'use client';

import { useState } from 'react';

/** The exact units as plain digits with a one-tap copy, so they can be pasted into the platform's sell screen. */
export function CopyUnits({ units, fund }: { units: string; fund: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(units);
      setDone(true);
      setTimeout(() => setDone(false), 1800);
    } catch {
      /* the figure is selectable on the page; copying is a convenience */
    }
  }
  return (
    <span className="tx-unitsbox">
      <b className="tx-units num">{units}</b>
      <button
        type="button"
        className="tx-copy"
        onClick={copy}
        aria-label={`Copy ${units} units of ${fund}`}
      >
        {done ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only" role="status">
        {done ? `Copied ${units}` : ''}
      </span>
    </span>
  );
}
