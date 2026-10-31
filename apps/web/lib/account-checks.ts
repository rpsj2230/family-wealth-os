import { cache } from 'react';
import {
  accountChecks,
  loadSettings,
  loadStatements,
  positionFor,
  statementPicture,
  type AccountCheck,
  type LoadedPortfolio,
} from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';

/**
 * Every bank account's check (what its lines reach, which need an answer), for Monthly update and the account page: the statement
 * lines sorted by the rules, without the whole money trail, so the page stays quick. Once per page.
 */
export const loadAccountChecks = cache(async function loadAccountChecks(): Promise<{
  checks: Record<string, AccountCheck>;
  ownNames: string[];
}> {
  const { supabase } = await loadContext();
  const db = supabase as unknown as SupabaseClient;
  const [loaded, stored, { config }] = await Promise.all([
    loadPortfolio(supabase) as unknown as Promise<LoadedPortfolio>,
    loadStatements(db),
    loadSettings(db),
  ]);
  const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
  return {
    checks: accountChecks({
      lines: stored.lines,
      classified: new Map(picture.classified.map((c) => [c.id, c])),
    }),
    ownNames: [...loaded.ownerName.values()],
  };
});
