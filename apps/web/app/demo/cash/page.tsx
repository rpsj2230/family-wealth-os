import type { Metadata } from 'next';
import Link from 'next/link';
import {
  bankOverview,
  cashBlocks,
  cashByBank,
  DEFAULT_CONFIG,
  filterBlocksByOwner,
  largestCash,
} from '@fwos/core';
import { CashOverviewPanel } from '@/app/(app)/cash/Overview';
import { CashRegister } from '@/app/(app)/cash/Register';
import { DemoShell } from '@/components/DemoShell';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { DEMO_TODAY, demoModel } from '@/lib/demo-fixture';
import { bankBase, cashExplain } from '@/lib/explain-money';

export const metadata: Metadata = {
  title: 'Sample cash',
  robots: { index: false, follow: false },
};

/** Public preview of the Cash page with invented banks, people and balances: no private data is read. */
export default async function DemoCash({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { blocks: all, styles, fx } = demoModel();
  const who = p && styles[p] ? p : null;
  const blocks = cashBlocks(who ? filterBlocksByOwner(all, who) : all);
  const { savingsRate, interestTdsRate } = DEFAULT_CONFIG.estimates;
  const overview = bankOverview(blocks, {
    today: DEMO_TODAY,
    soonDays: DEFAULT_CONFIG.reminders.maturitySoonDays,
    defaultSavingsRate: savingsRate,
    tdsRate: interestTdsRate,
    fx,
  });
  const banks = cashByBank(blocks, {}, interestTdsRate, savingsRate);
  const interestYear = banks.reduce((s, b) => s + b.interestYear, 0);
  const total = banks.reduce((s, b) => s + b.balance, 0);
  const avgRate = total > 0 ? interestYear / (1 - interestTdsRate) / total : null;
  const exC = cashExplain(
    overview,
    bankBase({
      today: DEMO_TODAY.toISOString().slice(0, 10),
      scope: who ? (styles[who]?.name ?? null) : null,
      blocks,
      savingsRate,
      tdsRate: interestTdsRate,
    }),
    true,
    { banks, interestYear, avgRate, largest: largestCash(blocks) },
  );
  return (
    <DemoShell>
      <PageHead
        title="Cash"
        subtitle="The savings and cash accounts: what is available today, what it earns, and which bank holds how much."
        pills={[{ label: `${overview.accounts} accounts`, tone: 'info' }]}
        actions={
          <Link className="btn" href="/demo/accounts">
            Accounts
          </Link>
        }
      />
      <CashOverviewPanel
        ex={exC}
        o={overview}
        banks={banks}
        interestYear={interestYear}
        avgRate={avgRate}
        largest={largestCash(blocks)}
        styles={styles}
        scope={who ? (styles[who]?.name ?? null) : null}
        sample
      />
      <PersonFilter people={Object.values(styles)} basePath="/demo/cash" current={who} />
      <ListingTools name="cash">
        <CashRegister
          blocks={blocks}
          rates={{}}
          tdsRate={interestTdsRate}
          defaultRate={savingsRate}
          styles={styles}
          sample
        />
      </ListingTools>
    </DemoShell>
  );
}
