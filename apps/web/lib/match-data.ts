import { addDaysIso, type Proposal } from '@fwos/core';
import { columnExists, loadSettings } from '@fwos/data';
import {
  parseHistory,
  schemeProposal,
  suggestSchemes,
  type FundPrice,
  type KnownIsin,
  type SchemeCertainty,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';
import { schemesForFund } from './scheme-pool';

export interface MatchRow {
  assetId: string;
  name: string;
  ownerName: string;
  sipMonthly: number | null;
  sipStopped: boolean;
  amfiCode: string | null;
  /** the official name of the scheme the fund is matched to */
  schemeName: string | null;
  lastValue: { amount: number; asOf: string } | null;
  exitLoadFraction: number | null;
  exitLoadDays: number | null;
  folioLast4: string | null;
  units: number | null;
  invested: number | null;
  isin: string | null;
  /** sold: nothing to price */
  closed: boolean;
  /** the person said this is not a listed fund: it keeps its last recorded value, labelled "no price source" */
  noPriceSource: boolean;
  /** what I found / what I suggest and why / approve / other choices, for a fund with no scheme yet (null once matched) */
  proposal: Proposal | null;
  /** how sure the recommended scheme is; null when nothing is recommended */
  certainty: SchemeCertainty | null;
}

export interface MatchView {
  rows: MatchRow[];
  /** whether the official scheme list has been loaded by the daily market-data job */
  haveList: boolean;
  /** whether the database has the "not a listed fund" mark yet (the update that adds it may not have run) */
  canMark: boolean;
}

const ISIN_KEY = /^INF[0-9A-Z]{9}$/i;

/** Every fund with the scheme it is matched to, or a suggestion from the official scheme list when it is not. */
export async function loadMatchView(supabase: Ctx['supabase']): Promise<MatchView> {
  const db = supabase as unknown as SupabaseClient;
  const canMark = await columnExists(db, 'mf_positions', 'no_price_source');
  const [pos, assets, owners, obs, schemes, settings, links] = await Promise.all([
    supabase
      .from('mf_positions')
      .select(
        `asset_id, fund_name, sip_monthly, sip_stopped, amfi_code, exit_load_pct, exit_load_days, folio_last4, units, invested, isin, plan_type${canMark ? ', no_price_source' : ''}`,
      ),
    supabase.from('assets').select('id, owner_id, status'),
    supabase.from('owners').select('id, display_name'),
    supabase
      .from('observations')
      .select('asset_id, amount, as_of')
      .is('superseded_by', null)
      .order('as_of', { ascending: false }),
    supabase.from('amfi_schemes').select('code', { count: 'exact', head: true }),
    loadSettings(db),
    // ISINs read from fund statements already on file (the folio links keep a scheme's ISIN as their key); absent before that update
    supabase.from('fund_folio_links').select('asset_id, scheme_key'),
  ]);
  const ownerOf = new Map((assets.data ?? []).map((a) => [a.id as string, a.owner_id as string]));
  const statusOf = new Map((assets.data ?? []).map((a) => [a.id as string, a.status as string]));
  const ownerName = new Map(
    (owners.data ?? []).map((o) => [o.id as string, o.display_name as string]),
  );
  const lastValue = new Map<string, { amount: number; asOf: string }>();
  for (const o of obs.data ?? [])
    if (!lastValue.has(o.asset_id as string))
      lastValue.set(o.asset_id as string, { amount: Number(o.amount), asOf: o.as_of as string });
  const haveList = (schemes.count ?? 0) > 0;
  const positions = (pos.data ?? []) as unknown as Record<string, unknown>[];
  const cfg = settings.config.funds;

  const statementIsins = new Map<string, string[]>();
  for (const l of (links.error ? [] : (links.data ?? [])) as unknown as {
    asset_id: string;
    scheme_key: string;
  }[])
    if (ISIN_KEY.test(l.scheme_key))
      statementIsins.set(l.asset_id, [
        ...(statementIsins.get(l.asset_id) ?? []),
        l.scheme_key.toUpperCase(),
      ]);

  // the official name of every scheme a fund is already matched to
  const codes = [
    ...new Set(positions.map((p) => p.amfi_code as string | null).filter((c): c is string => !!c)),
  ];
  const nameOf = new Map<string, string>();
  if (codes.length > 0) {
    const r = await supabase
      .from('amfi_schemes')
      .select('code, name, plan, option')
      .in('code', codes);
    for (const s of (r.data ?? []) as unknown as { code: string; name: string }[])
      nameOf.set(s.code, s.name);
  }

  const rows: MatchRow[] = await Promise.all(
    positions.map(async (f): Promise<MatchRow> => {
      const id = f.asset_id as string;
      const code = (f.amfi_code as string | null) ?? null;
      const marked = canMark && f.no_price_source === true;
      const isin = (f.isin as string | null) ?? null;
      const base: MatchRow = {
        assetId: id,
        name: String(f.fund_name),
        ownerName: ownerName.get(ownerOf.get(id) ?? '') ?? '',
        sipMonthly: f.sip_monthly === null ? null : Number(f.sip_monthly),
        sipStopped: !!f.sip_stopped,
        amfiCode: code,
        schemeName: code ? (nameOf.get(code) ?? null) : null,
        lastValue: lastValue.get(id) ?? null,
        exitLoadFraction: f.exit_load_pct === null ? null : Number(f.exit_load_pct),
        exitLoadDays: f.exit_load_days === null ? null : Number(f.exit_load_days),
        folioLast4: (f.folio_last4 as string | null) ?? null,
        units: f.units === null || f.units === undefined ? null : Number(f.units),
        invested: f.invested === null || f.invested === undefined ? null : Number(f.invested),
        isin,
        closed: statusOf.get(id) === 'closed',
        noPriceSource: marked,
        proposal: null,
        certainty: null,
      };
      // a matched fund, one the person marked as not listed, or a sold one needs no suggestion
      if (code || marked || base.closed || !haveList) return base;
      const known: KnownIsin[] = [
        ...(isin && ISIN_KEY.test(isin) ? [{ isin, source: 'fund' as const }] : []),
        ...(statementIsins.get(id) ?? [])
          .filter((i) => i !== isin?.toUpperCase())
          .map((i) => ({ isin: i, source: 'statement' as const })),
      ];
      const plan = f.plan_type as string | null;
      const fund = {
        assetId: id,
        name: base.name,
        isins: known,
        planType: plan === 'direct' || plan === 'regular' ? plan : null,
        folioLast4: base.folioLast4,
      } as const;
      const pool = await schemesForFund(supabase, {
        name: base.name,
        isins: known.map((k) => k.isin),
      });
      let s = suggestSchemes(fund, pool, { maxChoices: cfg.matchChoices });
      // the name fits several schemes: the price a unit of the value last recorded tells them apart
      const last = lastValue.get(id);
      const price: FundPrice | null =
        last && base.units && base.units > 0
          ? { asOf: last.asOf, value: last.amount, units: base.units }
          : null;
      if (!s.recommended && price && s.choices.length > 1) {
        const from = addDaysIso(price.asOf, -cfg.matchPriceDays);
        const navs = new Map(
          await Promise.all(
            s.choices.map(
              async (c) =>
                [
                  c.scheme.code,
                  await navsBetween(supabase, c.scheme.code, from, price.asOf),
                ] as const,
            ),
          ),
        );
        s = suggestSchemes({ ...fund, price }, pool, {
          maxChoices: cfg.matchChoices,
          navsNear: (code) => navs.get(code) ?? [],
          priceTolerance: cfg.matchPriceTolerance,
        });
      }
      return {
        ...base,
        proposal: schemeProposal(fund, s),
        certainty: s.recommended?.certainty ?? null,
      };
    }),
  );
  return { rows, haveList, canMark };
}

/**
 * A scheme's official prices between two days: those already stored, else the public price list the nightly job reads (kept for a
 * day). Nothing when neither answers: the suggestion then simply does not use prices.
 */
async function navsBetween(
  supabase: Ctx['supabase'],
  code: string,
  from: string,
  to: string,
): Promise<{ date: string; nav: number }[]> {
  const stored = await supabase
    .from('mf_navs')
    .select('nav_date, nav')
    .eq('amfi_code', code)
    .gte('nav_date', from)
    .lte('nav_date', to);
  const rows = (stored.data ?? []) as { nav_date: string; nav: number }[];
  if (!stored.error && rows.length)
    return rows.map((r) => ({ date: r.nav_date, nav: Number(r.nav) }));
  try {
    const res = await fetch(`https://api.mfapi.in/mf/${code}`, {
      next: { revalidate: 86_400 },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return [];
    return parseHistory(await res.json(), code, from)
      .filter((r) => r.nav_date <= to)
      .map((r) => ({ date: r.nav_date, nav: r.nav }));
  } catch {
    return [];
  }
}
