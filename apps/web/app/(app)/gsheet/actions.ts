'use server';

import { revalidatePath } from 'next/cache';
import {
  GoogleSheetsClient,
  parseServiceAccountKey,
  runSheetSync,
  SheetSyncError,
  testSheetConnection,
  type SheetTestResult,
  type SyncResult,
} from '@fwos/ingest';
import { loadContext } from '@/lib/data';
import { loadSyncApp } from '@/lib/sheet-sync-data';
import { sheetIdFrom } from '@/lib/sheet-sync-status';

export interface GsheetFormResult {
  ok: boolean;
  message: string;
}

/** Every call to Google gets its own time limit, well inside the 60 seconds a page may run. */
const CALL_MS = 15_000;
const http = (
  u: string,
  i?: { method?: string; headers?: Record<string, string>; body?: string },
) => fetch(u, { ...i, signal: AbortSignal.timeout(CALL_MS) });

type Ctx = Awaited<ReturnType<typeof loadContext>>;

/**
 * The saved spreadsheet id and key, fetched through a function only household members can call. They are used in this request and
 * never returned: the page receives plain outcomes only.
 */
async function connection(
  ctx: Ctx,
): Promise<{ client: GoogleSheetsClient; spreadsheetId: string } | { error: string }> {
  if (!ctx.householdId) return { error: 'Create your household first.' };
  const { data, error } = await ctx.supabase.rpc('gsheet_credentials', {
    p_household: ctx.householdId,
  });
  if (error) return { error: 'The saved connection could not be read. Try again in a minute.' };
  const row = (data as { sheet_id: string; service_key: string }[] | null)?.[0];
  if (!row)
    return {
      error:
        'Google Sheet is not connected yet. Paste the sheet’s link and the service-account key in Settings > Connections, then test the connection.',
    };
  try {
    return {
      client: new GoogleSheetsClient(parseServiceAccountKey(row.service_key), { fetch: http }),
      spreadsheetId: row.sheet_id,
    };
  } catch (e) {
    return { error: e instanceof SheetSyncError ? e.message : 'The saved key could not be read.' };
  }
}

/** Saves the spreadsheet link and (optionally) the key. The key is write-only: it is checked here, stored on the server and never shown. */
export async function saveGoogleSheet(
  _p: GsheetFormResult | null,
  f: FormData,
): Promise<GsheetFormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const clear = f.get('clear') === 'on';
  const link = String(f.get('sheet') ?? '').trim();
  const keyText = String(f.get('key') ?? '').trim();
  let id: string | null = null;
  if (link !== '') {
    id = sheetIdFrom(link);
    if (!id)
      return {
        ok: false,
        message:
          'That is not the address of a Google Sheet. Open the sheet in your browser and copy the whole address from the address bar; it contains /spreadsheets/d/ followed by a long text.',
      };
  }
  let key: string | null = null;
  let email: string | null = null;
  if (keyText !== '') {
    try {
      const parsed = parseServiceAccountKey(keyText);
      // only what is needed is stored
      key = JSON.stringify({
        type: 'service_account',
        client_email: parsed.clientEmail,
        private_key: parsed.privateKey,
        token_uri: parsed.tokenUri,
      });
      email = parsed.clientEmail;
    } catch (e) {
      return {
        ok: false,
        message: e instanceof SheetSyncError ? e.message : 'The key was not read.',
      };
    }
  }
  const { error } = await supabase.rpc('save_gsheet', {
    p_household: householdId,
    p_sheet_id: id,
    p_key: key,
    p_email: email,
    p_clear: clear,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  revalidatePath('/import');
  revalidatePath('/monthly');
  return {
    ok: true,
    message: clear
      ? 'Saved. The Google Sheet connection and its key are removed.'
      : key
        ? `Saved. The key is stored on the server and cannot be shown again. Share the sheet with ${email} as Editor, then test the connection.`
        : 'Saved.',
  };
}

export interface GsheetTestState extends SheetTestResult {
  ran: true;
  /** set when the test could not start at all (nothing saved, key unreadable) */
  error?: string;
}

/** Tests the saved connection: signs in, reads the tab names, finds the template for this month and checks the right to edit. */
export async function testGoogleSheet(): Promise<GsheetTestState> {
  const ctx = await loadContext();
  const conn = await connection(ctx);
  if ('error' in conn)
    return {
      ok: false,
      steps: [{ ok: false, text: conn.error }],
      target: null,
      template: null,
      monthTabs: [],
      ran: true,
      error: conn.error,
    };
  const { app, config } = await loadSyncApp(ctx.supabase);
  const r = await testSheetConnection({
    api: conn.client,
    spreadsheetId: conn.spreadsheetId,
    now: new Date(),
    app,
    config,
  });
  await ctx.supabase.rpc('record_gsheet_test', {
    p_household: ctx.householdId,
    p_ok: r.ok,
    p_note: r.ok
      ? `Found ${r.monthTabs.length} month tabs; the next sync fills ${r.target ?? 'this month'}`
      : (r.steps.find((s) => !s.ok)?.text ?? 'Failed'),
  });
  revalidatePath('/settings');
  return { ...r, ran: true };
}

/** Preview: reads the sheet and the app and says what a sync would write. Nothing in the spreadsheet is changed. */
export async function previewSheetSync(): Promise<SyncResult> {
  const ctx = await loadContext();
  const conn = await connection(ctx);
  if ('error' in conn) return { ok: false, code: 'no_connection', message: conn.error };
  const { app, config } = await loadSyncApp(ctx.supabase);
  return runSheetSync({
    api: conn.client,
    spreadsheetId: conn.spreadsheetId,
    now: new Date(),
    app,
    config,
    apply: false,
  });
}

/** The real sync. Only one runs at a time; the outcome is remembered for the status cards. */
export async function applySheetSync(): Promise<SyncResult> {
  const ctx = await loadContext();
  const conn = await connection(ctx);
  if ('error' in conn) return { ok: false, code: 'no_connection', message: conn.error };
  const claim = await ctx.supabase.rpc('claim_gsheet_sync', { p_household: ctx.householdId });
  if (claim.error || claim.data !== true)
    return {
      ok: false,
      code: 'busy',
      message:
        'A sync is already running (or ran a moment ago). Wait a minute, then preview again to see where things stand.',
    };
  let result: SyncResult;
  try {
    const { app, config } = await loadSyncApp(ctx.supabase);
    result = await runSheetSync({
      api: conn.client,
      spreadsheetId: conn.spreadsheetId,
      now: new Date(),
      app,
      config,
      apply: true,
    });
  } catch {
    result = {
      ok: false,
      code: 'other',
      message: 'The sync stopped unexpectedly. Preview again before writing.',
    };
  }
  const c = result.ok ? result.view.counts : null;
  await ctx.supabase.rpc('record_gsheet_sync', {
    p_household: ctx.householdId,
    p_ok: result.ok,
    p_month: result.ok ? result.view.target.title : null,
    p_note: result.ok
      ? `${c!.updated} changed, ${c!.added} added, ${c!.cells} cells written`
      : result.message,
  });
  revalidatePath('/settings');
  revalidatePath('/import');
  revalidatePath('/monthly');
  return result;
}
