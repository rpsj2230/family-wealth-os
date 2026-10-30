import type { Metadata } from 'next';
import Link from 'next/link';
import { buildHandbook } from '@fwos/core';
import { HandbookGuide } from '@/app/(app)/emergency/HandbookGuide';
import { demoHandbookInput } from '@/lib/demo-handbook';

export const metadata: Metadata = {
  title: 'Sample family handbook',
  robots: { index: false, follow: false },
};

/**
 * Public preview of the handbook with invented people. ?empty=1 shows a handbook nobody has filled in; ?owner=1 the owner's view
 * with the "what is still missing" meter. Ticks work in this browser only: nothing is saved.
 */
export default async function DemoEmergency({
  searchParams,
}: {
  searchParams: Promise<{ empty?: string; owner?: string }>;
}) {
  const sp = await searchParams;
  const doc = buildHandbook(demoHandbookInput(!sp.empty));
  return (
    <main className="content" style={{ maxWidth: 940, margin: '0 auto' }}>
      <p className="notice warn noprint" role="note">
        Sample handbook with invented people. <Link href="/login">Sign in</Link> to see your own.
      </p>
      <HandbookGuide
        guide={doc.guide!}
        generatedAt="2026-10-26T01:30:00Z"
        initialTicks={{}}
        member={!!sp.owner}
        accessNote={sp.owner ? 'The read-only family login can always open this.' : undefined}
      />
    </main>
  );
}
