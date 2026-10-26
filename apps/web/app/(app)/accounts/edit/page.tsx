import Link from 'next/link';
import { buildBankBlocks, personStyles } from '@fwos/core';
import { AccountEditGrid } from '@/components/AccountEditGrid';
import { gridBanks } from '@/lib/account-edit';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { saveAccountDetails } from './actions';

export const dynamic = 'force-dynamic';

export default async function EditAccountsPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio }, inst] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name').order('name'),
  ]);
  const owners = [...ownerName.entries()].map(([id, name]) => ({ id, name }));
  const styles = personStyles(owners);
  const institutions = (inst.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
  }));
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: Object.fromEntries(institutions.map((i) => [i.id, i.name])),
    today,
  });
  return (
    <>
      <h1>Correct tags and details</h1>
      <p className="muted">
        Fix the type (NRE, NRO…), joint flag, last four digits, label, note, person, bank or status
        of any account or deposit, and a deposit&apos;s rate, dates and amounts. Tick rows to change
        many at once, or use &ldquo;Suggest types for empty rows&rdquo; and check the highlighted
        rows before saving. Balances are not here: they change in the monthly update.
      </p>
      <p>
        <Link href="/accounts">← Back to Accounts</Link>
      </p>
      <AccountEditGrid
        banks={gridBanks(blocks, assetRows, fdRows)}
        owners={owners}
        institutions={institutions}
        styles={styles}
        save={saveAccountDetails}
      />
    </>
  );
}
