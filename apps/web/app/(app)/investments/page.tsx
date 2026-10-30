import Link from 'next/link';
import { effectiveRules, fundsEarnedThisFy, parseRange, personStyles } from '@fwos/core';
import {
  capitalDays,
  capitalStart,
  loadHarvestPositions,
  loadPositionInput,
  loadSettings,
  unpricedFunds,
} from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { loadContext } from '@/lib/data';
import { loadInvestmentView } from '@/lib/investments';
import { loadMatchView } from '@/lib/match-data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { clearMatch, setExitLoad } from '../funds/actions';
import { addFund, addFundTxn, saveFundEdit } from './edit-actions';
import { InvestShell, parseTab, PERSON_TABS } from './InvestShell';
import { MatchTab } from './Parts';
import {
  approveCertain,
  decideFund,
  fetchPrices,
  finishMatching,
  lookAgain,
  searchOfficialSchemes,
} from './match-actions';

export const dynamic = 'force-dynamic';

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    p?: string;
    tab?: string;
    range?: string;
    by?: string;
    compare?: string;
    heat?: string;
    group?: string;
    edit?: string;
    g?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const loaded = await loadPortfolio(supabase);
  const owners = [...loaded.ownerName.entries()].map(([id, name]) => ({ id, name }));
  const styles = personStyles(owners);
  // the person filter narrows the reading tabs; updating and matching always cover every fund
  const who = PERSON_TABS.includes(tab) && sp.p && styles[sp.p] ? sp.p : null;
  const range = tab === 'performance' ? parseRange(sp.range) : 'all';
  const view = await loadInvestmentView(supabase, loaded, who, range);
  // funds waiting for a match (the ones marked "not a listed fund" are not waiting), counted the way Home counts them
  const noPrice = (await unpricedFunds(supabase as unknown as SupabaseClient, loaded.assetRows))
    .waiting.length;

  const updateFunds: FundInput[] = view.groups.flatMap((g) =>
    g.funds.map((f) => ({
      assetId: f.assetId,
      name: f.name,
      owner: g.name,
      units: f.units,
      nav: f.nav,
      navDate: f.navDate,
      invested: f.invested,
      value: f.value,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
    })),
  );
  const match = tab === 'match' ? await loadMatchView(supabase) : null;
  // "Tax-free gain left this FY" on the overview: the yearly allowance less what each person has used, as the Tax page works it out
  const taxFree =
    tab === 'overview' ? await loadTaxFree(supabase as unknown as SupabaseClient, view) : null;
  // "Earned this FY" for the whole family is Home's own figure (the capital ledger), read from the same position as Home
  const earnedFy =
    tab === 'overview' && !who
      ? await loadFundsEarnedFy(supabase as unknown as SupabaseClient, loaded)
      : undefined;
  // the Value by period tab values the funds on every period end: the units on each day times the price, from the position engine
  const position =
    tab === 'valuation'
      ? await loadPositionInput(supabase as unknown as SupabaseClient, loaded, {
          config: (await loadSettings(supabase as unknown as SupabaseClient)).config,
          allPrices: true,
        })
      : undefined;

  return (
    <InvestShell
      base="/investments"
      demo={false}
      q={{ ...sp, tab }}
      view={view}
      styles={styles}
      owners={owners}
      noPrice={noPrice}
      position={position}
      taxFree={taxFree}
      earnedFy={earnedFy}
      actions={{ save: saveFundEdit, addFund, addTxn: addFundTxn }}
    >
      {tab === 'update' && (
        <>
          <p className="lead muted updatehelp">
            Once a month, enter the units you hold and the price (NAV) of each fund from your fund
            app or statement. The value, the graphs and the forecast follow. A fund statement from
            the <Link href="/import">Import page</Link> fills all of this in by itself. To change
            one fund, press Edit on its row on the Funds tab.
          </p>
          <section className="card">
            <FundUpdateGrid funds={updateFunds} today={view.today} />
          </section>
          <FundTransactionForm
            today={view.today}
            funds={updateFunds.map((f) => ({ id: f.assetId, name: f.name, owner: f.owner }))}
          />
        </>
      )}
      {tab === 'match' && match && (
        <ListingTools name="match-funds">
          <MatchTab
            rows={match.rows}
            haveList={match.haveList}
            canMark={match.canMark}
            actions={{
              decide: decideFund,
              approveCertain,
              fetchPrices,
              search: searchOfficialSchemes,
              finish: finishMatching,
              lookAgain,
              clearMatch,
              setExitLoad,
            }}
          />
        </ListingTools>
      )}
    </InvestShell>
  );
}

/** The yearly tax-free allowance on long-term equity gains and what each person holding funds has left of it this financial year. */
async function loadTaxFree(
  db: SupabaseClient,
  view: { today: string; groups: { ownerId: string; name: string; funds: unknown[] }[] },
) {
  const [settings, hv] = await Promise.all([loadSettings(db), loadHarvestPositions(db)]);
  const exemption = effectiveRules(view.today, settings.rules)?.rules.equity.ltcgExemption;
  if (exemption === undefined) return null;
  return {
    exemption,
    people: view.groups
      .filter((g) => g.funds.length > 0)
      .map((g) => ({
        name: g.name,
        left: Math.max(0, exemption - (hv.ytdRealised[g.ownerId] ?? 0)),
      })),
  };
}

/** What the funds earned this FY, the figure Home's "Earned this FY" shows for funds: the same position and the same ledger. */
async function loadFundsEarnedFy(
  db: SupabaseClient,
  loaded: Awaited<ReturnType<typeof loadPortfolio>>,
): Promise<number | null> {
  const { config } = await loadSettings(db);
  const today = loaded.today.toISOString().slice(0, 10);
  const position = await loadPositionInput(db, loaded, {
    config,
    days: capitalDays(capitalStart(loaded, config), today, config.home.changeDays),
  });
  return fundsEarnedThisFy(
    position,
    config.capital.openingDate || null,
    config.harvest.reinvestDays,
  );
}
