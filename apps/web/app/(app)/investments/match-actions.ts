'use server';

import { revalidatePath } from 'next/cache';
import { loadSettings } from '@fwos/data';
import { schemeLabel, planOptionText } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadMatchView } from '@/lib/match-data';
import {
  approveAllCertain,
  approveMatch,
  loadHistory,
  setNotListed,
  type ApproveDeps,
} from '@/lib/scheme-approve';
import { searchSchemeList } from '@/lib/scheme-pool';

export interface MatchActionResult {
  ok: boolean;
  message: string;
}

export interface ApproveAllResult extends MatchActionResult {
  /** the schemes whose prices the page fetches next, one call each */
  codes: string[];
}

export interface SchemeHit {
  code: string;
  /** the scheme as a person would write it, with the plan and option */
  name: string;
  detail: string;
  amc: string;
}

/** The same honest user-agent the daily market-data job uses. */
async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { 'user-agent': 'family-wealth-os/1.0 (+personal use)' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

async function deps(): Promise<ApproveDeps | null> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return null;
  return { db: supabase as unknown as SupabaseClient, household: householdId, fetchJson };
}

const refresh = () => {
  revalidatePath('/investments');
  revalidatePath('/');
  revalidatePath('/', 'layout');
};

const NO_HOUSEHOLD = { ok: false, message: 'Create your household first.' };

/**
 * One decision for one fund: a scheme (its AMFI code) or "this is not a listed fund". Approving fetches that scheme's price history
 * once, so the fund's value follows the market at once.
 */
export async function decideFund(
  _prev: MatchActionResult | null,
  f: FormData,
): Promise<MatchActionResult> {
  const d = await deps();
  if (!d) return NO_HOUSEHOLD;
  const asset = String(f.get('asset') ?? '');
  const choice = String(f.get('choice') ?? '');
  const out =
    choice === 'none' ? await setNotListed(d, asset, true) : await approveMatch(d, asset, choice);
  if (out.ok) refresh();
  return { ok: out.ok, message: out.message };
}

/** Takes the "not a listed fund" mark off, so the fund is offered schemes again. */
export async function lookAgain(
  _prev: MatchActionResult | null,
  f: FormData,
): Promise<MatchActionResult> {
  const d = await deps();
  if (!d) return NO_HOUSEHOLD;
  const out = await setNotListed(d, String(f.get('asset') ?? ''), false);
  if (out.ok) refresh();
  return { ok: out.ok, message: out.message };
}

/**
 * Approves every suggestion whose ISIN is the scheme's own. Prices follow, one scheme per call (`fetchPrices`), and the pages are
 * refreshed once at the end (`finishMatching`), so the screen shows the progress until then.
 */
export async function approveCertain(): Promise<ApproveAllResult> {
  const d = await deps();
  if (!d) return { ...NO_HOUSEHOLD, codes: [] };
  const { supabase } = await loadContext();
  const out = await approveAllCertain(d, await loadMatchView(supabase));
  return { ok: out.ok, message: out.message, codes: out.codes };
}

/** Fetches one scheme's price history once (nothing happens when it is already stored). */
export async function fetchPrices(code: string): Promise<MatchActionResult> {
  const d = await deps();
  if (!d) return NO_HOUSEHOLD;
  const h = await loadHistory(d, String(code ?? ''));
  return { ok: h.status !== 'failed', message: h.message };
}

/** Refreshes the pages after matching and price fetching are done. */
export async function finishMatching(): Promise<void> {
  refresh();
}

/** The best schemes for what a person typed (words of the name, an ISIN or an AMFI code). */
export async function searchOfficialSchemes(query: string): Promise<SchemeHit[]> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return [];
  const cfg = (await loadSettings(supabase as unknown as SupabaseClient)).config.funds;
  const found = await searchSchemeList(supabase, String(query ?? ''), cfg.matchSearchResults);
  return found.map((s) => ({
    code: s.code,
    name: schemeLabel(s),
    detail: planOptionText(s),
    amc: s.amc,
  }));
}
