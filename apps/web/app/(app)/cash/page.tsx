import Link from 'next/link';
import {
  bankOverview,
  buildBankBlocks,
  cashBlocks,
  cashByBank,
  filterBlocksByOwner,
  largestCash,
  personStyles,
} from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { cashExplain, bankBase } from '@/lib/explain-money';
import { cashRatesFor, loadOffers } from '@/lib/rates-view';
import { CashOverviewPanel } from './Overview';
import { CashRegister } from './Register';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cash' };

export default async function CashPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [
    { today, assetRows, obsRows, fdRows, ownerName, portfolio, hideMaturedAfterDays, marketDates },
    inst,
    settings,
    offers,
  ] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('institutions').select('id, name'),
    loadSettings(supabase as unknown as SupabaseClient),
    loadOffers(supabase),
  ]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = p && styles[p] ? p : null;
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
  const blocks = cashBlocks(who ? filterBlocksByOwner(all, who) : all);
  const rates = cashRatesFor(
    blocks.flatMap((b) =>
      b.sections.flatMap((sct) => sct.rows.map((r) => ({ ...r, bank: b.name }))),
    ),
    new Map(assetRows.map((a) => [a.id, a.interest_rate ?? null])),
    offers,
    settings.config.estimates.savingsRate,
  );
  const rateOf = Object.fromEntries(Object.entries(rates).map(([id, c]) => [id, c.rate]));
  const { savingsRate, interestTdsRate } = settings.config.estimates;
  const overview = bankOverview(blocks, {
    today,
    soonDays: settings.config.reminders.maturitySoonDays,
    savingsRates: rateOf,
    defaultSavingsRate: savingsRate,
    tdsRate: interestTdsRate,
    fx: marketDates.fx,
  });
  const banks = cashByBank(blocks, rateOf, interestTdsRate, savingsRate);
  const interestYear = banks.reduce((s, b) => s + b.interestYear, 0);
  const inrBalance = banks.reduce((s, b) => s + (b.avgRate === null ? 0 : b.balance), 0);
  const avgRate =
    inrBalance > 0
      ? banks.reduce((s, b) => s + (b.avgRate ?? 0) * (b.avgRate === null ? 0 : b.balance), 0) /
        inrBalance
      : null;

  const exC = cashExplain(
    overview,
    bankBase({
      today: today.toISOString().slice(0, 10),
      scope: who ? styles[who]!.name : null,
      blocks,
      rates,
      savingsRate,
      tdsRate: interestTdsRate,
    }),
    false,
    { banks, interestYear, avgRate, largest: largestCash(blocks) },
  );

  return (
    <>
      <PageHead
        title="Cash"
        subtitle={
          <>
            The savings and cash accounts: what is available today, what it earns, and which bank
            holds how much. <Link href="/import#history-coverage">Balance history</Link>
          </>
        }
        pills={[
          { label: `${overview.accounts} accounts`, tone: 'info' },
          overview.staleBalances > 0
            ? { label: `${overview.staleBalances} balances out of date`, tone: 'warn' }
            : { label: 'Balances are recent', tone: 'ok' },
        ]}
        actions={
          <>
            <Link className="btn primary" href="/monthly">
              Update balances
            </Link>
            <Link className="btn" href="/accounts">
              Accounts
            </Link>
          </>
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
        scope={who ? styles[who]!.name : null}
      />
      <PersonFilter people={Object.values(styles)} basePath="/cash" current={who} />
      <ListingTools name="cash">
        <CashRegister
          blocks={blocks}
          rates={rates}
          tdsRate={interestTdsRate}
          defaultRate={savingsRate}
          styles={styles}
        />
      </ListingTools>
    </>
  );
}
