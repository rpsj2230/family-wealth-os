import type { Metadata } from 'next';
import Link from 'next/link';
import { isDocKind, isThirdPartyNote } from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import { isLinkDoc, rateDocsFor } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadContext } from '@/lib/data';
import { buildSyncRows, type SyncOfferRow, type SyncSourceRow } from '@/lib/rates-sync-view';
import { addBankPage, pasteBankPage, removeThirdPartyRates, syncBank } from './actions';
import { SyncBoard } from './SyncBoard';

export const dynamic = 'force-dynamic';
// each bank is one server call (page reads and the AI), made one after the other from the browser; every call must finish within this
export const maxDuration = 60;

export const metadata: Metadata = { title: 'Sync bank rates' };

export default async function SyncRatesPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const db = supabase as unknown as SupabaseClient;
  const [rc, sources, offers, keys] = await Promise.all([
    loadRatesContext(db),
    db
      .from('rate_sources')
      .select('id, bank, url, kind, last_run_on, last_result, last_docs')
      .eq('enabled', true)
      .order('bank'),
    db.from('rate_offers').select('bank, checked_on, source_kind, source_note'),
    db.from('ai_keys').select('enabled'),
  ]);
  const today = rc.today.toISOString().slice(0, 10);
  const sourceRows: SyncSourceRow[] = ((sources.data ?? []) as Record<string, unknown>[]).map(
    (r) => ({
      id: r.id as string,
      bank: r.bank as string,
      url: r.url as string,
      kind: isDocKind(r.kind) ? r.kind : 'both',
      lastRunOn: (r.last_run_on as string | null) ?? null,
      lastResult: (r.last_result as string | null) ?? null,
      lastDocs: r.last_docs ?? null,
    }),
  );
  const offerRows: SyncOfferRow[] = ((offers.data ?? []) as Record<string, unknown>[]).map((o) => ({
    bank: o.bank as string,
    checkedOn: o.checked_on as string,
    sourceKind: o.source_kind as 'manual' | 'ai',
    sourceNote: (o.source_note as string | null) ?? null,
  }));
  const rows = buildSyncRows({
    sources: sourceRows,
    offers: offerRows,
    today,
    staleDays: rc.config.rates.staleDays,
    registry: (bank) =>
      rateDocsFor(bank).official.map((d) =>
        isLinkDoc(d)
          ? { url: d.page, kind: d.kind ?? 'both' }
          : { url: d.url, kind: d.kind ?? 'both' },
      ),
  });
  const thirdParty = offerRows.filter(
    (o) => o.sourceKind === 'ai' && isThirdPartyNote(o.sourceNote),
  ).length;
  const hasAiKey = ((keys.data ?? []) as { enabled: boolean }[]).some((k) => k.enabled);

  return (
    <>
      <p className="small" style={{ margin: '0 0 8px' }}>
        <Link href="/rates">← Rates</Link>
      </p>
      <PageHead
        title="Sync bank rates"
        subtitle="Read every bank's rates from its own pages, one bank at a time, and see what each bank said."
        pills={[
          { label: `${rows.length} bank${rows.length === 1 ? '' : 's'}`, tone: 'info' },
          { label: `${offerRows.length} rates on file` },
        ]}
        actions={
          <Link className="btn ghost" href="/settings?tab=connections#rates">
            Rate pages in Settings
          </Link>
        }
      />
      <p className="notice" role="note">
        Rates are only ever read from the bank&apos;s own pages. If a page cannot be read, this page
        says so plainly and you can paste the page text instead.
      </p>
      <SyncBoard
        rows={rows}
        hasAiKey={hasAiKey}
        thirdParty={thirdParty}
        settingsHref="/settings?tab=connections#email"
        actions={{
          syncBank,
          pastePage: pasteBankPage,
          addPage: addBankPage,
          removeThirdParty: removeThirdPartyRates,
        }}
      />
    </>
  );
}
