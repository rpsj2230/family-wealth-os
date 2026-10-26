'use client';

import { useEffect } from 'react';
import { recordTodaySnapshot } from './snapshot-actions';

/** Records today's snapshot once per browser session when the dashboard is opened. */
export function SnapshotBeacon() {
  useEffect(() => {
    try {
      const key = 'fwos-snapshot-' + new Date().toISOString().slice(0, 10);
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    } catch {
      /* storage unavailable: still record */
    }
    void recordTodaySnapshot();
  }, []);
  return null;
}
