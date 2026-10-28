import type { AppConfig, AssetRow, BankBlock, FxOnFile, OverviewOptions } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cashRatesFor, loadOffers } from './rates-view';
import { loadJointHolders } from './quick-edit-data';
import type { Ctx } from './data';

/**
 * The options bankOverview() needs for the whole household, worked out the way the Accounts page works them out, so Home shows the
 * same "earned today" and the same insurance position: each savings account's rate (its own setting, then the bank's listed rate,
 * then the assumed one), banks outside deposit insurance, and the second holder of each joint account.
 */
export async function bankOverviewOptions(args: {
  supabase: Ctx['supabase'];
  blocks: BankBlock[];
  assetRows: AssetRow[];
  institutions: { id: string; deposit_insured?: boolean | null }[];
  config: AppConfig;
  today: Date;
  /** the latest exchange rate on file per currency, to date the rate behind a foreign balance */
  fx?: FxOnFile;
}): Promise<OverviewOptions> {
  const { supabase, blocks, assetRows, institutions, config, today, fx } = args;
  const [offers, jointHolders] = await Promise.all([
    loadOffers(supabase),
    loadJointHolders(supabase as unknown as SupabaseClient),
  ]);
  const cashRates = cashRatesFor(
    blocks.flatMap((b) =>
      b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
    ),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    config.estimates.savingsRate,
  );
  return {
    today,
    soonDays: config.reminders.maturitySoonDays,
    savingsRates: Object.fromEntries(Object.entries(cashRates).map(([id, c]) => [id, c.rate])),
    defaultSavingsRate: config.estimates.savingsRate,
    tdsRate: config.estimates.interestTdsRate,
    insuranceLimit: config.deposits.insuranceLimit,
    uninsuredBanks: new Set(
      institutions.filter((i) => i.deposit_insured === false).map((i) => i.id),
    ),
    jointHolders,
    ...(fx ? { fx } : {}),
  };
}
