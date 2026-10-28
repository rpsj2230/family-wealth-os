/* eslint-disable no-console */
/**
 * Daily market-data job: AMFI scheme list, NAVs for the funds you hold, and FX rates.
 * Runs in GitHub Actions with the project URL and the service-role key (a GitHub secret; it never reaches the browser).
 */
import { createClient } from '@supabase/supabase-js';
import { runDailyValuation, syncSipEstimates } from '@fwos/data';
import { configFromJson, DEFAULT_CONFIG } from '@fwos/core';
import { parseNavHint, refreshMarketData, type MarketIo, type MarketStore } from '@fwos/ingest';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

const store: MarketStore = {
  async unmatchedPositions() {
    const rows = must(
      await db
        .from('mf_positions')
        .select('asset_id, fund_name, nav_hint, isin')
        .is('amfi_code', null),
      'unmatched positions',
    );
    return rows.map((r) => ({
      assetId: r.asset_id as string,
      name: r.fund_name as string,
      navHint: parseNavHint(r.nav_hint as string | null),
      isin: (r.isin as string | null) ?? null,
    }));
  },
  async setAmfiCode(assetId, code) {
    must(
      await db.from('mf_positions').update({ amfi_code: code }).eq('asset_id', assetId),
      'set scheme',
    );
  },
  async heldCodes() {
    const rows = must(
      await db.from('mf_positions').select('amfi_code').not('amfi_code', 'is', null),
      'held codes',
    );
    return rows.map((r) => r.amfi_code as string);
  },
  async benchmarkCodes() {
    // the index fund each household compares its funds with (Settings keeps it in the saved configuration)
    const rows = must(
      await db.from('household_config').select('config'),
      'household configuration',
    );
    const codes = rows.map(
      (r) => configFromJson((r as { config: unknown }).config).funds.benchmarkCode,
    );
    return [
      ...new Set((rows.length > 0 ? codes : [DEFAULT_CONFIG.funds.benchmarkCode]).filter(Boolean)),
    ];
  },
  async navCount(code) {
    // only prices from the full-history source count: the daily rows of a fund whose back-fill failed must not hide that
    const r = await db
      .from('mf_navs')
      .select('nav_date', { count: 'exact', head: true })
      .eq('amfi_code', code)
      .eq('source', 'mfapi');
    if (r.error) throw new Error(`nav count: ${r.error.message}`);
    return r.count ?? 0;
  },
  async navFirst(code) {
    const r = await db
      .from('mf_navs')
      .select('nav_date')
      .eq('amfi_code', code)
      .order('nav_date', { ascending: true })
      .limit(1);
    if (r.error) throw new Error(`nav first: ${r.error.message}`);
    return (r.data?.[0]?.nav_date as string | undefined) ?? null;
  },
  async currencies() {
    const rows = must(
      await db.from('assets').select('currency').neq('currency', 'INR'),
      'currencies',
    );
    return rows.map((r) => r.currency as string);
  },
  async fxCount(currency) {
    const r = await db
      .from('fx_rates')
      .select('rate_date', { count: 'exact', head: true })
      .eq('currency', currency);
    if (r.error) throw new Error(`fx count: ${r.error.message}`);
    return r.count ?? 0;
  },
  async upsertSchemes(rows) {
    must(await db.from('amfi_schemes').upsert(rows, { onConflict: 'code' }), 'upsert schemes');
  },
  async upsertNavs(rows) {
    // mf_navs has a foreign key to amfi_schemes; the scheme list is always loaded first in the same run.
    must(
      await db.from('mf_navs').upsert(rows, { onConflict: 'amfi_code,nav_date' }),
      'upsert navs',
    );
  },
  async upsertFx(rows) {
    must(await db.from('fx_rates').upsert(rows, { onConflict: 'currency,rate_date' }), 'upsert fx');
  },
};

async function get(u: string) {
  const res = await fetch(u, {
    headers: { 'user-agent': 'family-wealth-os/1.0 (+personal use)' },
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`${u} answered ${res.status}`);
  return res;
}
const io: MarketIo = {
  fetchText: async (u) => (await get(u)).text(),
  fetchJson: async (u) => (await get(u)).json(),
};

const today = new Date().toISOString().slice(0, 10);
const report = await refreshMarketData(store, io, today);
console.log(JSON.stringify(report, null, 2));
if (report.warnings.length) console.log(`::warning::${report.warnings.length} warnings (see log)`);

// instalments assumed from each SIP since the units were counted are kept in the ledger as estimates, and follow the new prices
try {
  const sip = await syncSipEstimates(db, { today: new Date(`${today}T00:00:00Z`) });
  console.log(
    `SIP estimates: ${sip.added} added, ${sip.removed} removed across ${sip.funds} funds`,
  );
} catch (e) {
  console.log(`::warning::SIP estimates could not be updated: ${(e as Error).message}`);
}

// the day's valuation: every household valued by the central engine with the new prices, and the day's net worth stored, so the
// history grows every day whether or not anyone opens the app (totals only in the log)
try {
  const v = await runDailyValuation(db, { today: new Date(`${today}T00:00:00Z`) });
  console.log(`Daily valuation: ${v.saved} of ${v.households} households saved`);
  for (const f of v.failed)
    console.log(`::warning::valuation of household ${f.household} failed: ${f.message}`);
} catch (e) {
  console.log(`::warning::daily valuation could not run: ${(e as Error).message}`);
}
