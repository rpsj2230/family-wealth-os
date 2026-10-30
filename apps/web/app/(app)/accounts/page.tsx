import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  bankOverview,
  buildBankBlocks,
  filterBlocksByOwner,
  formatInrCompact,
  personStyles,
  withoutHiddenDeposits,
} from '@fwos/core';
import { BankTable } from '@/components/BankTable';
import { GrandTotal } from '@/components/GrandTotal';
import { HiddenDepositsNote } from '@/components/HiddenDepositsNote';
import { AddButton } from '@/components/QuickEdit';
import { QuickEditHost } from '@/components/QuickEditHost';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { foreignLines } from '@/lib/accounts-summary';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { cashRatesFor, loadOffers } from '@/lib/rates-view';
import { quickModel } from '@/lib/quick-edit';
import { maturedHref, showsMatured } from '@/lib/matured-list';
import { loadFxHint, loadJointHolders } from '@/lib/quick-edit-data';
import { loadTidyPlan } from '@/lib/tidy-notes';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadBankGrowth, loadInflation } from '@/lib/bank-growth-data';
import { accountsExplain, bankBase } from '@/lib/explain-money';
import { BankOverviewPanel } from './BankOverview';
import { ForeignCard, ManageCards } from './Parts';
import { saveBankNote } from './actions';

export const dynamic = 'force-dynamic';

const TABS = ['banks', 'manage'] as const;

