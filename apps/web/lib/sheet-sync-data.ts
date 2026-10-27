import { buildBankBlocks } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SyncApp, SyncConfig } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { foreignLines } from './accounts-summary';
import type { Ctx } from './data';
import { loanLines } from './others-summary';
import { loadPortfolio } from './portfolio-data';
import { buildSyncAssets } from './sheet-sync-assets';
import type { SheetSyncInfo } from './sheet-sync-status';

type Supabase = Ctx['supabase'];

/** The accounts and figures the sync writes, and how the sheet is laid out (from Settings), read with the signed-in user's own access. */
export async function loadSyncApp(
  supabase: Supabase,
): Promise<{ app: SyncApp; config: SyncConfig }> {
  const db = supabase as unknown as SupabaseClient;
  const [loaded, inst, pos, recv, pays, owners, settings] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name'),
    supabase.from('mf_positions').select('asset_id, fund_name, invested, started_on, sip_stopped'),
    supabase.from('receivables').select('asset_id, counterparty, lent, lent_on, expected_on'),
    supabase.from('receivable_payments').select('asset_id, amount, paid_on'),
    supabase.from('owners').select('id, display_name').order('created_at'),
    loadSettings(db),
  ]);
  const { today, assetRows, obsRows, fdRows, ownerName, portfolio, marketDates } = loaded;
  const institutionName = Object.fromEntries(
    (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: institutionName,
    today,
    hideMaturedAfterDays: loaded.hideMaturedAfterDays,
  });
  const valueOf = new Map(
    portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null]),
  );
  const ownerOf = new Map(assetRows.map((a) => [a.id, a.owner_id]));
  const gifted = new Set(assetRows.filter((a) => a.status === 'gifted').map((a) => a.id));
  const loans = loanLines(
    (recv.data ?? []).map((r) => ({
      assetId: r.asset_id as string,
      counterparty: r.counterparty as string,
      ownerId: ownerOf.get(r.asset_id as string) ?? null,
      gift: gifted.has(r.asset_id as string),
      lent: Number(r.lent),
      lentOn: (r.lent_on as string | null) ?? null,
      expectedOn: (r.expected_on as string | null) ?? null,
      repayments: (pays.data ?? [])
        .filter((p) => p.asset_id === r.asset_id)
        .map((p) => ({ amount: Number(p.amount), on: p.paid_on as string })),
    })),
    today.toISOString().slice(0, 10),
  );
  const names = (owners.data ?? []).map((o) => o.display_name as string);
  return {
    app: {
      assets: buildSyncAssets({
        assets: assetRows,
        blocks,
        fundValue: valueOf,
        positions: (pos.data ?? []).map((p) => ({
          asset_id: p.asset_id as string,
          fund_name: (p.fund_name as string | null) ?? null,
          invested: p.invested === null ? null : Number(p.invested),
          started_on: (p.started_on as string | null) ?? null,
          sip_stopped: !!p.sip_stopped,
        })),
        loans,
        foreign: foreignLines(assetRows, obsRows, valueOf, marketDates.fx),
        ownerName,
        institutionName,
      }),
      owners: names.length > 0 ? names : [...ownerName.values()],
      defaultOwner: names[0] ?? [...ownerName.values()][0] ?? '',
    },
    config: settings.config.sheetSync,
  };
}

/** What the pages show about the connection and the last sync (never the key). */
export async function loadSheetSyncInfo(supabase: Supabase): Promise<SheetSyncInfo> {
  const { data } = await supabase
    .from('integration_settings')
    .select(
      'gsheet_id, gsheet_email, gsheet_key_set, gsheet_tested_at, gsheet_test_ok, gsheet_test_note, gsheet_synced_at, gsheet_sync_ok, gsheet_sync_month, gsheet_sync_note',
    )
    .maybeSingle();
  const r = data as {
    gsheet_id: string | null;
    gsheet_email: string | null;
    gsheet_key_set: boolean | null;
    gsheet_tested_at: string | null;
    gsheet_test_ok: boolean | null;
    gsheet_test_note: string | null;
    gsheet_synced_at: string | null;
    gsheet_sync_ok: boolean | null;
    gsheet_sync_month: string | null;
    gsheet_sync_note: string | null;
  } | null;
  return {
    connected: !!r?.gsheet_id && !!r?.gsheet_key_set,
    hasId: !!r?.gsheet_id,
    keySet: !!r?.gsheet_key_set,
    sheetUrl: r?.gsheet_id ? `https://docs.google.com/spreadsheets/d/${r.gsheet_id}/edit` : null,
    email: r?.gsheet_email ?? null,
    tested: r?.gsheet_tested_at
      ? { at: r.gsheet_tested_at, ok: !!r.gsheet_test_ok, note: r.gsheet_test_note }
      : null,
    last: r?.gsheet_synced_at
      ? {
          at: r.gsheet_synced_at,
          ok: !!r.gsheet_sync_ok,
          month: r.gsheet_sync_month,
          note: r.gsheet_sync_note,
        }
      : null,
  };
}
