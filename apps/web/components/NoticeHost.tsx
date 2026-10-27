'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { clearNotice, getNotice, subscribeNotice } from '@/lib/notice';
import './notice.css';

/** How long the notice stays when nobody closes it. */
const SHOW_MS = 12_000;

/** The notice raised by showNotice(), once per page. It is a status message: read aloud, closable, and gone by itself. */
export function NoticeHost() {
  const n = useSyncExternalStore(subscribeNotice, getNotice, () => null);
  useEffect(() => {
    if (!n) return;
    const t = setTimeout(clearNotice, SHOW_MS);
    return () => clearTimeout(t);
  }, [n]);
  if (!n) return null;
  return (
    <div className="noticebar" role="status" aria-live="polite" data-testid="notice">
      <span>{n.text}</span>
      <button type="button" className="btn compact ghost" onClick={clearNotice}>
        Close
      </button>
    </div>
  );
}
