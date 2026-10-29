import {
  isCounted,
  moneyAtWork,
  projectGrowth,
  settingsFromJson,
  withPeople,
  type GrowthProjection,
  type MoneyAtWork,
} from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Ctx } from './data';
import { workHoldings, workMoves, type GrowthAsset } from './growth';
import { loadInvestmentView } from './investments';
import { loadPortfolio } from './portfolio-data';

export interface GrowthData {
  today: string;
  work: MoneyAtWork;
  projection: GrowthProjection;
  /** the long-run fund return of the retirement plan, shown beside the funds' own return */
  longRunEquity: number;
  /** names for the age columns, in the order of the projection's ages */
  ageNames: string[];
}

/**
 * Everything the Money at work page reads: the counted holdings and what each is worth (the portfolio), the funds' own returns and
 * SIPs (Investments), the savings and deposit rates and the better offers (Rates), inflation, the SIP step-up and ages (the retirement
 * plan and Settings > People), and the page's own settings (Settings > Money at work).
 */
export async function loadGrowth(supabase: Ctx['supabase']): Promise<GrowthData> {
  const loaded = await loadPortfolio(supabase);
  const today = loaded.today.toISOString().slice(0, 10);
  const [inv, rc, planRow, people] = await Promise.all([
    loadInvestmentView(supabase, loaded),
    loadRatesContext(supabase as unknown as SupabaseClient, { today: loaded.today }),
    supabase.from('plan_settings').select('settings').maybeSingle(),
    supabase.from('owners').select('display_name, dob, plan_role'),
  ]);
  const config = rc.config;
  const plan = withPeople(
    settingsFromJson((planRow.data as { settings?: unknown } | null)?.settings),
    ((people.data ?? []) as { dob: string | null; plan_role: string | null }[]) ?? [],
  );
  const byId = new Map(loaded.assetRows.map((a) => [a.id, a]));
  const bank = loaded.institutionName ?? new Map<string, string>();
  const assets: GrowthAsset[] = loaded.portfolio.valued.filter(isCounted).map((v) => {
    const a = byId.get(v.assetId);
    return {
      id: v.assetId,
      name: v.name,
      ownerId: v.ownerId,
      type: v.type,
      currency: a?.currency ?? 'INR',
      accountKind: a?.account_kind === 'NRE' || a?.account_kind === 'NRO' ? a.account_kind : null,
      bank: a?.institution_id ? (bank.get(a.institution_id) ?? null) : null,
      value: v.estimate?.estimatedAmount ?? 0,
      ownRate: a?.interest_rate ?? null,
      listedRate: a?.listed_rate ?? null,
    };
  });
  const funds = new Map(
    inv.groups.flatMap((g) =>
      g.funds.map((f) => [
        f.assetId,
        { xirr: f.xirr, monthly: f.sipStopped ? 0 : (f.sipMonthly ?? 0) },
      ]),
    ),
  );
  const holdings = workHoldings({
    assets,
    ownerName: loaded.ownerName,
    rateHoldings: rc.holdings,
    funds,
    config,
    longRunEquity: plan.assumptions.equityReturn,
  });
  const work = moneyAtWork({
    holdings,
    inflation: plan.assumptions.inflation,
    goodMargin: config.growth.goodMargin,
    moves: workMoves({ rateHoldings: rc.holdings, offers: rc.offers, config, today }),
  });
  const rows = (people.data ?? []) as {
    display_name: string;
    dob: string | null;
    plan_role: string | null;
  }[];
  const primary = rows.find((p) => p.plan_role === 'primary');
  const spouse = rows.find((p) => p.plan_role === 'spouse');
  return {
    today,
    work,
    projection: projectGrowth({
      work,
      years: config.growth.years,
      steps: config.growth.steps,
      stepUp: plan.annualStepUp,
      today,
      dobs: [plan.primaryDob || null, plan.spouseDob || null],
      longRunFundRate: plan.assumptions.equityReturn,
    }),
    longRunEquity: plan.assumptions.equityReturn,
    ageNames: [primary?.display_name ?? 'You', spouse?.display_name ?? 'Spouse'],
  };
}
