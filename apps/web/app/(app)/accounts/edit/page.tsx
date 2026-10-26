import { buildBankBlocks, personStyles } from '@fwos/core';
import { AccountEditGrid } from '@/components/AccountEditGrid';
import { PageHead } from '@/components/PageHead';
import { ManageCrumbs } from '../Parts';
import { gridBanks } from '@/lib/account-edit';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { saveAccountDetails } from './actions';

export const dynamic = 'force-dynamic';

export default async function EditAccountsPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio }, inst, jh] = await Promise.all(
    [
      loadPortfolio(supabase),
      supabase.from('institutions').select('id, name').order('name'),
      supabase.from('assets').select('id, joint_holder_id').not('joint_holder_id', 'is', null),
    ],
  );
  const jointHolders = Object.fromEntries(
    (jh.data ?? []).map((j) => [j.id as string, j.joint_holder_id as string]),
  );
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
      <ManageCrumbs current="Correct tags and details" />
      <PageHead
        title="Correct tags and details"
        subtitle="Fix the type, joint flag, last four digits, label, person, bank or status of any account or deposit, and a deposit's rate, dates and amounts. Balances are not here: they change in the monthly update."
      />
      <details className="disclose">
        <summary>How to change many rows at once</summary>
        <p className="small muted">
          Tick rows to change many at once, or use &ldquo;Suggest types for empty rows&rdquo; and
          check the highlighted rows before saving. Nothing is saved until you press Save.
        </p>
      </details>
      <AccountEditGrid
        banks={gridBanks(blocks, assetRows, fdRows, jointHolders)}
        owners={owners}
        institutions={institutions}
        styles={styles}
        save={saveAccountDetails}
      />
    </>
  );
}
