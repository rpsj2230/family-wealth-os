import { personStyles } from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { NewMoneyView, parseNmTab } from './NewMoneyView';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'New money' };

export default async function NewMoneyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [rc, owners] = await Promise.all([
    loadRatesContext(supabase as unknown as SupabaseClient),
    supabase.from('owners').select('id, display_name').order('created_at'),
  ]);
  const people = (owners.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
  }));
  return (
    <NewMoneyView
      sp={sp}
      tab={parseNmTab(sp.tab)}
      people={people}
      styles={personStyles(people)}
      offers={rc.offers}
      holdings={rc.holdings}
      prefs={rc.config.rates}
      limit={rc.config.deposits.insuranceLimit}
      today={rc.today.toISOString().slice(0, 10)}
      baselineRate={rc.baselineRate}
      base="/new-money"
      formAction="/new-money"
      ratesHref="/rates"
      banksBase="/rates"
    />
  );
}
