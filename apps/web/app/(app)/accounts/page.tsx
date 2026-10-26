import Link from 'next/link';
import { buildBankBlocks, filterBlocksByOwner, formatInrCompact, personStyles } from '@fwos/core';
import { BankTable } from '@/components/BankTable';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { foreignLines, summariseBlocks } from '@/lib/accounts-summary';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { cashRatesFor, loadOffers } from '@/lib/rates-view';
import { loadTidyPlan } from '@/lib/tidy-notes';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AccountsKpis, ForeignCard, ManageCards } from './Parts';
import { saveBankNote } from './actions';

export const dynamic = 'force-dynamic';

const TABS = ['banks', 'manage'] as const;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string }>;
}) {
  const { p, tab: rawTab } = await searchParams;
  const tab = (TABS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as (typeof TABS)[number])
    : 'banks';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [
    { today, assetRows, obsRows, fdRows, ownerName, portfolio, marketDates },
    inst,
    settings,
    offers,
  ] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name, notes'),
    loadSettings(supabase as unknown as SupabaseClient),
    loadOffers(supabase),
  ]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = p && styles[p] ? p : null;
  const names = Object.fromEntries(
    (inst.data ?? []).map((i) => [i.id as string, i.name as string]),
  );
  const notes = Object.fromEntries(
    (inst.data ?? []).filter((i) => i.notes).map((i) => [i.id as string, i.notes as string]),
  );
  const all = buildBankBlocks({
    assets: assetRows,
    observations: obsRows,
    fds: fdRows,
    portfolio,
    institutionNames: names,
    today,
  });
  const blocks = who ? filterBlocksByOwner(all, who) : all;
  const summary = summariseBlocks(blocks);
  const rows = all.flatMap((b) => b.sections.flatMap((s) => s.rows));
  const assumed = rows.filter((r) => r.kindInferred).length;
  const month = today.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );

  const pills = [
    summary.needsYou > 0
      ? {
          label: `${summary.needsYou} need${summary.needsYou === 1 ? 's' : ''} you`,
          tone: 'warn' as const,
        }
      : { label: 'Nothing waiting', tone: 'ok' as const },
    {
      label: `${summary.banksDone} of ${summary.banks} banks updated in ${month}`,
      tone: 'info' as const,
    },
  ];
  const head = (
    <PageHead
      title="Accounts"
      subtitle="Every bank in your sheet's order, with each person's savings and deposits. Open a bank for its history."
      pills={pills}
      actions={
        <>
          <Link className="btn primary" href="/monthly">
            Update balances
          </Link>
          <Link className="btn" href="/accounts?tab=manage">
            Manage
          </Link>
        </>
      }
    />
  );

  if (tab === 'manage') {
    const tidy = await loadTidyPlan(supabase);
    return (
      <>
        {head}
        <AccountsKpis s={summary} month={month} />
        <Tabs base="/accounts" current={tab} tabs={tabList(assumed)} />
        <p className="lead muted">
          Everything that changes the shape of the list is here: correct a detail, change the order,
          tidy notes or add an account.
        </p>
        <ManageCards
          facts={{
            assumedTypes: assumed,
            notesToMove: tidy.plan.assets.length,
            banks: all.length,
            accounts: rows.length,
          }}
        />
      </>
    );
  }

  const cashRates = cashRatesFor(
    blocks.flatMap((b) =>
      b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
    ),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    settings.config.estimates.savingsRate,
  );
  const foreign = foreignLines(
    who ? assetRows.filter((a) => a.owner_id === who) : assetRows,
    obsRows,
    new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null])),
    marketDates.fx,
  );

  return (
    <>
      {head}
      <AccountsKpis s={summary} month={month} />
      <Tabs base="/accounts" current={tab} tabs={tabList(assumed)} />
      <PersonFilter
        people={Object.values(styles)}
        basePath="/accounts"
        current={who}
        totals={totals}
      />
      <ListingTools name="accounts">
        <BankTable
          blocks={blocks}
          styles={styles}
          soonDays={settings.config.reminders.maturitySoonDays}
          notes={notes}
          saveNote={saveBankNote}
          cashRates={cashRates}
        />
      </ListingTools>
      <ForeignCard lines={foreign} styles={styles} />
      <details className="disclose">
        <summary>How these values are worked out</summary>
        <ul className="list small muted">
          <li>
            A fixed deposit is valued from its rate and start date, and equals the full amount on
            the maturity date. Today&apos;s wealth uses these values.
          </li>
          <li>
            Savings show the last balance recorded, moved forward at the bank&apos;s rate when the
            balance is old. The Updated column says who recorded it and when.
          </li>
          <li>
            A deposit past its maturity date is not counted until you say where the money went (see{' '}
            <Link href="/deposits?tab=maturities">Deposits, Maturities</Link>).
          </li>
        </ul>
      </details>
    </>
  );
}

function tabList(assumed: number) {
  return [
    { key: 'banks', label: 'Banks' },
    { key: 'manage', label: 'Manage', badge: assumed },
  ];
}
