import {
  configFromJson,
  mergeRules,
  type AppConfig,
  type TaxRuleRow,
  type TaxRuleSet,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Settings for one household: limits and reminder windows, and the tax rules for every year. */
export async function loadSettings(
  db: SupabaseClient,
  householdId?: string,
): Promise<{ config: AppConfig; rules: TaxRuleSet[] }> {
  const scoped = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return householdId ? q.eq('household_id', householdId) : q;
  };
  const [cfg, rules] = await Promise.all([
    scoped('household_config', 'config').maybeSingle(),
    scoped('tax_rules', '*'),
  ]);
  const raw = (cfg.data as unknown as { config: unknown } | null)?.config;
  return {
    config: configFromJson(raw),
    rules: mergeRules(((rules.data ?? []) as unknown as TaxRuleRow[]) ?? []),
  };
}
