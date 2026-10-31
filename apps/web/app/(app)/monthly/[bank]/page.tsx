import Link from 'next/link';
import { notFound } from 'next/navigation';
import { buildBankBlocks, personStyles, standings, withoutHiddenDeposits } from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { HiddenDepositsNote } from '@/components/HiddenDepositsNote';
import { PageHead } from '@/components/PageHead';
import { QuickEditHost } from '@/components/QuickEditHost';
import { UpdateGrid } from '@/components/UpdateGrid';
import { loadContext } from '@/lib/data';
import { maturedHref, showsMatured } from '@/lib/matured-list';
import { loadPortfolio } from '@/lib/portfolio-data';
import { quickModel } from '@/lib/quick-edit';
import { loadNominees } from '@fwos/data';
import { loadJointHolders } from '@/lib/quick-edit-data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { slugify } from '@/lib/slug';

export const dynamic = 'force-dynamic';

export default async function BankUpdatePage({
  params,
  searchParams,
}: {
  params: Promise<{ bank: string }>;
  searchParams: Promise<{ matured?: string }>;
}) {
  const { bank } = await params;
  const showAll = showsMatured((await searchParams).matured);
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [
    { today, assetRows, obsRows, fdRows, ownerName, portfolio, hideMaturedAfterDays },
    inst,
    fx,
    jointHolders,
    nominees,
  ] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name'),
    supabase
      .from('fx_rates')
      .select('currency, rate_date, inr_per_unit')
      .order('rate_date', { ascending: false })
      .limit(20),
    loadJointHolders(supabase as unknown as SupabaseClient),
    loadNominees(supabase as unknown as SupabaseClient),
  ]);
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
    hideMaturedAfterDays,
  });
  const ofBank = all.filter((b) => slugify(b.name) === bank);
  if (ofBank.length === 0) notFound();
  // deposits that matured long ago or are confirmed leave the grid; ?matured=all lists them again, dimmed
  const { blocks: shown, counts: hiddenCounts } = withoutHiddenDeposits(ofBank, showAll);
  const blocks = shown.length > 0 ? shown : ofBank;
  const fxHint: Record<string, number> = {};
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxHint)) fxHint[r.currency as string] = Number(r.inr_per_unit);
  const st = standings(blocks, iso)[0]!;
  const quick = quickModel({
    blocks: all,
    assets: assetRows,
    fds: fdRows,
    ownerNames: Object.fromEntries(ownerName),
    institutions: (inst.data ?? []).map((i) => ({ id: i.id as string, name: i.name as string })),
    jointHolders,
    nominees,
  });
  return (
    <QuickEditHost model={quick} styles={styles} today={iso} fxHint={fxHint}>
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
        lazyChecks
        returnTo={`/monthly/${bank}`}
      />
      <HiddenDepositsNote
        counts={hiddenCounts}
        showAll={showAll}
        showHref={maturedHref(`/monthly/${bank}`, {}, true)}
        hideHref={maturedHref(`/monthly/${bank}`, {}, false)}
      />
    </QuickEditHost>
  );
}
