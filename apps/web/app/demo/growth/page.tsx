import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  moneyAtWork,
  moveFromSuggestion,
  projectGrowth,
  type WorkHoldingIn,
} from '@fwos/core';
import { GrowthView, parseGrowthTab } from '@/app/(app)/growth/GrowthView';

export const metadata: Metadata = { title: 'Money at work (sample)' };

const TODAY = '2026-10-29';
const h = (
  o: Partial<WorkHoldingIn> &
    Pick<WorkHoldingIn, 'id' | 'name' | 'kind' | 'type' | 'value' | 'rate'>,
): WorkHoldingIn => ({
  ownerId: 'a',
  owner: 'Anil',
  bank: null,
  rateBasis: 'sample',
  taxRate: 0,
  monthly: 0,
  ...o,
});

/** Invented holdings, to show the page without signing in. */
const HOLDINGS: WorkHoldingIn[] = [
  h({
    id: 's1',
    name: 'Cash-NRO-1111',
    kind: 'cash',
    type: 'Savings',
    bank: 'Sample Bank',
    value: 1_250_000,
    rate: 0.03,
    taxRate: 0.3,
    rateBasis: 'the rate list for this bank and balance',
  }),
  h({
    id: 's2',
    name: 'Cash-NRE-2222',
    kind: 'cash',
    type: 'Savings',
    bank: 'Sample Equity Bank',
    value: 420_000,
    rate: 0.035,
    rateBasis: 'the rate list for this bank and balance',
  }),
  h({
    id: 'd1',
    name: 'FD-NRE-2222',
    kind: 'fd',
    type: 'Fixed deposit',
    bank: 'Sample Equity Bank',
    value: 2_150_000,
    rate: 0.0725,
    rateBasis: 'the deposit’s rate',
  }),
  h({
    id: 'd2',
    name: 'FD-NRE-3333',
    kind: 'fd',
    type: 'Fixed deposit',
    bank: 'Sample Bank',
    owner: 'Beena',
    ownerId: 'b',
    value: 1_040_000,
    rate: 0.068,
    rateBasis: 'the deposit’s rate',
  }),
  h({
    id: 'f1',
    name: 'Sample Flexi Cap Fund',
    kind: 'funds',
    type: 'Mutual fund',
    value: 1_860_000,
    rate: 0.141,
    monthly: 15_000,
    rateBasis: 'its own yearly return (XIRR)',
  }),
  h({
    id: 'f2',
    name: 'Sample Index Fund',
    kind: 'funds',
    type: 'Mutual fund',
    owner: 'Beena',
    ownerId: 'b',
    value: 640_000,
    rate: 0.118,
    monthly: 10_000,
    rateBasis: 'its own yearly return (XIRR)',
  }),
  h({
    id: 'f3',
    name: 'Sample Banking Fund',
    kind: 'funds',
    type: 'Mutual fund',
    value: 310_000,
    rate: 0.041,
    rateBasis: 'its own yearly return (XIRR)',
  }),
  h({
    id: 'l1',
    name: 'Loan to a friend',
    kind: 'others',
    type: 'Money lent',
    value: 200_000,
    rate: 0,
  }),
];

export default async function DemoGrowthPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const inflation = 0.06;
  const work = moneyAtWork({
    holdings: HOLDINGS,
    inflation,
    goodMargin: DEFAULT_CONFIG.growth.goodMargin,
    moves: [
      moveFromSuggestion({
        assetId: 's1',
        ownerName: 'Anil',
        from: 'Sample Bank',
        to: 'Sample Equity Bank',
        product: 'savings',
        toProduct: 'fd',
        amount: 1_150_000,
        currentRate: 0.021,
        newRate: 0.0525,
        annualGain: 1_150_000 * (0.0525 - 0.021),
        when: 'now',
        on: null,
      }),
    ],
  });
  const projection = projectGrowth({
    work,
    years: DEFAULT_CONFIG.growth.years,
    steps: DEFAULT_CONFIG.growth.steps,
    stepUp: 0.05,
    today: TODAY,
    dobs: ['1984-04-10', '1986-01-01'],
  });
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Sample screen with invented holdings. Sign in to see your own.
      </p>
      <GrowthView
        work={work}
        projection={projection}
        tab={parseGrowthTab(sp.tab)}
        base="/demo/growth"
        ageNames={['Anil', 'Beena']}
        longRunEquity={0.1}
        today={TODAY}
      />
    </main>
  );
}
