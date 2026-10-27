'use server';

import { revalidatePath } from 'next/cache';
import { sameBank, THIRD_PARTY_NOTE } from '@fwos/core';
import { aiChainFor, loadSettings, syncBankRates, type SyncBankResult } from '@fwos/data';
import { isDocKind, type DocLine } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { readPastedRatePage } from '../../settings/actions';

/** What one bank's sync did, for the Sync page. */
export interface BankSyncResult {
  bank: string;
  status: SyncBankResult['status'] | 'error';
  /** one plain sentence */
  message: string;
  /** every document read or tried */
  docs: DocLine[];
}

export interface PlainResult {
  ok: boolean;
  message: string;
}

interface SourceRow {
  id: string;
  bank: string;
  url: string;
  kind: string | null;
  page_hash: string | null;
  read_on: string | null;
}

/**
 * Syncs one bank now: the same function the weekly job runs (`syncBankRates`), through the signed-in member's own client, so row level
 * security applies and the service role is never used here. The Sync page calls this once per bank, one after the other, so each call
 * stays inside the time the host allows for the page (see `maxDuration` in the page). The AI keys are fetched through the member-only
 * function the Settings checks use and never leave the server.
 */
export async function syncBank(bank: string): Promise<BankSyncResult> {
  const fail = (message: string): BankSyncResult => ({ bank, status: 'error', message, docs: [] });
  if (typeof bank !== 'string' || bank.length === 0 || bank.length > 80)
    return fail('Unknown bank.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const db = supabase as unknown as SupabaseClient;
  const listed = await db
    .from('rate_sources')
    .select('id, bank, url, kind, page_hash, read_on')
    .eq('enabled', true);
  const rows = ((listed.data ?? []) as SourceRow[]).filter((r) => sameBank(r.bank, bank));
  if (rows.length === 0) return fail('This bank has no rate page listed any more.');
  let ai;
  try {
    ai = await aiChainFor(db, householdId, 'member', {
      // the page waits for this: the whole call must finish well inside the 60 seconds the page allows
      limits: { listMs: 5_000, callMs: 18_000, tries: 2 },
    });
  } catch {
    return fail('The saved AI keys could not be read.');
  }
  const rates = (await loadSettings(db)).config.rates;
  const today = new Date().toISOString().slice(0, 10);
  const r = await syncBankRates({
    db,
    household: householdId,
    bank: rows[0]!.bank,
    sources: rows.map((x) => ({
      id: x.id,
      url: x.url,
      kind: isDocKind(x.kind) ? x.kind : 'both',
      pageHash: x.page_hash,
      readOn: x.read_on,
    })),
    ai,
    settings: { maxAmount: rates.maxAmount, staleDays: rates.staleDays },
    today,
    pageMs: 10_000,
  });
  revalidatePath('/rates');
  revalidatePath('/rates/sync');
  revalidatePath('/settings');
  return { bank: rows[0]!.bank, status: r.status, message: r.message, docs: r.docs };
}

/** Reads rates from text pasted from the bank's page, for a page a program could not open. Marked "pasted by you". */
export async function pasteBankPage(
  bank: string,
  text: string,
  kind: string,
): Promise<PlainResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const listed = await supabase.from('rate_sources').select('id, bank').eq('enabled', true);
  const row = ((listed.data ?? []) as { id: string; bank: string }[]).find((r) =>
    sameBank(r.bank, bank),
  );
  if (!row) return { ok: false, message: 'This bank has no rate page listed any more.' };
  const r = await readPastedRatePage(row.id, text, kind);
  revalidatePath('/rates/sync');
  return r;
}

/** Lists another page for a bank, saying which rates it carries. */
export async function addBankPage(bank: string, url: string, kind: string): Promise<PlainResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const address = url.trim();
  if (!bank || bank.length > 80 || !/^https:\/\/[^\s]+$/.test(address) || address.length > 500)
    return {
      ok: false,
      message: 'Enter the full address of the bank’s own page, starting with https://',
    };
  const { error } = await supabase.from('rate_sources').insert({
    household_id: householdId,
    bank,
    url: address,
    kind: isDocKind(kind) ? kind : 'both',
  });
  if (error) return { ok: false, message: 'That page is already listed, or could not be saved.' };
  revalidatePath('/rates/sync');
  revalidatePath('/settings');
  return { ok: true, message: 'Added. Use Sync on this bank to read it now.' };
}

/**
 * Deletes exactly the rates once saved from comparison websites (read by the AI, with a note starting “Reference only”) for this
 * household. Rates typed by you and rates read from a bank’s own page are untouched.
 */
export async function removeThirdPartyRates(): Promise<PlainResult & { removed: number }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.', removed: 0 };
  const r = await supabase
    .from('rate_offers')
    .delete()
    .eq('household_id', householdId)
    .eq('source_kind', 'ai')
    .like('source_note', `${THIRD_PARTY_NOTE}%`)
    .select('id');
  if (r.error)
    return {
      ok: false,
      message: 'The rates could not be removed. Nothing was changed.',
      removed: 0,
    };
  const removed = (r.data ?? []).length;
  revalidatePath('/rates');
  revalidatePath('/rates/sync');
  return {
    ok: true,
    message:
      removed === 0
        ? 'There were no rates from comparison websites.'
        : `Removed ${removed} rate${removed === 1 ? '' : 's'} that came from comparison websites.`,
    removed,
  };
}
