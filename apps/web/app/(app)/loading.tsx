/** Shown at once while the next page is being prepared, so a click always gets an immediate answer. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div className="skeleton" style={{ height: 28, width: '40%', marginBottom: 16 }} />
      <div className="skeleton" style={{ height: 120, marginBottom: 12 }} />
      <div className="skeleton" style={{ height: 220 }} />
    </div>
  );
}
