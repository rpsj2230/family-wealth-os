import type { Metadata } from 'next';
import Link from 'next/link';
import {
  bankFiguresBy,
  bankOverview,
  DEFAULT_CONFIG,
  filterBlocksByOwner,
  formatInrCompact,
  withoutHiddenDeposits,
} from '@fwos/core';
import { BankOverviewPanel } from '@/app/(app)/accounts/BankOverview';
import { ForeignCard, ManageCards } from '@/app/(app)/accounts/Parts';
import { BankTable } from '@/components/BankTable';
import { GrandTotal } from '@/components/GrandTotal';
import { HiddenDepositsNote } from '@/components/HiddenDepositsNote';
import { AddButton, QuickEditProvider } from '@/components/QuickEdit';
import { DemoShell } from '@/components/DemoShell';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { foreignLines } from '@/lib/accounts-summary';
import { DEMO_TODAY, demoModel } from '@/lib/demo-fixture';
import { DEMO_INFLATION, demoBankGrowth } from '@/lib/bank-growth-data';
import { accountsExplain, bankBase } from '@/lib/explain-money';
import { maturedHref, showsMatured } from '@/lib/matured-list';
import { quickModel } from '@/lib/quick-edit';

export const metadata: Metadata = {
  title: 'Sample accounts',
  robots: { index: false, follow: false },
};

export default async function DemoAccounts({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string; matured?: string }>;
}) {
  const { p, tab: rawTab, matured } = await searchParams;
  const showAll = showsMatured(matured);
  const tab = rawTab === 'manage' ? 'manage' : 'banks';
  const { blocks, styles, portfolio, assets, observations, fds, people, institutionNames, fx } =
    demoModel();
  const who = p && styles[p] ? p : null;
  // matured long ago or confirmed: out of the rows (they are in no total); ?matured=all lists them again, dimmed
  const { blocks: shown, counts: hiddenCounts } = withoutHiddenDeposits(
    who ? filterBlocksByOwner(blocks, who) : blocks,
    showAll,
  );
  const overview = bankOverview(shown, {
    today: DEMO_TODAY,
    soonDays: DEFAULT_CONFIG.reminders.maturitySoonDays,
    defaultSavingsRate: DEFAULT_CONFIG.estimates.savingsRate,
    tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
    insuranceLimit: DEFAULT_CONFIG.deposits.insuranceLimit,
    fx,
  });
  const growth = demoBankGrowth({
    owner: who,
    rows: shown.flatMap((b) => b.sections.flatMap((sct) => sct.rows)),
    fdNow: overview.parts.fd.current,
    cashNow: overview.parts.cash.current,
  });
  const exA = accountsExplain(
    overview,
    bankBase({
      today: DEMO_TODAY.toISOString().slice(0, 10),
      scope: who ? styles[who]!.name : null,
      blocks: shown,
      savingsRate: DEFAULT_CONFIG.estimates.savingsRate,
      tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
    }),
    true,
    growth,
  );
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );
  const rows = withoutHiddenDeposits(blocks, showAll).blocks.flatMap((b) =>
    b.sections.flatMap((s) => s.rows),
  );
  const assumed = rows.filter((r) => r.kindInferred).length;
  const foreign = foreignLines(
    who ? assets.filter((a) => a.owner_id === who) : assets,
    observations,
    new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null])),
    fx,
  );
  const quick = quickModel({
    blocks,
    assets,
    fds,
    ownerNames: Object.fromEntries(people.map((x) => [x.id, x.name])),
    institutions: Object.entries(institutionNames).map(([id, name]) => ({ id, name })),
  });
  return (
    <DemoShell>
      <QuickEditProvider {...quick} styles={styles} today="2026-10-26">
        <PageHead
          title="Accounts"
          subtitle="Every bank in your sheet's order, with each person's savings and deposits. Press Edit on a line to change it."
          pills={[
            overview.needsYou > 0
              ? { label: `${overview.needsYou} need you`, tone: 'warn' }
              : { label: 'Nothing waiting', tone: 'ok' },
            {
              label: `${overview.banksDone} of ${overview.banks} banks updated in October`,
              tone: 'info',
            },
          ]}
          actions={
            <>
              <Link className="btn primary" href="/demo/monthly">
                Update balances
              </Link>
              <AddButton label="Add an account" />
              <Link className="btn" href="/demo/accounts?tab=manage">
                Manage
              </Link>
            </>
          }
        />
        <BankOverviewPanel
          byBank={bankFiguresBy(shown, 'bank', DEMO_TODAY.toISOString().slice(0, 10))}
          byPerson={bankFiguresBy(
            shown,
            'owner',
            DEMO_TODAY.toISOString().slice(0, 10),
            Object.fromEntries(people.map((x) => [x.id, x.name])),
          )}
          ex={exA}
          growth={growth}
          inflation={DEMO_INFLATION}
          o={overview}
          styles={styles}
          month="October"
          scope={who ? styles[who]!.name : null}
          sample
        />
        <Tabs
          base="/demo/accounts"
          current={tab}
          tabs={[
            { key: 'banks', label: 'Banks' },
            { key: 'manage', label: 'Manage', badge: assumed },
          ]}
        />
        {tab === 'manage' ? (
          <ManageCards
            sample
            base="/demo/accounts"
            facts={{
              assumedTypes: assumed,
              notesToMove: 3,
              banks: blocks.length,
              accounts: rows.length,
            }}
          />
        ) : (
          <>
            <PersonFilter
              people={Object.values(styles)}
              basePath="/demo/accounts"
              current={who}
              totals={totals}
            />
            <ListingTools name="accounts">
              <BankTable blocks={shown} styles={styles} updateBase="/demo/bank" sample />
              <GrandTotal
                invested={overview.invested}
                maturity={overview.maturity}
                current={overview.current}
                lines={overview.accounts + overview.deposits}
                scope={who ? (styles[who]?.name ?? null) : null}
                why={exA['accounts.grand']}
              />
            </ListingTools>
            <HiddenDepositsNote
              counts={hiddenCounts}
              showAll={showAll}
              showHref={maturedHref('/demo/accounts', { p: who }, true)}
              hideHref={maturedHref('/demo/accounts', { p: who }, false)}
            />
            <ForeignCard lines={foreign} styles={styles} />
          </>
        )}
      </QuickEditProvider>
    </DemoShell>
  );
}
