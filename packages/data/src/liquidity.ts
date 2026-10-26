import {
  addDays,
  answerHard,
  answerRaise,
  buildSources,
  type AppConfig,
  type FundForRaise,
  type HardAnswer,
  type RaiseAnswer,
  type RaiseSource,
  type TaxRuleSet,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { loadSettings } from './settings';

export interface RaiseContext {
  today: string;
  config: AppConfig;
  rules: TaxRuleSet[];
  sources: RaiseSource[];
  ownerName: Map<string, string>;
}

/** Everything the "I need money" planner works from. Works with a signed-in client (RLS) or the service role. */
export async function loadRaiseContext(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<RaiseContext> {
  const l = await loadPortfolioData(db, opts);
  const { config, rules } = await loadSettings(db, opts.householdId);
  const q = db
    .from('mf_positions')
    .select('asset_id, invested, started_on, sip_monthly, sip_stopped');
  const rows = ((await (opts.householdId ? q.eq('household_id', opts.householdId) : q)).data ??
    []) as unknown as {
    asset_id: string;
    invested: number | null;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
  }[];
  const funds: FundForRaise[] = rows.map((r) => ({
    assetId: r.asset_id,
    invested: Number(r.invested ?? 0),
    startedOn: r.started_on,
    sipActive: !!r.sip_monthly && !r.sip_stopped,
  }));
  const today = l.today.toISOString().slice(0, 10);
  const instQ = db.from('institutions').select('id, name');
  const institutionNames = Object.fromEntries(
    (
      ((await (opts.householdId ? instQ.eq('household_id', opts.householdId) : instQ)).data ??
        []) as unknown as { id: string; name: string }[]
    ).map((i) => [i.id, i.name]),
  );
  return {
    today,
    config,
    rules,
    ownerName: l.ownerName,
    sources: buildSources({
      valued: l.portfolio.valued,
      assetRows: l.assetRows,
      fds: l.fdRows,
      funds,
      today,
      institutionNames,
      rules,
      config: config.liquidity,
      nri: config.harvest.nri,
    }),
  };
}

export function raiseAnswer(
  ctx: RaiseContext,
  need: number,
  o: {
    ownerId?: string | null;
    order?: AppConfig['liquidity']['order'];
    mode?: AppConfig['liquidity']['mode'];
  } = {},
): RaiseAnswer {
  return answerRaise(need, ctx.sources, {
    today: ctx.today,
    rules: ctx.rules,
    nri: ctx.config.harvest.nri,
    order: o.order ?? ctx.config.liquidity.order,
    mode: o.mode ?? ctx.config.liquidity.mode,
    ownerId: o.ownerId ?? null,
    scenarioDays: ctx.config.liquidity.scenarioDays,
  });
}

/** "I must have it": every source allowed, as soon as possible; `byDays` is an optional deadline. */
export function hardAnswer(
  ctx: RaiseContext,
  need: number,
  o: { ownerId?: string | null; byDays?: number | null } = {},
): HardAnswer {
  return answerHard(
    need,
    ctx.sources,
    {
      today: ctx.today,
      rules: ctx.rules,
      nri: ctx.config.harvest.nri,
      ownerId: o.ownerId ?? null,
      preferenceOrder: ctx.config.liquidity.order,
    },
    o.byDays ?? null,
  );
}

export { addDays };
