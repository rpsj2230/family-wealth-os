import { cache } from 'react';
import { loadMoneyTrail, type LoadedPortfolio, type MoneyTrailData } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ChainContext } from '@/components/MoneyChainView';
import { loadContext } from '@/lib/data';
import { holdingLabels } from '@/lib/holding-label';
import { loadPortfolio } from '@/lib/portfolio-data';

/** The money trail as the signed-in household sees it, with a label for every holding and every person's name. Once per page. */
export const loadTrailContext = cache(async function loadTrailContext(): Promise<{
  data: MoneyTrailData;
  labels: Record<string, string>;
  names: Record<string, string>;
  /** each holding's bank, for the flow diagram's filters */
  banks: Record<string, string>;
  /** each holding's owner and type, for the flow diagram */
  meta: Record<string, { owner: string; type: string }>;
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
  const bankOf = Object.fromEntries(
    loaded.assetRows
      .filter((a) => a.institution_id && bankName.has(a.institution_id))
      .map((a) => [a.id, bankName.get(a.institution_id!)!]),
  );
  return {
    data,
    labels,
    names: Object.fromEntries(loaded.ownerName),
    banks: bankOf,
    meta: Object.fromEntries(
      loaded.assetRows.map((a) => [a.id, { owner: a.owner_id, type: a.type }]),
    ),
  };
});

/** What the step-by-step trail views need (components/MoneyChainView.tsx), for the signed-in pages. */
export function chainContextOf(t: {
  data: MoneyTrailData;
  labels: Record<string, string>;
  names: Record<string, string>;
}): ChainContext {
  return {
    chain: t.data.chain,
    opts: t.data.traceOptions,
    labels: t.labels,
    names: t.names,
    remitById: t.data.remitById,
    lineHref: (a, l) => `/asset/${a}/line/${l}`,
    assetHref: (a) => `/asset/${a}`,
  };
}
