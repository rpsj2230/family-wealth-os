import type { Metadata } from 'next';
import Link from 'next/link';
import { formatInr, parseRange, personStyles } from '@fwos/core';
import { BreakdownTab, GrowthTab } from '@/app/(app)/investments/Insights';
import { FundsTab, InvestKpis, MatchTab } from '@/app/(app)/investments/Parts';
import { DemoShell } from '@/components/DemoShell';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { DEMO_PEOPLE, DEMO_TODAY, demoView } from '@/lib/demo-funds';
import { investGrowth, investStats } from '@/lib/invest-view';
import { fundPace } from '@/lib/investments';
import type { MatchRow } from '@/lib/match-data';
import { sampleSave } from '../sample-actions';

export const metadata: Metadata = {
  title: 'Sample investments',
  robots: { index: false, follow: false },
};

const TODAY = DEMO_TODAY;
const TABS = ['funds', 'breakdown', 'growth', 'update', 'match'] as const;
const PEOPLE = DEMO_PEOPLE;
const FUNDS = demoView(null, 'all').groups.flatMap((g) => g.funds);

const MATCH: MatchRow[] = [
  {
    assetId: 'f4',
    name: 'Sample Hybrid Fund',
    ownerName: 'Beena',
    sipMonthly: null,
    sipStopped: false,
    navHint: 41.2,
    amfiCode: null,
    lastValue: { amount: 410_000, asOf: '2026-09-28' },
    exitLoadFraction: null,
    exitLoadDays: null,
    candidates: [
      {
        code: '118001',
        name: 'Sample Hybrid Fund - Direct Plan - Growth',
        plan: 'Direct',
        amc: 'Sample AMC',
        navGap: 0.03,
      },
      {
        code: '118002',
        name: 'Sample Hybrid Fund - Regular Plan - Growth',
        plan: 'Regular',
        amc: 'Sample AMC',
        navGap: 0.12,
      },
    ],
    confident: true,
  },
  ...FUNDS.filter((f) => f.amfiCode).map((f): MatchRow => ({
    assetId: f.assetId,
    name: f.name,
    ownerName: PEOPLE.find((p) => p.id === f.ownerId)?.name ?? '',
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    navHint: null,
    amfiCode: f.amfiCode,
    lastValue: { amount: f.value, asOf: '2026-10-23' },
    exitLoadFraction: f.assetId === 'f2' ? 0.01 : null,
    exitLoadDays: f.assetId === 'f2' ? 365 : null,
    candidates: [],
    confident: false,
  })),
];

const actions = { confirmMatch: sampleSave, clearMatch: sampleSave, setExitLoad: sampleSave };

/** Public preview of the Investments page with invented funds: no private data is read. */
export default async function DemoInvestments({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; tab?: string; range?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'funds';
  const styles = personStyles(PEOPLE);
  const filtered = tab === 'funds' || tab === 'breakdown' || tab === 'growth';
  const who = filtered && sp.p && styles[sp.p] ? sp.p : null;
  const range = tab === 'growth' ? parseRange(sp.range) : 'all';
  const view = demoView(who, range);
  const full = demoView(null, 'all');
  const stats = investStats(view);
  const noPrice = view.groups.flatMap((g) => g.funds).filter((f) => !f.amfiCode).length;
  const updateFunds: FundInput[] = full.groups.flatMap((g) =>
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
  return (
    <DemoShell>
      <PageHead
        title="Investments"
        subtitle="Mutual funds by person (PAN holder). Prices are fetched every day for funds you have matched; once a month you enter the units and the amount put in."
        pills={[
          { label: `${view.household.funds} funds`, tone: 'info' },
          noPrice > 0
            ? { label: `${noPrice} without a live price`, tone: 'warn' }
            : { label: 'all funds follow their price', tone: 'ok' },
        ]}
        actions={
          <>
            <Link className="btn primary" href="/demo/investments?tab=update">
              Update funds
            </Link>
            <Link className="btn" href="/demo/tax-harvest">
              Tax harvest
            </Link>
          </>
        }
      />
      <InvestKpis view={view} noPrice={noPrice} stats={stats.all} />
      <Tabs
        base="/demo/investments"
        current={tab}
        keep={who ? { p: who } : {}}
        tabs={[
          { key: 'funds', label: 'Funds' },
          { key: 'breakdown', label: 'Breakdown' },
          { key: 'growth', label: 'Growth' },
          { key: 'update', label: 'Update funds' },
          { key: 'match', label: 'Match funds', badge: noPrice },
        ]}
      />
      {filtered && (
        <PersonFilter
          people={Object.values(styles)}
          basePath="/demo/investments"
          current={who}
          totals={Object.fromEntries(
            view.groups.map((g) => [g.ownerId, formatInr(Math.round(g.totals.value))]),
          )}
          keep={{ tab, ...(tab === 'growth' ? { range } : {}) }}
        />
      )}
      {tab === 'funds' && (
        <ListingTools name="investments">
          <FundsTab view={view} styles={styles} stats={stats.byOwner} />
        </ListingTools>
      )}
      {tab === 'breakdown' && (
        <BreakdownTab
          view={view}
          stats={stats.all}
          byOwner={stats.byOwner}
          who={who}
          styles={styles}
        />
      )}
      {tab === 'growth' && (
        <GrowthTab
          view={view}
          growth={investGrowth(view)}
          pace={fundPace(view)}
          who={who}
          styles={styles}
          base="/demo/investments"
        />
      )}
      {tab === 'update' && (
        <>
          <p className="lead muted updatehelp">
            Once a month, enter the units you hold and the price (NAV) of each fund from your fund
            app or statement. The value, the graphs and the forecast follow.
          </p>
          <section className="card">
            <FundUpdateGrid funds={updateFunds} today={TODAY} save={sampleSave} />
          </section>
          <FundTransactionForm
            today={TODAY}
            funds={updateFunds.map((f) => ({ id: f.assetId, name: f.name, owner: f.owner }))}
            save={sampleSave}
          />
        </>
      )}
      {tab === 'match' && (
        <ListingTools name="match-funds">
          <MatchTab rows={MATCH} haveList actions={actions} />
        </ListingTools>
      )}
    </DemoShell>
  );
}
