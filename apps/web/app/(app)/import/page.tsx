import { currentFy, previousFy } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { loadAutomation } from '@/lib/automation';
import { loadContext } from '@/lib/data';
import { IMPORT_TABS, ImportHub, type ImportData, type ImportTab } from './Hub';

export const dynamic = 'force-dynamic';

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab: ImportTab = (IMPORT_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as ImportTab)
    : 'workbook';
  const { supabase } = await loadContext();
  const today = new Date().toISOString().slice(0, 10);
  const [owners, batch, cas, tax, auto] = await Promise.all([
    supabase.from('owners').select('id, display_name, pan_last4, dob').order('created_at'),
    supabase
      .from('import_batches')
      .select('source, as_of, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('cas_imports')
      .select('id, owner_id, source_ref, schemes, transactions, outcome, detail, created_at')
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('tax_statements')
      .select('owner_id, fy, kind, read_by, uploaded_on')
      .order('uploaded_on', { ascending: false })
      .limit(40),
    loadAutomation(supabase, today),
  ]);
  const ownerRows = (owners.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
    panLast4: (o.pan_last4 as string | null) ?? null,
    hasDob: !!o.dob,
  }));
  const name = new Map(ownerRows.map((o) => [o.id, o.name]));
  const b = batch.data?.[0];
  const summary = (b?.summary ?? {}) as Record<string, unknown>;
  const counts: Record<string, number> = {};
  for (const [k, v] of Object.entries(summary)) if (typeof v === 'number') counts[k] = v;
  const data: ImportData = {
    today,
    taxFy: previousFy(currentFy(today)),
    owners: ownerRows,
    workbook: b
      ? {
          at: b.created_at as string,
          asOf: b.as_of as string,
          source: String(b.source ?? 'workbook'),
          counts,
        }
      : null,
    cas: (cas.data ?? []).map((c) => ({
      id: c.id as string,
      at: c.created_at as string,
      owner: c.owner_id ? (name.get(c.owner_id as string) ?? null) : null,
      schemes: Number(c.schemes ?? 0),
      transactions: Number(c.transactions ?? 0),
      outcome: c.outcome as 'imported' | 'partial' | 'failed',
      detail: (c.detail as string | null) ?? null,
      fromEmail: !/^(upload|csv):/.test(String(c.source_ref ?? '')),
    })),
    tax: (tax.data ?? []).map((t) => ({
      owner: name.get(t.owner_id as string) ?? '?',
      fy: t.fy as string,
      kind: t.kind as '26as' | 'ais',
      readBy: t.read_by as 'rules' | 'ai',
      uploadedOn: t.uploaded_on as string,
    })),
    email: auto.cards.find((c) => c.key === 'email') ?? null,
  };
  return (
    <>
      <PageHead
        title="Import"
        subtitle="Bring in data from a file. Most of it arrives by itself when you forward the email to your Gmail label; use this page when you have the file in hand."
      />
      <ImportHub base="/import" tab={tab} data={data} />
    </>
  );
}
