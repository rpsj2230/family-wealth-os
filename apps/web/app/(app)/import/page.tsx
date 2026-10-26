import { loadContext } from '@/lib/data';
import { CasForm, ImportForm, SyncLayoutForm } from './ImportForm';

export const dynamic = 'force-dynamic';

export default async function ImportPage() {
  const { supabase } = await loadContext();
  const owners = (
    (await supabase.from('owners').select('id, display_name').order('created_at')).data ?? []
  ).map((o) => ({ id: o.id as string, name: o.display_name as string }));
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
      <section className="card">
        <h2>Fund statements (CAS)</h2>
        <p className="muted small">
          Forward the statement e-mail to your inbox label and it is imported by itself, opened with
          the PAN saved in Settings (so request the statement with your PAN as its password). Or
          upload the PDF here and type its password. Either way every transaction is kept, so
          tax-gain harvesting uses your real purchase dates and gains.
        </p>
        <CasForm owners={owners} />
      </section>
      <details className="card">
        <summary>Import a workbook (first time, or a new household)</summary>
        <ImportForm today={today} />
      </details>
    </>
  );
}
