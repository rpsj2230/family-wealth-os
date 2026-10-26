'use client';

/** Open or close every bank at once; each bank can still be opened or closed by itself. */
export function AccordionControls({ label = 'banks' }: { label?: string }) {
  const set = (open: boolean) =>
    document
      .querySelectorAll<HTMLDetailsElement>('details.bankdet')
      .forEach((d) => (d.open = open));
  return (
    <div
      className="row noprint accordionbar"
      role="group"
      aria-label={`Open or close all ${label}`}
    >
      <button type="button" className="btn compact" onClick={() => set(true)}>
        Expand all
      </button>
      <button type="button" className="btn compact" onClick={() => set(false)}>
        Collapse all
      </button>
    </div>
  );
}
