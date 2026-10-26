import { coreTokens, matchFund, type AmfiScheme } from '@fwos/ingest';
import type { Ctx } from './data';

export interface MatchCandidate {
  code: string;
  name: string;
  plan: string;
  amc: string;
  /** how far today's price is from the one in the sheet's note, as a share; a weak sanity check */
  navGap: number | null;
}

export interface MatchRow {
  assetId: string;
  name: string;
  ownerName: string;
  sipMonthly: number | null;
  sipStopped: boolean;
  navHint: number | null;
  amfiCode: string | null;
  lastValue: { amount: number; asOf: string } | null;
  exitLoadFraction: number | null;
  exitLoadDays: number | null;
  /** the best guesses from the official list, for a fund not yet matched */
  candidates: MatchCandidate[];
  /** true when the first candidate is the only clear one */
  confident: boolean;
}

export interface MatchView {
  rows: MatchRow[];
  /** whether the official scheme list has been loaded by the daily market-data job */
  haveList: boolean;
}

/** Every fund with the scheme it is matched to, or suggestions from the official scheme list when it is not. */
export async function loadMatchView(supabase: Ctx['supabase']): Promise<MatchView> {
  const [pos, assets, owners, obs, schemes] = await Promise.all([
    supabase
      .from('mf_positions')
      .select(
        'asset_id, fund_name, sip_monthly, sip_stopped, nav_hint, amfi_code, exit_load_pct, exit_load_days',
      ),
    supabase.from('assets').select('id, owner_id, status'),
    supabase.from('owners').select('id, display_name'),
    supabase
      .from('observations')
      .select('asset_id, amount, as_of')
      .is('superseded_by', null)
      .order('as_of', { ascending: false }),
    supabase.from('amfi_schemes').select('code', { count: 'exact', head: true }),
  ]);
  const ownerOf = new Map((assets.data ?? []).map((a) => [a.id as string, a.owner_id as string]));
  const ownerName = new Map(
    (owners.data ?? []).map((o) => [o.id as string, o.display_name as string]),
  );
  const lastValue = new Map<string, { amount: number; asOf: string }>();
  for (const o of obs.data ?? [])
    if (!lastValue.has(o.asset_id as string))
      lastValue.set(o.asset_id as string, { amount: Number(o.amount), asOf: o.as_of as string });
  const haveList = (schemes.count ?? 0) > 0;
  const positions = pos.data ?? [];

  // Candidate search in the AMFI list (public data stored by the daily job)
  const suggestions = new Map<string, Awaited<ReturnType<typeof matchFund>>>();
  if (haveList) {
    await Promise.all(
      positions
        .filter((f) => !f.amfi_code)
        .map(async (f) => {
          const toks = coreTokens(String(f.fund_name)).slice(0, 2);
          let q = supabase
            .from('amfi_schemes')
            .select('code, name, plan, option, amc, category, isin_growth, isin_reinvest')
            .eq('option', 'Growth');
          for (const t of toks) q = q.ilike('name', `%${t.replace(/(cap)$/, '%$1')}%`);
          const r = await q.limit(400);
          const list: AmfiScheme[] = (r.data ?? []).map((s) => ({
            code: s.code as string,
            isinGrowth: (s.isin_growth as string | null) ?? null,
            isinReinvest: (s.isin_reinvest as string | null) ?? null,
            name: s.name as string,
            plan: (s.plan as 'Direct' | 'Regular' | 'Other') ?? 'Other',
            option: 'Growth',
            nav: null,
            navDate: null,
            amc: (s.amc as string) ?? '',
            category: (s.category as string) ?? '',
          }));
          const hint = f.nav_hint && Number(f.nav_hint) > 0 ? Number(f.nav_hint) : null;
          suggestions.set(f.asset_id as string, matchFund(String(f.fund_name), list, hint));
        }),
    );
  }
  const rows: MatchRow[] = positions.map((f) => {
    const id = f.asset_id as string;
    const sug = suggestions.get(id);
    return {
      assetId: id,
      name: String(f.fund_name),
      ownerName: ownerName.get(ownerOf.get(id) ?? '') ?? '',
      sipMonthly: f.sip_monthly === null ? null : Number(f.sip_monthly),
      sipStopped: !!f.sip_stopped,
      navHint: f.nav_hint && Number(f.nav_hint) > 0 ? Number(f.nav_hint) : null,
      amfiCode: (f.amfi_code as string | null) ?? null,
      lastValue: lastValue.get(id) ?? null,
      exitLoadFraction: f.exit_load_pct === null ? null : Number(f.exit_load_pct),
      exitLoadDays: f.exit_load_days === null ? null : Number(f.exit_load_days),
      candidates: (sug?.candidates ?? []).slice(0, 3).map((c) => ({
        code: c.scheme.code,
        name: c.scheme.name,
        plan: c.scheme.plan,
        amc: c.scheme.amc,
        navGap: c.navGap,
      })),
      confident: sug?.confidence === 'confident',
    };
  });
  return { rows, haveList };
}
