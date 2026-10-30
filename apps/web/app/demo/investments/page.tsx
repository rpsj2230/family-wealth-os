import type { Metadata } from 'next';
import { RULES, effectiveRules, parseRange, personStyles } from '@fwos/core';
import { InvestShell, parseTab, PERSON_TABS } from '@/app/(app)/investments/InvestShell';
import { MatchTab } from '@/app/(app)/investments/Parts';
import { DemoShell } from '@/components/DemoShell';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { ListingTools } from '@/components/ListingTools';
import { DEMO_PEOPLE, DEMO_TODAY, demoView } from '@/lib/demo-funds';
import { fundsPosition } from '@/lib/fund-holdings';
import type { MatchRow } from '@/lib/match-data';
import { demoUnmatched } from '@/lib/demo-match';
import { sampleApproveCertain, sampleFinish, sampleSave, sampleSearch } from '../sample-actions';

export const metadata: Metadata = {
  title: 'Sample investments',
  robots: { index: false, follow: false },
};

const TODAY = DEMO_TODAY;
/** allowance already used this year in the sample, the same as the sample Tax page */
const SAMPLE_USED: Record<string, number> = { p1: 20_000 };
const SAMPLE_EXEMPTION = effectiveRules(TODAY, RULES)?.rules.equity.ltcgExemption ?? 0;
const PEOPLE = DEMO_PEOPLE;
const FUNDS = demoView(null, 'all').groups.flatMap((g) => g.funds);

const MATCH: MatchRow[] = [
  // the funds with no price source: the sample's own ranking and wording (see lib/demo-match.ts)
  ...demoUnmatched(),
  ...FUNDS.filter((f) => f.amfiCode).map((f): MatchRow => ({
    assetId: f.assetId,
    name: f.name,
    ownerName: PEOPLE.find((p) => p.id === f.ownerId)?.name ?? '',
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    amfiCode: f.amfiCode,
    schemeName: `${f.name} - Direct Plan - Growth`,
    lastValue: { amount: f.value, asOf: '2026-10-23' },
    exitLoadFraction: f.assetId === 'f2' ? 0.01 : null,
    exitLoadDays: f.assetId === 'f2' ? 365 : null,
    folioLast4: f.folioLast4,
    units: f.units,
    invested: f.invested,
    isin: null,
    closed: false,
    noPriceSource: false,
    proposal: null,
    certainty: null,
  })),
];

const actions = {
  clearMatch: sampleSave,
  setExitLoad: sampleSave,
  lookAgain: sampleSave,
  decide: sampleSave,
  approveCertain: sampleApproveCertain,
  fetchPrices: sampleSave,
  search: sampleSearch,
  finish: sampleFinish,
};

/** The sample pages have a page for these funds only; the invented unmatched ones have none. */
const hrefOf = (id: string) =>
  FUNDS.some((f) => f.assetId === id) ? `/demo/asset?kind=fund&id=${id}` : null;

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
    g?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const tab = parseTab(sp.tab);
  const styles = personStyles(PEOPLE);
  const who = PERSON_TABS.includes(tab) && sp.p && styles[sp.p] ? sp.p : null;
  const range = tab === 'performance' ? parseRange(sp.range) : 'all';
  const view = demoView(who, range);
  const full = demoView(null, 'all');
  // the sample's funds without a price source: the one in the fund list and the invented ones of the Match funds tab
  const noPrice = MATCH.filter((r) => !r.amfiCode).length;
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
        position={tab === 'valuation' ? fundsPosition(full) : undefined}
        taxFree={
          tab === 'overview'
            ? {
                exemption: SAMPLE_EXEMPTION,
                // the sample Tax page's figure: ₹20,000 of the allowance already used by the first person this year
                people: view.groups
                  .filter((g) => g.funds.length > 0)
                  .map((g) => ({
                    name: g.name,
                    left: Math.max(0, SAMPLE_EXEMPTION - (SAMPLE_USED[g.ownerId] ?? 0)),
                  })),
              }
            : null
        }
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
            <MatchTab rows={MATCH} haveList hrefOf={hrefOf} disabled={false} actions={actions} />
          </ListingTools>
        )}
      </InvestShell>
    </DemoShell>
  );
}
