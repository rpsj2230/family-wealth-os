import Link from 'next/link';
import { buildBankBlocks, personStyles } from '@fwos/core';
import { ReorderList, type ReorderBank } from '@/components/ReorderList';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { saveOrder } from './actions';

export const dynamic = 'force-dynamic';

export default async function ReorderPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio }, inst] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name'),
  ]);
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
      <h1>Change the order</h1>
      <p className="muted">
        Drag a bank or a row, or use the arrow buttons, then save. Accounts and the monthly update
        follow this order. Uploading your workbook again with &ldquo;Apply the sheet layout&rdquo;
        sets the order back to the sheet&apos;s.
      </p>
      <p>
        <Link href="/accounts">← Back to Accounts</Link>
      </p>
      <ReorderList banks={banks} styles={styles} save={saveOrder} />
    </>
  );
}
