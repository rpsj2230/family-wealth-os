import { loadPositionInput, loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolio } from '@/lib/portfolio-data';
import { createClient } from '@/lib/supabase/server';
import { valuationCsv } from '@/lib/valuation-csv';

export const dynamic = 'force-dynamic';

/** Investments > Value by period as a CSV file, for the same choices as the page. */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response('Sign in first', { status: 401 });
  const url = new URL(request.url);
  const db = supabase as unknown as SupabaseClient;
  const [loaded, settings] = await Promise.all([loadPortfolio(supabase), loadSettings(db)]);
  const position = await loadPositionInput(db, loaded, {
    config: settings.config,
    allPrices: true,
  });
  const q = (k: string) => url.searchParams.get(k);
  return valuationCsv(
    position,
    { g: q('g'), range: q('range'), from: q('from'), to: q('to'), p: q('p') },
    {
      recent: settings.config.funds.valuationPeriods,
      financialQuarters: settings.config.funds.financialQuarters,
    },
    (id) => loaded.ownerName.has(id),
  );
}
