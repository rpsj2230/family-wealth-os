import { DEFAULT_CONFIG, currentFy, personStyles, previousFy, type PersonStyle } from '@fwos/core';
import { loadCoverage, loadSettings, pageAll } from '@fwos/data';
import { loadGmailModel } from '@/lib/gmail-statements-data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadAutomation } from '@/lib/automation';
import { loadContext } from '@/lib/data';
import { loadSheetSyncInfo } from '@/lib/sheet-sync-data';
import { holdingLabels } from '@/lib/holding-label';
import { IMPORT_TABS, ImportHub, changeRecord, type ImportData, type ImportTab } from './Hub';
import { HistoryCoverage } from './HistoryCoverage';

export const dynamic = 'force-dynamic';
// the Google Sheet preview and sync wait for Google
export const maxDuration = 60;

export default async function ImportPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab: ImportTab = (IMPORT_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as ImportTab)
    : 'start';
  const { supabase, householdId } = await loadContext();
  const today = new Date().toISOString().slice(0, 10);
  const [owners, batch, cas, tax, auto, sheet] = await Promise.all([
    supabase.from('owners').select('id, display_name, pan_last4, dob').order('created_at'),
    supabase
      .from('import_batches')
      .select('source, as_of, summary, created_at')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('cas_imports')
      .select(
        'id, owner_id, source_ref, schemes, transactions, outcome, detail, changes, created_at',
      )
      .order('created_at', { ascending: false })
      .limit(10),
    supabase
      .from('tax_statements')
      .select('owner_id, fy, kind, read_by, uploaded_on')
      .order('uploaded_on', { ascending: false })
      .limit(40),
    loadAutomation(supabase, today),
    loadSheetSyncInfo(supabase),
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
      changes: changeRecord(c.changes),
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
    sheet,
  };
  // the bank accounts a statement can be for, told apart by bank, name, last digits and whose they are
  if (tab === 'start') {
    const [accts, banks] = await Promise.all([
      supabase
        .from('assets')
        .select('id, owner_id, nickname, label, identifier_last4, institution_id, status')
        .eq('type', 'bank_account')
        .neq('status', 'gifted'),
      supabase.from('institutions').select('id, name'),
    ]);
    const bankName = new Map(
      ((banks.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
    );
    const rows = (accts.data ?? []) as {
      id: string;
      owner_id: string;
      nickname: string;
      label: string | null;
      identifier_last4: string | null;
      institution_id: string | null;
    }[];
    const labels = holdingLabels(
      rows.map((a) => ({
        id: a.id,
        nickname: a.label || a.nickname,
        owner: name.get(a.owner_id) ?? '',
        bank: a.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
        last4: a.identifier_last4,
        fd: null,
      })),
    );
    data.accounts = rows
      .map((a) => ({ id: a.id, label: labels[a.id]!, last4: a.identifier_last4 }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }
  // the Gmail statements card belongs to the Fund statement tab
  if (tab === 'cas') {
    const settings = householdId
      ? await loadSettings(supabase as unknown as SupabaseClient, householdId).catch(() => null)
      : null;
    data.gmail = await loadGmailModel(
      supabase,
      householdId,
      (settings?.config ?? DEFAULT_CONFIG).statementMail,
      ownerRows,
      today,
    ).catch(() => null);
  }
  // how far back the balances and deposits go, month by month (shown under the front door and the workbook tab)
  const coverage =
    householdId && (tab === 'start' || tab === 'workbook')
      ? await loadCoverage(supabase as unknown as SupabaseClient, householdId, today).catch(
          () => null,
        )
      : null;
  // how many month ends the net-worth chart already has a point for (recorded on the day or rebuilt)
  let chart: { withPoint: number; rebuilt: number } | undefined;
  if (coverage && householdId) {
    const snaps = await pageAll<{ taken_on: string; source: string }>((from, to) =>
      supabase.from('snapshots').select('taken_on, source').order('taken_on').range(from, to),
    ).catch(() => []);
    const past = new Set(coverage.months.slice(0, -1));
    const withPoint = new Set(snaps.map((x) => x.taken_on.slice(0, 7)).filter((m) => past.has(m)));
    chart = {
      withPoint: withPoint.size,
      rebuilt: snaps.filter((x) => x.source === 'rebuilt').length,
    };
  }
  const byId = personStyles(ownerRows.map((o) => ({ id: o.id, name: o.name })));
  const people: Record<string, PersonStyle> = {};
  for (const o of ownerRows) if (byId[o.id]) people[o.name] = byId[o.id]!;
  return (
    <>
      <PageHead
        title="Import"
        subtitle="Choose a file and the app works out what it is. Most of this arrives by itself when you forward the email to your Gmail label; use this page when you have the file in hand."
      />
      <ImportHub base="/import" tab={tab} data={data} />
      {coverage && (
        <HistoryCoverage coverage={coverage} people={people} {...(chart ? { chart } : {})} />
      )}
    </>
  );
}
