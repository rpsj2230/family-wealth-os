import type { Metadata } from 'next';
import Link from 'next/link';
import { bankOverview, DEFAULT_CONFIG, filterBlocksByOwner, formatInrCompact } from '@fwos/core';
import { BankOverviewPanel } from '@/app/(app)/accounts/BankOverview';
import { ForeignCard, ManageCards } from '@/app/(app)/accounts/Parts';
import { BankTable } from '@/components/BankTable';
import { GrandTotal } from '@/components/GrandTotal';
import { AddButton, QuickEditProvider } from '@/components/QuickEdit';
import { DemoShell } from '@/components/DemoShell';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import type { ForeignLine } from '@/lib/accounts-summary';
import { DEMO_TODAY, demoModel } from '@/lib/demo-fixture';
import { accountsExplain, bankBase } from '@/lib/explain-money';
import { quickModel } from '@/lib/quick-edit';

export const metadata: Metadata = {
  title: 'Sample accounts',
  robots: { index: false, follow: false },
};

const FOREIGN: ForeignLine[] = [
  {
    assetId: 'sg1',
    ownerId: 'p1',
    name: 'Sample Singapore savings',
    currency: 'SGD',
    amount: 4_200,
    asOf: '2026-10-12',
    rate: 63.412,
    rateDate: '2026-10-25',
    inr: 266_330,
  },
];

export default async function DemoAccounts({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string }>;
}) {
  const { p, tab: rawTab } = await searchParams;
  const tab = rawTab === 'manage' ? 'manage' : 'banks';
  const { blocks, styles, portfolio, assets, fds, people, institutionNames } = demoModel();
  const who = p && styles[p] ? p : null;
  const shown = who ? filterBlocksByOwner(blocks, who) : blocks;
  const overview = bankOverview(shown, {
    today: DEMO_TODAY,
    soonDays: DEFAULT_CONFIG.reminders.maturitySoonDays,
    defaultSavingsRate: DEFAULT_CONFIG.estimates.savingsRate,
    tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
    insuranceLimit: DEFAULT_CONFIG.deposits.insuranceLimit,
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
  );
  const totals = Object.fromEntries(
    Object.entries(portfolio.netWorth.byOwner).map(([id, v]) => [id, formatInrCompact(v)]),
  );
  const rows = blocks.flatMap((b) => b.sections.flatMap((s) => s.rows));
  const assumed = rows.filter((r) => r.kindInferred).length;
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
          ex={exA}
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
              <BankTable blocks={shown} styles={styles} updateBase="/demo/bank" />
              <GrandTotal
                invested={overview.invested}
                maturity={overview.maturity}
                current={overview.current}
                lines={overview.accounts + overview.deposits}
                scope={who ? (styles[who]?.name ?? null) : null}
                why={exA['accounts.grand']}
              />
            </ListingTools>
            <ForeignCard lines={FOREIGN} styles={styles} />
          </>
        )}
      </QuickEditProvider>
    </DemoShell>
  );
}
