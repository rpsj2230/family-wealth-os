import type { Metadata } from 'next';
import { parseHomeRange } from '@fwos/core';
import { EarnedSavedView } from '@/app/(app)/earned-saved/EarnedSavedView';
import { DemoShell } from '@/components/DemoShell';
import { PageHead } from '@/components/PageHead';
import { demoHomeInput } from '@/lib/demo-home';
import { buildHome } from '@/lib/home';

export const metadata: Metadata = {
  title: 'Earned and saved (sample)',
  robots: { index: false, follow: false },
};

/** Public preview of Earned and saved with the invented household of the sample Home: no private data is read. */
export default async function DemoEarnedSaved({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string }>;
}) {
  const { fy } = await searchParams;
  const years = buildHome(demoHomeInput(parseHomeRange(undefined))).capital.years;
  const asked = Number(fy);
  return (
    <DemoShell>
      <PageHead
        title="Earned and saved"
        subtitle="What the holdings earned and what the family saved, every financial year; choose a year for its months."
      />
      <EarnedSavedView
        years={years}
        fy={years.some((y) => y.fy === asked) ? asked : (years[0]?.fy ?? 0)}
        base="/demo/earned-saved"
        byTag={null}
        sample
      />
    </DemoShell>
  );
}
