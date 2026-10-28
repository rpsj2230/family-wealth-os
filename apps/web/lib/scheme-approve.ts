import { columnExists } from '@fwos/data';
import {
  fetchSchemeHistory,
  type NavRow,
  type SchemeHistoryResult,
  type SchemeHistoryStore,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { schemeByCode } from './scheme-pool';
import type { MatchView } from './match-data';

/**
 * What happens when a person approves a scheme for a fund (docs/UI-GUIDE.md, "Suggest, do not hand back"). Everything goes through the
 * paths the app already has: the member-checked `confirm_scheme_match` function sets the fund's scheme, the fund's own row gets its
 * ISIN, and one scheme's price history is fetched once so the value is there at once. Saying the same thing twice changes nothing;
 * nothing is deleted. The database and the network are passed in, so the rules are tested without either.
 */
export interface ApproveDeps {
  db: SupabaseClient;
  household: string;
  fetchJson(url: string): Promise<unknown>;
}

export interface MatchOutcome {
  ok: boolean;
  message: string;
  /** the scheme whose price history still has to be fetched (one scheme per call, so each stays within the time limit) */
  historyFor?: string;
}

const UUID = /^[0-9a-f-]{36}$/;
const CODE = /^\d{3,8}$/;
const ISIN = /^INF[0-9A-Z]{9}$/;

/** The database function that stores prices may not exist until the database update has run. */
const missingFunction = (e: { code?: string; message: string }) =>
  e.code === 'PGRST202' ||
  e.code === '42883' ||
  /could not find the function|does not exist/i.test(e.message);

/** Stores a scheme's history through the member-checked function (prices are public data written only for a scheme the household holds). */
export function navStore(deps: ApproveDeps): SchemeHistoryStore {
  return {
    async navCount(code) {
      const r = await deps.db
        .from('mf_navs')
        .select('nav_date', { count: 'exact', head: true })
        .eq('amfi_code', code);
      if (r.error) throw new Error(r.error.message);
      return r.count ?? 0;
    },
    async saveNavs(code, rows: NavRow[]) {
      const r = await deps.db.rpc('store_scheme_navs', {
        p_household: deps.household,
        p_code: code,
        p_rows: rows.map((n) => ({ nav_date: n.nav_date, nav: n.nav })),
      });
      if (r.error)
        throw new Error(
          missingFunction(r.error)
            ? 'the database update that stores prices has not run yet'
            : r.error.message,
        );
    },
  };
}

/** Fetches one scheme's price history once (nothing happens when it is already stored). */
export function loadHistory(deps: ApproveDeps, code: string): Promise<SchemeHistoryResult> {
  return fetchSchemeHistory(code, { fetchJson: deps.fetchJson }, navStore(deps));
}

const afterMatch = (fund: string, scheme: string, h: SchemeHistoryResult | null) =>
  `Matched “${fund}” to ${scheme}. ` +
  (h === null
    ? 'Its prices are fetched next.'
    : h.status === 'fetched'
      ? 'Its price history is stored, so the value now follows the market.'
      : h.status === 'already'
        ? 'Its prices were already stored, so the value now follows the market.'
        : h.message);

/**
 * Sets the fund's scheme (and ISIN when the fund has none), clears a "not a listed fund" mark, and, unless `history` is false,
 * fetches that scheme's price history once.
 */
export async function approveMatch(
  deps: ApproveDeps,
  assetId: string,
  code: string,
  opts: { history: boolean } = { history: true },
): Promise<MatchOutcome> {
  if (!UUID.test(assetId) || !CODE.test(code))
    return { ok: false, message: 'That choice is not valid. Reload the page and try again.' };
  const { db, household } = deps;
  const scheme = await schemeByCode(db, code);
  if (!scheme)
    return { ok: false, message: 'That scheme is not in the official list. Choose another one.' };
  const pos = await db
    .from('mf_positions')
    .select('fund_name, isin')
    .eq('asset_id', assetId)
    .eq('household_id', household)
    .limit(1);
  const row = ((pos.data ?? []) as unknown as { fund_name: string; isin: string | null }[])[0];
  if (!row) return { ok: false, message: 'That fund could not be found.' };

  const r = await db.rpc('confirm_scheme_match', {
    p_household: household,
    p_asset: assetId,
    p_code: code,
  });
  if (r.error) return { ok: false, message: 'That could not be saved. Nothing was changed.' };

  // the fund's ISIN is the scheme's own when the fund has none: one already read from a statement is never replaced
  const isin = scheme.isinGrowth ?? scheme.isinReinvest;
  if (!row.isin && isin && ISIN.test(isin))
    await db
      .from('mf_positions')
      .update({ isin })
      .eq('asset_id', assetId)
      .eq('household_id', household)
      .is('isin', null);
  if (await columnExists(db, 'mf_positions', 'no_price_source'))
    await db
      .from('mf_positions')
      .update({ no_price_source: false })
      .eq('asset_id', assetId)
      .eq('household_id', household)
      .eq('no_price_source', true);

  if (!opts.history)
    return { ok: true, message: afterMatch(row.fund_name, scheme.name, null), historyFor: code };
  const h = await loadHistory(deps, code);
  return { ok: true, message: afterMatch(row.fund_name, scheme.name, h) };
}

/** "This is not a listed fund": the fund keeps its last recorded value, labelled "no price source". `on: false` takes the mark off again. */
export async function setNotListed(
  deps: ApproveDeps,
  assetId: string,
  on: boolean,
): Promise<MatchOutcome> {
  if (!UUID.test(assetId))
    return { ok: false, message: 'That choice is not valid. Reload the page and try again.' };
  if (!(await columnExists(deps.db, 'mf_positions', 'no_price_source')))
    return {
      ok: false,
      message:
        'That cannot be saved until the database update that adds it has run. Nothing was changed.',
    };
  let q = deps.db
    .from('mf_positions')
    .update({ no_price_source: on })
    .eq('asset_id', assetId)
    .eq('household_id', deps.household);
  if (on) q = q.is('amfi_code', null);
  const r = await q.select('fund_name');
  if (r.error) return { ok: false, message: 'That could not be saved. Nothing was changed.' };
  const name = ((r.data ?? []) as unknown as { fund_name: string }[])[0]?.fund_name;
  if (!name)
    return {
      ok: false,
      message: on
        ? 'That fund is already matched to a scheme, so it has a price source.'
        : 'That fund could not be found.',
    };
  return {
    ok: true,
    message: on
      ? `“${name}” keeps its last recorded value, labelled “no price source”.`
      : `“${name}” is waiting for a scheme again.`,
  };
}

export interface ApproveAllOutcome {
  ok: boolean;
  message: string;
  /** the schemes whose price history is still to be fetched, one call each */
  codes: string[];
  matched: number;
}

/**
 * Approves every suggestion that is certain (the fund's ISIN is the scheme's ISIN) in one go. The suggestions are worked out again
 * here, never taken from the page, so only what is certain now is applied. Prices are fetched one scheme per call afterwards.
 */
export async function approveAllCertain(
  deps: ApproveDeps,
  view: MatchView,
): Promise<ApproveAllOutcome> {
  const certain = view.rows.filter(
    (r) => !r.amfiCode && r.certainty === 'certain' && r.proposal?.recommended,
  );
  const codes: string[] = [];
  let matched = 0;
  const failed: string[] = [];
  for (const r of certain) {
    const code = r.proposal!.recommended!;
    const out = await approveMatch(deps, r.assetId, code, { history: false });
    if (out.ok) {
      matched++;
      if (!codes.includes(code)) codes.push(code);
    } else failed.push(r.name);
  }
  if (certain.length === 0)
    return { ok: true, message: 'There is no certain match to approve.', codes, matched };
  return {
    ok: failed.length === 0,
    message:
      failed.length === 0
        ? `${matched} fund${matched === 1 ? '' : 's'} matched by ISIN.`
        : `${matched} matched; ${failed.length} could not be saved (${failed.join(', ')}). Nothing else was changed.`,
    codes,
    matched,
  };
}
