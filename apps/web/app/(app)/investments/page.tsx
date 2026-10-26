import Link from 'next/link';
import { parseRange, personStyles } from '@fwos/core';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { loadContext } from '@/lib/data';
import { loadInvestmentView } from '@/lib/investments';
import { loadMatchView } from '@/lib/match-data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { clearMatch, confirmMatch, setExitLoad } from '../funds/actions';
import { addFund, addFundTxn, saveFundEdit } from './edit-actions';
import { InvestShell, parseTab, PERSON_TABS } from './InvestShell';
import { MatchTab } from './Parts';

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
  const noPrice = view.groups.flatMap((g) => g.funds).filter((f) => !f.amfiCode).length;

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

  return (
    <InvestShell
      base="/investments"
      demo={false}
      q={{ ...sp, tab }}
      view={view}
      styles={styles}
      owners={owners}
      noPrice={noPrice}
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
            actions={{ confirmMatch, clearMatch, setExitLoad }}
          />
        </ListingTools>
      )}
    </InvestShell>
  );
}
