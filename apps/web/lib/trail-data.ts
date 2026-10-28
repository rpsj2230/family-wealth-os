import { loadMoneyTrail, type LoadedPortfolio, type MoneyTrailData } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { holdingLabels } from '@/lib/holding-label';
import { loadPortfolio } from '@/lib/portfolio-data';

/** The money trail as the signed-in household sees it, with a label for every holding and every person's name. */
export async function loadTrailContext(): Promise<{
  data: MoneyTrailData;
  labels: Record<string, string>;
  names: Record<string, string>;
}> {
  const { supabase } = await loadContext();
  const db = supabase as unknown as SupabaseClient;
  const [loaded, banks] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name'),
  ]);
  const data = await loadMoneyTrail(db, undefined, loaded as unknown as LoadedPortfolio);
  const bankName = new Map(
    ((banks.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
  );
  const fdOf = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  const labels = holdingLabels(
    loaded.assetRows.map((a) => {
      const f = fdOf.get(a.id);
      return {
        id: a.id,
        nickname: a.label || a.nickname,
        owner: loaded.ownerName.get(a.owner_id) ?? '',
        bank: a.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
        last4: a.identifier_last4 ?? null,
        fd: f ? { principal: Number(f.principal), maturityOn: f.maturity_on } : null,
      };
    }),
  );
  return { data, labels, names: Object.fromEntries(loaded.ownerName) };
}
