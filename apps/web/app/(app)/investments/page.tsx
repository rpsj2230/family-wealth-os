import Link from 'next/link';
import { formatInr, personStyles } from '@fwos/core';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { loadContext } from '@/lib/data';
import { fundPace, loadInvestmentView } from '@/lib/investments';
import { loadMatchView } from '@/lib/match-data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { clearMatch, confirmMatch, setExitLoad } from '../funds/actions';
import { FundsTab, GrowthTab, InvestKpis, MatchTab } from './Parts';

export const dynamic = 'force-dynamic';

const TABS = ['funds', 'growth', 'update', 'match'] as const;

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'funds';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const loaded = await loadPortfolio(supabase);
  const styles = personStyles([...loaded.ownerName.entries()].map(([id, name]) => ({ id, name })));
  // the person filter only narrows the two read-only tabs; updating and matching always cover every fund
  const filtered = tab === 'funds' || tab === 'growth';
  const who = filtered && sp.p && styles[sp.p] ? sp.p : null;
  const view = await loadInvestmentView(supabase, loaded, who);
  const noPrice = view.groups.flatMap((g) => g.funds).filter((f) => !f.amfiCode).length;
  const totals = Object.fromEntries(
    view.groups.map((g) => [g.ownerId, formatInr(Math.round(g.totals.value))]),
  );
  const pace = fundPace(view);

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
    <>
      <PageHead
        title="Investments"
        subtitle={
          <>
            Mutual funds by person (PAN holder). Prices are fetched every day for funds you have
            matched; once a month you enter the units and the amount put in.
          </>
        }
        pills={[
          {
            label: `${view.household.funds} fund${view.household.funds === 1 ? '' : 's'}`,
            tone: 'info',
          },
          noPrice > 0
            ? { label: `${noPrice} without a live price`, tone: 'warn' }
            : { label: 'all funds follow their price', tone: 'ok' },
        ]}
        actions={
          <>
            <Link className="btn primary" href="/investments?tab=update">
              Update funds
            </Link>
            <Link className="btn" href="/tax">
              Tax harvest
            </Link>
          </>
        }
      />
      <InvestKpis view={view} noPrice={noPrice} />
      <Tabs
        base="/investments"
        current={tab}
        keep={who ? { p: who } : {}}
        tabs={[
          { key: 'funds', label: 'Funds' },
          { key: 'growth', label: 'Growth' },
          { key: 'update', label: 'Update funds' },
          { key: 'match', label: 'Match funds', badge: noPrice },
        ]}
      />
      {filtered && (
        <PersonFilter
          people={Object.values(styles)}
          basePath="/investments"
          current={who}
          totals={totals}
          keep={{ tab }}
        />
      )}
      {tab === 'funds' && (
        <ListingTools name="investments">
          <FundsTab view={view} styles={styles} />
        </ListingTools>
      )}
      {tab === 'growth' && <GrowthTab view={view} pace={pace} who={who} styles={styles} />}
      {tab === 'update' && (
        <>
          <p className="lead muted updatehelp">
            Once a month, enter the units you hold and the price (NAV) of each fund from your fund
            app or statement. The value, the graphs and the forecast follow. A fund statement from
            the <Link href="/import">Import page</Link> fills all of this in by itself.
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
    </>
  );
}
