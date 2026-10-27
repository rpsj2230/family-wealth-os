import { buildBankBlocks, personStyles } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { ReorderList, type ReorderBank } from '@/components/ReorderList';
import { ManageCrumbs } from '../Parts';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { saveOrder } from './actions';

export const dynamic = 'force-dynamic';

export default async function ReorderPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio, hideMaturedAfterDays }, inst] =
    await Promise.all([loadPortfolio(supabase), supabase.from('institutions').select('id, name')]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: Object.fromEntries(
      (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
    ),
    today,
    hideMaturedAfterDays,
  });
  const banks: ReorderBank[] = blocks.map((b) => ({
    key: b.key,
    name: b.name,
    rows: b.sections
      .flatMap((s) => s.rows)
      .sort((x, y) => x.order - y.order)
      .map((r) => ({ id: r.assetId, code: r.code, ownerId: r.ownerId })),
  }));
  return (
    <>
      <ManageCrumbs current="Change the order" />
      <PageHead
        title="Change the order"
        subtitle="Drag a bank or a row, or use the arrow buttons, then save. Accounts and the monthly update follow this order."
      />
      <p className="small muted">
        Uploading your workbook again under Import (&ldquo;Update order, names and links&rdquo;)
        sets the order back to the sheet&apos;s.
      </p>
      <ReorderList banks={banks} styles={styles} save={saveOrder} />
    </>
  );
}
