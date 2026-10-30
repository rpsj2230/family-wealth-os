import type { SupabaseClient } from '@supabase/supabase-js';

/** Tables shared by every household (no `household_id` column): market prices, scheme names, exchange rates, the households. */
export const SHARED_TABLES: ReadonlySet<string> = new Set([
  'amfi_schemes',
  'fx_rates',
  'households',
  'mf_navs',
]);

const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);

/**
 * A read-only view of one household through a service-role client, for code written for a signed-in member's client (where Row
 * Level Security limits every read to the household). Every read of a household table gets `household_id = householdId`; the shared
 * tables are read as they are. Writes and database functions are refused, so code given this client can only read. Used by the daily
 * summary job to build Home's model with the page's own loader.
 */
export function householdClient(db: SupabaseClient, householdId: string): SupabaseClient {
  if (!householdId) throw new Error('householdClient: a household is required');
  const from = (table: string) => {
    const q = db.from(table);
    return new Proxy(q, {
      get(target, prop) {
        if (prop === 'select') {
          return (...args: Parameters<typeof target.select>) => {
            const sel = target.select(...args);
            return SHARED_TABLES.has(table) ? sel : sel.eq('household_id', householdId);
          };
        }
        if (typeof prop === 'string' && WRITES.has(prop))
          return () => {
            throw new Error(`householdClient is read-only (${prop} on ${table})`);
          };
        const v: unknown = Reflect.get(target, prop, target);
        return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
      },
    });
  };
  return new Proxy(db, {
    get(target, prop) {
      if (prop === 'from') return from;
      if (prop === 'rpc')
        return () => {
          throw new Error('householdClient is read-only (rpc)');
        };
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}
