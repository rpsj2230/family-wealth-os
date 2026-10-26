import Link from 'next/link';
import { buildBankBlocks, personStyles, standings, summarizeStandings } from '@fwos/core';
import { AutomationStrip } from '@/components/AutomationCards';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { UpdateGrid } from '@/components/UpdateGrid';
import { loadAutomation } from '@/lib/automation';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { MonthlyGrid } from './MonthlyGrid';
import { loadOtherRows } from './other-data';

export const dynamic = 'force-dynamic';

const TABS = ['banks', 'other'] as const;

export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'banks';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const month = (d: Date) =>
    d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  if (tab === 'other') {
    const { rows, today } = await loadOtherRows(supabase);
    return (
      <>
        <PageHead
          title="Monthly update"
          subtitle="Property, pension, shares, money lent and anything else that is not on the bank sheet."
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
              are on <Link href="/investments/update">Update funds</Link>.
            </p>
            <MonthlyGrid rows={rows} today={today} />
          </>
        )}
      </>
    );
  }

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
  const sum = summarizeStandings(standings(blocks, iso));
  const waiting = sum.waiting + sum.attention;
  const { cards, inboxWaiting } = await loadAutomation(supabase, iso);

  return (
    <>
      <PageHead
        title="Monthly update"
        subtitle={`Keep every balance current for ${month(today)}. Type a new balance, or mark a bank as unchanged; deposits and funds look after themselves.`}
        pills={[
          {
            label: `${sum.current} of ${sum.banks} banks up to date`,
            tone: waiting === 0 ? 'ok' : 'warn',
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
          <Link className="btn" href="/inbox">
            Bank email inbox
          </Link>
        }
      />
      <Tabs base="/monthly" current="banks" tabs={tabList(waiting)} />
      <AutomationStrip cards={cards.filter((c) => c.key === 'email' || c.key === 'market')} />
      {inboxWaiting > 0 && (
        <p className="notice warn" role="note">
          {inboxWaiting} balance{inboxWaiting === 1 ? '' : 's'} read from your email{' '}
          {inboxWaiting === 1 ? 'is' : 'are'} waiting for your review.{' '}
          <Link href="/inbox">Review them in the inbox</Link>; applying one counts as this month’s
          value.
        </p>
      )}
      <UpdateGrid blocks={blocks} styles={styles} today={iso} fxHint={fxHint} institutions />
    </>
  );
}

function tabList(waiting: number) {
  return [
    { key: 'banks', label: 'Banks and deposits', badge: waiting },
    { key: 'other', label: 'Property, loans and other' },
  ];
}
