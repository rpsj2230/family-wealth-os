import type { Metadata } from 'next';
import { parseRange, personStyles } from '@fwos/core';
import { InvestShell, parseTab, PERSON_TABS } from '@/app/(app)/investments/InvestShell';
import { MatchTab } from '@/app/(app)/investments/Parts';
import { DemoShell } from '@/components/DemoShell';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { DEMO_PEOPLE, DEMO_TODAY, demoView } from '@/lib/demo-funds';
import type { MatchRow } from '@/lib/match-data';
import { sampleSave } from '../sample-actions';

export const metadata: Metadata = {
  title: 'Sample investments',
  robots: { index: false, follow: false },
};

const TODAY = DEMO_TODAY;
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
  const styles = personStyles(PEOPLE);
  const who = PERSON_TABS.includes(tab) && sp.p && styles[sp.p] ? sp.p : null;
  const range = tab === 'performance' ? parseRange(sp.range) : 'all';
  const view = demoView(who, range);
  const full = demoView(null, 'all');
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
      <InvestShell
        base="/demo/investments"
        demo
        q={{ ...sp, tab }}
        view={view}
        styles={styles}
        owners={PEOPLE}
        noPrice={noPrice}
      >
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
      </InvestShell>
    </DemoShell>
  );
}
