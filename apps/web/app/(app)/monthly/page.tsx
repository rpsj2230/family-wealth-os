import Link from 'next/link';
import {
  buildBankBlocks,
  buildMonthlyExplain,
  personStyles,
  standings,
  summarizeStandings,
  withoutHiddenDeposits,
} from '@fwos/core';
import { AutomationStrip } from '@/components/AutomationCards';
import { HiddenDepositsNote } from '@/components/HiddenDepositsNote';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { Why } from '@/components/Why';
import { QuickEditHost } from '@/components/QuickEditHost';
import { UpdateGrid } from '@/components/UpdateGrid';
import { loadAutomation } from '@/lib/automation';
import { loadContext } from '@/lib/data';
import { maturedHref, showsMatured } from '@/lib/matured-list';
import { loadPortfolio } from '@/lib/portfolio-data';
import { quickModel } from '@/lib/quick-edit';
import { loadJointHolders } from '@/lib/quick-edit-data';
import { loadSheetSyncInfo } from '@/lib/sheet-sync-data';
import { SheetSyncButton } from '@/components/SheetSync';
import { loadNominees, loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { MonthlyGrid } from './MonthlyGrid';
import { loadOtherRows } from './other-data';

export const dynamic = 'force-dynamic';
// the Google Sheet preview and sync wait for Google
export const maxDuration = 60;

const TABS = ['banks', 'other'] as const;

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; matured?: string }>;
}) {
  const sp = await searchParams;
  const showAll = showsMatured(sp.matured);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'banks';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const month = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const sheet = await loadSheetSyncInfo(supabase);

  if (tab === 'other') {
    const [{ rows, today }, settings] = await Promise.all([
      loadOtherRows(supabase),
      loadSettings(supabase as unknown as SupabaseClient),
    ]);
    const assumedRate = settings.config.estimates.savingsRate;
    return (
      <>
        <PageHead
          title="Monthly update"
          subtitle="Property, pension, shares, money lent and anything else that is not on the bank sheet."
          actions={<SheetSyncButton info={sheet} />}
        />
        <Tabs base="/monthly" current="other" tabs={tabList(0)} />
        {rows.length === 0 ? (
          <p className="empty">
            Nothing else is recorded yet. Add property, loans or policies on{' '}
            <Link href="/others">Lent, policies, property</Link>.
          </p>
        ) : (
          <>
            <p className="muted small">
              Type the new value next to a line and press Save all. Leave a line empty to keep it as
              it is. Old values stay as history. You can paste a column from Excel into the first
              box. Mutual funds follow their published price by themselves; the units and purchases
              are on <Link href="/investments?tab=update">Update funds</Link>.
            </p>
            <MonthlyGrid rows={rows} today={today} assumedRate={assumedRate} />
          </>
        )}
      </>
    );
  }

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
  const blocks = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: names,
    today,
    hideMaturedAfterDays,
  });
  const fxHint: Record<string, number> = {};
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxHint)) fxHint[r.currency as string] = Number(r.inr_per_unit);
  // deposits that matured long ago or are confirmed leave the grid (they are in no total); ?matured=all lists them again, dimmed
  const { blocks: visible, counts: hiddenCounts } = withoutHiddenDeposits(blocks, showAll);
  const sum = summarizeStandings(standings(visible, iso));
  const waiting = sum.waiting + sum.attention;
  const exM = buildMonthlyExplain({
    today: iso,
    month: month(today),
    summary: sum,
    freshnessDays: (await loadSettings(supabase as unknown as SupabaseClient)).config.estimates
      .freshnessDays,
    links: { inbox: '/inbox', accounts: '/accounts' },
  });
  const { cards, inboxWaiting } = await loadAutomation(supabase, iso);
  const quick = quickModel({
    blocks,
    assets: assetRows,
    fds: fdRows,
    ownerNames: Object.fromEntries(ownerName),
    institutions: (inst.data ?? []).map((i) => ({ id: i.id as string, name: i.name as string })),
    jointHolders,
    nominees,
  });

  return (
    <QuickEditHost model={quick} styles={styles} today={iso} fxHint={fxHint}>
      <PageHead
        title="Monthly update"
        subtitle={`Keep every balance current for ${month(today)}. Type a new balance, or mark a bank as unchanged; deposits and funds look after themselves.`}
        pills={[
          {
            label: `${sum.current} of ${sum.banks} banks up to date`,
            tone: waiting === 0 ? 'ok' : 'warn',
            why: exM['monthly.status'],
          },
          ...(sum.depositsToConfirm > 0
            ? [
                {
                  label: `${sum.depositsToConfirm} matured deposit${sum.depositsToConfirm === 1 ? '' : 's'} to confirm`,
                  tone: 'bad' as const,
                },
              ]
            : []),
        ]}
        actions={
          <>
            <SheetSyncButton info={sheet} />
            <Link className="btn" href="/inbox">
              Bank email inbox
            </Link>
          </>
        }
      />
      <Tabs base="/monthly" current="banks" tabs={tabList(waiting)} />
      <p className="muted small">
        Each balance shows how current it is and who recorded it.{' '}
        <Why explain={exM['monthly.freshness']} />
      </p>
      <AutomationStrip cards={cards.filter((c) => c.key === 'email' || c.key === 'market')} />
      {inboxWaiting > 0 && (
        <p className="notice warn" role="note">
          {inboxWaiting} balance{inboxWaiting === 1 ? '' : 's'} read from your email{' '}
          {inboxWaiting === 1 ? 'is' : 'are'} waiting for your review.{' '}
          <Link href="/inbox">Review them in the inbox</Link>; applying one counts as this month’s
          value.
        </p>
      )}
      <UpdateGrid blocks={visible} styles={styles} today={iso} fxHint={fxHint} institutions />
      <HiddenDepositsNote
        counts={hiddenCounts}
        showAll={showAll}
        showHref={maturedHref('/monthly', {}, true)}
        hideHref={maturedHref('/monthly', {}, false)}
      />
    </QuickEditHost>
  );
}

function tabList(waiting: number) {
  return [
    { key: 'banks', label: 'Banks and deposits', badge: waiting },
    { key: 'other', label: 'Property, loans and other' },
  ];
}
