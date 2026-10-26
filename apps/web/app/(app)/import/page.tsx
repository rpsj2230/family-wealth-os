import { ImportForm, SyncLayoutForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default function ImportPage() {
  const today = new Date().toISOString().slice(0, 10);
  return (
    <>
      <h1>Import your workbook</h1>
      <p className="muted">
        Upload the monthly Excel summary. You will see exactly what will be created and how it
        reconciles with your sheet before anything is saved. Identifiers are reduced to their last 4
        digits. The same file cannot be imported twice.
      </p>
      <SyncLayoutForm today={today} />
      <details className="card">
        <summary>Import a workbook (first time, or a new household)</summary>
        <ImportForm today={today} />
      </details>
    </>
  );
}
