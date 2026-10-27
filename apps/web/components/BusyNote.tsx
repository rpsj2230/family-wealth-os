'use client';

import { useEffect, useRef } from 'react';

/**
 * Shown right beside a button while a long server step runs: a moving bar and a sentence saying what is happening, so it is
 * clear the click worked and the page should be left open. It renders nothing when idle.
 */
export function BusyNote({ active, children }: { active: boolean; children: React.ReactNode }) {
  if (!active) return null;
  return (
    <div className="busy-note" role="status" aria-live="polite" data-testid="busy-note">
      <div className="busy-bar" aria-hidden="true">
        <span />
      </div>
      <p className="small">{children}</p>
    </div>
  );
}

/**
 * A result box that scrolls into view (and takes focus for screen readers) when it first appears, because the result of a
 * long step is often far above the button that was pressed.
 */
export function ResultNote({
  tone,
  role,
  children,
}: {
  tone: 'ok' | 'warn';
  role: 'status' | 'alert';
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    ref.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={ref} tabIndex={-1} className={`notice ${tone}`} role={role}>
      {children}
    </div>
  );
}
