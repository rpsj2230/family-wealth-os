import Link from 'next/link';
import { buildBankBlocks, personStyles } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccountEditGrid } from '@/components/AccountEditGrid';
import { PageHead } from '@/components/PageHead';
import { ManageCrumbs } from '../Parts';
import { gridBanks } from '@/lib/account-edit';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { loadJointHolders } from '@/lib/quick-edit-data';
import { saveAccountDetails } from './actions';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ bank?: string }>;
}) {
  const { bank } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [
    { today, assetRows, obsRows, fdRows, ownerName, portfolio, hideMaturedAfterDays },
    inst,
    jointHolders,
  ] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name').order('name'),
    loadJointHolders(supabase as unknown as SupabaseClient),
  ]);
  const owners = [...ownerName.entries()].map(([id, name]) => ({ id, name }));
  const styles = personStyles(owners);
  const institutions = (inst.data ?? []).map((i) => ({
    id: i.id as string,
    name: i.name as string,
  }));
  const all = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: Object.fromEntries(institutions.map((i) => [i.id, i.name])),
    today,
    hideMaturedAfterDays,
  });
  // /accounts/edit?bank=<id> shows one bank only (linked from that bank's page)
  const only = bank && UUID.test(bank) ? all.filter((b) => b.key === bank) : [];
  const blocks = only.length > 0 ? only : all;
  return (
    <>
      <ManageCrumbs current="Edit many accounts" />
      <PageHead
        title="Edit many accounts at once"
        subtitle="Every account and deposit in one table. To change a single account, press Edit on its line under Accounts instead."
        actions={
          only.length > 0 ? (
            <Link className="btn" href="/accounts/edit">
              Show every bank
            </Link>
          ) : undefined
        }
      />
      <details className="disclose">
        <summary>How to change many rows at once</summary>
        <p className="small muted">
          Tick rows to set a type, mark them joint or move them to another bank in one step, or use
          &ldquo;Suggest types for empty rows&rdquo; and check the highlighted rows before saving.
          &ldquo;Show every column&rdquo; adds the rarely used ones (joint, last four digits, start
          date). Nothing is saved until you press Save all, and Discard puts everything back.
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
