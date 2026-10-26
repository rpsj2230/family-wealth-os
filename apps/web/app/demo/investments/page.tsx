import type { Metadata } from 'next';
import Link from 'next/link';
import { combineSeries, formatInr, personStyles, type SeriesPoint } from '@fwos/core';
import { FundsTab, GrowthTab, InvestKpis, MatchTab } from '@/app/(app)/investments/Parts';
import { DemoShell } from '@/components/DemoShell';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { fundPace, type FundRow, type InvestmentView, type Totals } from '@/lib/investments';
import type { MatchRow } from '@/lib/match-data';
import { sampleSave } from '../sample-actions';

export const metadata: Metadata = {
  title: 'Sample investments',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';
const TABS = ['funds', 'growth', 'update', 'match'] as const;
const PEOPLE = [
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
];

const month = (back: number) => {
  const d = new Date(Date.UTC(2026, 9 - back, 1));
  d.setUTCMonth(d.getUTCMonth() + 1, 0);
  return d.toISOString().slice(0, 10);
};
/** 18 months of value growing from `start` to `value`, and money put in growing from `inv0` to `invested`. */
const history = (start: number, value: number, inv0: number, invested: number): SeriesPoint[] =>
  Array.from({ length: 19 }, (_, i) => {
    const t = i / 18;
    return {
      date: i === 18 ? TODAY : month(17 - i),
      value: Math.round(start + (value - start) * t + Math.sin(i * 1.3) * value * 0.012),
      invested: Math.round(inv0 + (invested - inv0) * t),
    };
  });

const fund = (
  o: Partial<FundRow> & Pick<FundRow, 'assetId' | 'ownerId' | 'name' | 'value' | 'invested'>,
): FundRow => ({
  startedOn: '2021-06-01',
  sipMonthly: null,
  sipStopped: false,
  xirr: 0.132,
  xirrEstimated: false,
  gain: o.value - o.invested,
  dayAmount: Math.round(o.value * 0.0024),
  dayPct: 0.0024,
  dayFrom: '2026-10-22',
  dayTo: '2026-10-23',
  goalIds: [],
  valueBasis: 'units × live price',
  units: Math.round((o.value / 52.1) * 1000) / 1000,
  nav: 52.1,
  navDate: '2026-10-23',
  amfiCode: '120503',
  history: history(o.invested * 0.5, o.value, o.invested * 0.45, o.invested),
  updatedOn: '2026-10-23',
  updatedSource: { label: 'Automatic, 23 Oct', kind: 'auto' },
  ...o,
});

const FUNDS: FundRow[] = [
  fund({
    assetId: 'f1',
    ownerId: 'p1',
    name: 'Sample Flexi Cap Fund',
    value: 1_820_000,
    invested: 1_300_000,
    sipMonthly: 25_000,
    goalIds: ['g1'],
  }),
  fund({
    assetId: 'f2',
    ownerId: 'p1',
    name: 'Sample Small Cap Fund',
    value: 940_000,
    invested: 700_000,
    sipMonthly: 15_000,
    xirr: 0.186,
    startedOn: '2024-02-01',
  }),
  fund({
    assetId: 'f3',
    ownerId: 'p2',
    name: 'Sample Index Fund',
    value: 1_160_000,
    invested: 980_000,
    xirr: 0.104,
    xirrEstimated: true,
    sipMonthly: 10_000,
    sipStopped: true,
    goalIds: ['g1'],
  }),
  fund({
    assetId: 'f4',
    ownerId: 'p2',
    name: 'Sample Hybrid Fund',
    value: 410_000,
    invested: 430_000,
    xirr: -0.021,
    amfiCode: null,
    dayAmount: null,
    dayPct: null,
    dayFrom: null,
    dayTo: null,
    nav: null,
    navDate: null,
    valueBasis: 'last recorded value (no live price yet)',
    updatedOn: '2026-09-28',
    updatedSource: { label: 'You, 28 Sep', kind: 'manual' },
  }),
];

function totals(rows: FundRow[]): Totals {
  const value = rows.reduce((a, f) => a + f.value, 0);
  const invested = rows.reduce((a, f) => a + f.invested, 0);
  const withDay = rows.filter((f) => f.dayAmount !== null);
  const day = withDay.reduce((a, f) => a + (f.dayAmount ?? 0), 0);
  return {
    funds: rows.length,
    value,
    invested,
    gain: value - invested,
    xirr: 0.124,
    xirrEstimated: rows.some((f) => f.xirrEstimated),
    dayAmount: day,
    dayPct: withDay.length > 0 ? day / (value - day) : null,
    sipMonthly: rows.filter((f) => !f.sipStopped).reduce((a, f) => a + (f.sipMonthly ?? 0), 0),
  };
}

function viewFor(who: string | null): InvestmentView {
  const groups = PEOPLE.filter((p) => !who || p.id === who).map((p) => {
    const funds = FUNDS.filter((f) => f.ownerId === p.id);
    return {
      ownerId: p.id,
      name: p.name,
      panLast4: p.id === 'p1' ? '4321' : null,
      funds,
      totals: totals(funds),
      series: combineSeries(funds.map((f) => f.history)),
    };
  });
  const all = groups.flatMap((g) => g.funds);
  return {
    today: TODAY,
    groups,
    household: totals(all),
    series: combineSeries(all.map((f) => f.history)),
    goals: [{ id: 'g1', name: 'Education fund' }],
  };
}

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
  searchParams: Promise<{ p?: string; tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'funds';
  const styles = personStyles(PEOPLE);
  const filtered = tab === 'funds' || tab === 'growth';
  const who = filtered && sp.p && styles[sp.p] ? sp.p : null;
  const view = viewFor(who);
  const full = viewFor(null);
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
      <InvestKpis view={view} noPrice={noPrice} />
      <Tabs
        base="/demo/investments"
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
          basePath="/demo/investments"
          current={who}
          totals={Object.fromEntries(
            view.groups.map((g) => [g.ownerId, formatInr(Math.round(g.totals.value))]),
          )}
          keep={{ tab }}
        />
      )}
      {tab === 'funds' && (
        <ListingTools name="investments">
          <FundsTab view={view} styles={styles} />
        </ListingTools>
      )}
      {tab === 'growth' && (
        <GrowthTab view={view} pace={fundPace(view)} who={who} styles={styles} />
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
