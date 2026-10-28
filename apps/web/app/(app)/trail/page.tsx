import { redirect } from 'next/navigation';
import { loadMoneyTrail, type LoadedPortfolio } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadAccess, loadContext } from '@/lib/data';
import { holdingLabels } from '@/lib/holding-label';
import { loadPortfolio } from '@/lib/portfolio-data';
import { TrailView } from './TrailView';

export const dynamic = 'force-dynamic';

/** The money trail: where the money in each account and deposit came from, back to Singapore, and whose it was. */
export default async function MoneyTrail({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const { h } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
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
  const owner = (id: string) => loaded.ownerName.get(id) ?? '';
  const labels = holdingLabels(
    loaded.assetRows.map((a) => {
      const f = fdOf.get(a.id);
      return {
        id: a.id,
        nickname: a.label || a.nickname,
        owner: owner(a.owner_id),
        bank: a.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
        last4: a.identifier_last4 ?? null,
        fd: f ? { principal: Number(f.principal), maturityOn: f.maturity_on } : null,
      };
    }),
  );
  const selected = h && data.trails.has(h) ? h : null;
  return (
    <>
      <PageHead
        title="Money trail"
        subtitle="Where the money in each account and deposit came from, back to Singapore, and whose money it was."
      />
      <TrailView
        data={data}
        selected={selected}
        labels={labels}
        names={Object.fromEntries(loaded.ownerName)}
      />
    </>
  );
}
