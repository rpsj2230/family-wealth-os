import type { Metadata } from 'next';
import Link from 'next/link';
import { isThirdPartyNote } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { DEMO_SYNC_OFFERS, DEMO_SYNC_SOURCES, DEMO_SYNC_TODAY } from '@/lib/demo-rates-sync';
import { buildSyncRows } from '@/lib/rates-sync-view';
import { DEMO_RATE_PREFS } from '@/lib/demo-rates';
import { DemoSync } from './DemoSync';

export const metadata: Metadata = {
  title: 'Sample: Sync bank rates',
  robots: { index: false, follow: false },
};

/** Public preview of the Sync bank rates page with invented banks: no private data is read, and the buttons only act the sync out. */
export default function DemoSyncRates() {
  const rows = buildSyncRows({
    sources: DEMO_SYNC_SOURCES,
    offers: DEMO_SYNC_OFFERS,
    today: DEMO_SYNC_TODAY,
    staleDays: DEMO_RATE_PREFS.staleDays,
    registry: () => [],
  });
  const thirdParty = DEMO_SYNC_OFFERS.filter((o) => isThirdPartyNote(o.sourceNote)).length;
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented banks and rates, to show the page. The buttons act the sync out and nothing is
        saved or read from any website. <Link href="/demo/rates">Back to the Rates sample</Link>.
      </p>
      <PageHead
        title="Sync bank rates (sample)"
        subtitle="Read every bank's rates from its own pages, one bank at a time, and see what each bank said."
        pills={[
          { label: `${rows.length} banks`, tone: 'info' },
          { label: `${DEMO_SYNC_OFFERS.length} rates on file` },
        ]}
      />
      <p className="notice" role="note">
        Rates are only ever read from the bank&apos;s own pages. If a page cannot be read, this page
        says so plainly and you can paste the page text instead.
      </p>
      <DemoSync rows={rows} thirdParty={thirdParty} />
    </main>
  );
}
