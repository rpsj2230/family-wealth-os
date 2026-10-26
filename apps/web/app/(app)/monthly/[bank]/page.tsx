import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildBankBlocks, personStyles, standings } from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { PageHead } from '@/components/PageHead';
import { UpdateGrid } from '@/components/UpdateGrid';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { slugify } from '@/lib/slug';

export const dynamic = 'force-dynamic';

export default async function BankUpdatePage({ params }: { params: Promise<{ bank: string }> }) {
  const { bank } = await params;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, ownerName, portfolio }, inst, fx] = await Promise.all(
    [
      loadPortfolio(supabase),
      supabase.from('institutions').select('id, name'),
      supabase
        .from('fx_rates')
        .select('currency, rate_date, inr_per_unit')
        .order('rate_date', { ascending: false })
        .limit(20),
    ],
  );
  const iso = today.toISOString().slice(0, 10);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const names = Object.fromEntries(
    (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const all = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: names,
    today,
  });
  const blocks = all.filter((b) => slugify(b.name) === bank);
  if (blocks.length === 0) notFound();
  const fxHint: Record<string, number> = {};
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxHint)) fxHint[r.currency as string] = Number(r.inr_per_unit);
  const st = standings(blocks, iso)[0]!;
  return (
    <>
      <p className="small">
        <Link href="/monthly">← All banks</Link>
      </p>
      <PageHead
        title={blocks[0]!.name}
        subtitle="Monthly update for this bank only."
        pills={[
          st.state === 'current'
            ? { label: 'Up to date this month', tone: 'ok' }
            : { label: `${st.waiting + st.depositsToConfirm} waiting`, tone: 'warn' },
        ]}
        actions={<BankBadge name={blocks[0]!.name} size={36} />}
      />
      <UpdateGrid
        blocks={blocks}
        styles={styles}
        today={iso}
        fxHint={fxHint}
        institutions
        summary={false}
      />
    </>
  );
}
