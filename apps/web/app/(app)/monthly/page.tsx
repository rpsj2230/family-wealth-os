import { buildBankBlocks, personStyles } from '@fwos/core';
import { UpdateGrid } from '@/components/UpdateGrid';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';

export const dynamic = 'force-dynamic';

export default async function MonthlyPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio, marketDates }, inst, fx] =
    await Promise.all([
      loadPortfolio(supabase),
      supabase.from('institutions').select('id, name'),
      supabase
        .from('fx_rates')
        .select('currency, rate_date, inr_per_unit')
        .order('rate_date', { ascending: false })
        .limit(20),
    ]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const names = Object.fromEntries(
    (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: names,
    today,
  });
  const fxHint: Record<string, number> = {};
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxHint)) fxHint[r.currency as string] = Number(r.inr_per_unit);
  void marketDates;
  const done = blocks.filter((b) => b.doneThisMonth).length;
  const month = today.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return (
    <>
      <h1>Monthly update · {month}</h1>
      <p className="muted small">
        {done} of {blocks.length} banks have this month&apos;s balances. Type the new balance, press
        Enter for the next one (or paste a column from Excel). Change a note, a deposit&apos;s
        status, or add a new deposit; it all feeds the whole app.
      </p>
      <UpdateGrid
        blocks={blocks}
        styles={styles}
        today={today.toISOString().slice(0, 10)}
        fxHint={fxHint}
        institutions
      />
    </>
  );
}
