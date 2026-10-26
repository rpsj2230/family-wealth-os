import type { Metadata } from 'next';
import Link from 'next/link';
import { buildBoardCards, parseSort, parseView } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { BoardToolbar, RateBoard } from '@/app/(app)/rates/Board';
import {
  DEMO_EVENTS,
  DEMO_HOLDINGS,
  DEMO_OFFERS,
  DEMO_RATES_TODAY,
  DEMO_RATE_PREFS,
  DEMO_SOURCES,
} from '@/lib/demo-rates';

export const metadata: Metadata = {
  title: 'Sample: Rates',
  robots: { index: false, follow: false },
};

/** Public preview of the rate board with invented banks: no private data is read. */
export default async function DemoRates({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const view = parseView(sp.view);
  const sort = parseSort(sp.sort);
  const cards = buildBoardCards({
    offers: DEMO_OFFERS,
    events: DEMO_EVENTS,
    holdings: DEMO_HOLDINGS,
    sources: DEMO_SOURCES,
    today: DEMO_RATES_TODAY,
    staleDays: DEMO_RATE_PREFS.staleDays,
    view,
    sort,
  });
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented banks and rates, to show the page. Nothing here is your data.{' '}
        <Link href="/demo/new-money">See the New money sample</Link>.
      </p>
      <PageHead
        title="Rates (sample)"
        subtitle="What each bank pays, where every figure came from and when it was last checked."
        pills={[
          { label: `${DEMO_OFFERS.length} rates on file`, tone: 'info' },
          { label: 'newest check 21 Oct 2026' },
        ]}
      />
      <BoardToolbar base="/demo/rates" view={view} sort={sort} />
      <RateBoard cards={cards} staleDays={DEMO_RATE_PREFS.staleDays} base="/demo/rates" />
    </main>
  );
}