export default async function AccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string; edit?: string; matured?: string }>;
}) {
  const { p, tab: rawTab, edit, matured } = await searchParams;
  const showAll = showsMatured(matured);
  const tab = (TABS as readonly string[]).includes(rawTab ?? '')
    ? (rawTab as (typeof TABS)[number])
    : 'banks';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [loaded, inst, settings, offers, jointHolders, fxHint, inflation] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name, notes, deposit_insured'),
    loadSettings(supabase as unknown as SupabaseClient),
    loadOffers(supabase),
    loadJointHolders(supabase as unknown as SupabaseClient),
    loadFxHint(supabase as unknown as SupabaseClient),
    loadInflation(supabase as unknown as SupabaseClient),
  ]);
  const {
    today,
    assetRows,
    obsRows,
    fdRows,
    ownerName,
    portfolio,
    marketDates,
    hideMaturedAfterDays,
  } = loaded;
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
    hideMaturedAfterDays,
  });
  // a deposit that matured long ago or is confirmed leaves the rows (never the totals: it is in none); ?matured=all lists it again, dimmed
  const { blocks, counts: hiddenCounts } = withoutHiddenDeposits(
    who ? filterBlocksByOwner(all, who) : all,
    showAll,
  );
  const cashRates = cashRatesFor(
    blocks.flatMap((b) =>
      b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
    ),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    settings.config.estimates.savingsRate,
  );
  const overview = bankOverview(blocks, {
    today,
    soonDays: settings.config.reminders.maturitySoonDays,
    savingsRates: Object.fromEntries(Object.entries(cashRates).map(([id, c]) => [id, c.rate])),
    defaultSavingsRate: settings.config.estimates.savingsRate,
    tdsRate: settings.config.estimates.interestTdsRate,
    insuranceLimit: settings.config.deposits.insuranceLimit,
    uninsuredBanks: new Set(
      (inst.data ?? []).filter((i) => i.deposit_insured === false).map((i) => i.id as string),
    ),
    jointHolders,
    fx: marketDates.fx,
  });
  const growth = await loadBankGrowth(
    supabase as unknown as SupabaseClient,
    loaded,
    settings.config,
    {
      owner: who,
      rows: blocks.flatMap((b) => b.sections.flatMap((sct) => sct.rows)),
      fdNow: overview.parts.fd.current,
      cashNow: overview.parts.cash.current,
    },
  );
  const exA = accountsExplain(
    overview,
    bankBase({
      today: today.toISOString().slice(0, 10),
      scope: who ? styles[who]!.name : null,
      blocks,
      rates: cashRates,
      savingsRate: settings.config.estimates.savingsRate,
      tdsRate: settings.config.estimates.interestTdsRate,
    }),
    false,
    growth,
  );
  const quick = quickModel({
    blocks: all,
    assets: assetRows,
    fds: fdRows,
    ownerNames: Object.fromEntries(ownerName),
    institutions: (inst.data ?? []).map((i) => ({ id: i.id as string, name: i.name as string })),
    jointHolders,
  });
  const todayIso = today.toISOString().slice(0, 10);
  const withEditor = (children: ReactNode) => (
    <QuickEditHost
      model={quick}
      styles={styles}
      today={todayIso}
      fxHint={fxHint}
      initialOpen={edit ?? null}
    >
      {children}
    </QuickEditHost>
  );
  const rows = withoutHiddenDeposits(all, showAll).blocks.flatMap((b) =>
    b.sections.flatMap((s) => s.rows),
  );
  const assumed = rows.filter((r) => r.kindInferred).length;
  const month = today.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );

  const pills = [
    overview.needsYou > 0
      ? {
          label: `${overview.needsYou} need${overview.needsYou === 1 ? 's' : ''} you`,
          tone: 'warn' as const,
        }
      : { label: 'Nothing waiting', tone: 'ok' as const },
    {
      label: `${overview.banksDone} of ${overview.banks} banks updated in ${month}`,
      tone: 'info' as const,
    },
  ];
  const head = (
    <PageHead
      title="Accounts"
      subtitle={
        <>
          Every bank in your sheet&rsquo;s order, with each person&rsquo;s savings and deposits.
          Press Edit on a line to change it.{' '}
          <Link href="/import#history-coverage">Balance history</Link>
        </>
      }
      pills={pills}
      actions={
        <>
          <Link className="btn primary" href="/monthly">
            Update balances
          </Link>
          <AddButton label="Add an account" />
          <Link className="btn" href="/accounts?tab=manage">
            Manage
          </Link>
        </>
      }
    />
  );

  if (tab === 'manage') {
    const tidy = await loadTidyPlan(supabase);
    return withEditor(
      <>
        {head}
        <BankOverviewPanel
          ex={exA}
          growth={growth}
          inflation={inflation}
          o={overview}
          styles={styles}
          month={month}
          scope={who ? styles[who]!.name : null}
        />
        <Tabs base="/accounts" current={tab} tabs={tabList(assumed)} />
        <p className="lead muted">
          Tools for many accounts at once, and for the order of the list. To change one account,
          press Edit on its line under Banks.
        </p>
        <ManageCards
          facts={{
            assumedTypes: assumed,
            notesToMove: tidy.plan.assets.length,
            banks: all.length,
            accounts: rows.length,
          }}
        />
      </>,
    );
  }

  const foreign = foreignLines(
    who ? assetRows.filter((a) => a.owner_id === who) : assetRows,
    obsRows,
    new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null])),
    marketDates.fx,
  );

  return withEditor(
    <>
      {head}
      <BankOverviewPanel
        ex={exA}
        growth={growth}
        inflation={inflation}
        o={overview}
        styles={styles}
        month={month}
        scope={who ? styles[who]!.name : null}
      />
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
        <GrandTotal
          invested={overview.invested}
          maturity={overview.maturity}
          current={overview.current}
          lines={overview.accounts + overview.deposits}
          scope={who ? styles[who]!.name : null}
          why={exA['accounts.grand']}
        />
      </ListingTools>
      <HiddenDepositsNote
        counts={hiddenCounts}
        showAll={showAll}
        showHref={maturedHref('/accounts', { p: who }, true)}
        hideHref={maturedHref('/accounts', { p: who }, false)}
      />
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
            A deposit past its maturity date is counted once, at what it paid out, until you say
            where the money went (<Link href="/reconcile">Explain movements</Link>); if a new
            deposit or a later balance already holds it, it is not counted twice. Press Confirm
            matured once it has been paid out. It stays on this list for the number of days set in{' '}
            <Link href="/settings#limits">Settings</Link>, then it is hidden (Show matured brings it
            back).
          </li>
        </ul>
      </details>
    </>,
  );
}

function tabList(assumed: number) {
  return [
    { key: 'banks', label: 'Banks' },
    { key: 'manage', label: 'Manage', badge: assumed },
  ];
}
