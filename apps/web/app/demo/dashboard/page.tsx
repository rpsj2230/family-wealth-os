import type { Metadata } from 'next';
import { parseHomeRange, parseMovementKey } from '@fwos/core';
import { HomeView } from '@/app/(app)/dashboard/HomeView';
import { DemoShell } from '@/components/DemoShell';
import { PageHead } from '@/components/PageHead';
import { niceDate } from '@/lib/dates';
import { demoHomeInput } from '@/lib/demo-home';
import { buildHome } from '@/lib/home';

export const metadata: Metadata = {
  title: 'Sample dashboard',
  robots: { index: false, follow: false },
};

/** Public preview of Home with an invented household: the same view as the signed-in page, no private data is read. */
export default async function DemoDashboard({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; period?: string; from?: string; to?: string }>;
}) {
  const { range, period, from, to } = await searchParams;
  const home = buildHome({
    ...demoHomeInput(parseHomeRange(range)),
    movement: {
      key: parseMovementKey(period),
      custom: { ...(from ? { from } : {}), ...(to ? { to } : {}) },
    },
  });
  const late = home.attention.filter((a) => a.tone === 'bad').length;
  return (
    <DemoShell>
      <PageHead
        title="Family wealth"
        subtitle="What the family is worth today, what changed, and what needs you."
        pills={[
          { label: `values as of ${niceDate(home.asOf ?? home.today)}`, tone: 'info' },
          home.attention.length === 0
            ? { label: 'Nothing needs you', tone: 'ok' }
            : {
                label: `${home.attention.length} need${home.attention.length === 1 ? 's' : ''} you${late > 0 ? `, ${late} late` : ''}`,
                tone: late > 0 ? 'bad' : 'warn',
              },
        ]}
      />
      <HomeView m={home} sample />
    </DemoShell>
  );
}
