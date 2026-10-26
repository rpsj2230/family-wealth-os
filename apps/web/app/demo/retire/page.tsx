import { DEFAULT_SETTINGS } from '@fwos/core';
import type { Metadata } from 'next';
import Link from 'next/link';
import { RetireClient } from '@/components/RetireClient';

export const metadata: Metadata = {
  title: 'Sample: Can I retire now?',
  robots: { index: false, follow: false },
};

/** Public sample with invented numbers so the page can be seen (and tested) without any private data. */
export default async function DemoRetire({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <h1>Can I retire now? (sample)</h1>
      <RetireClient
        sample
        tab={tab}
        base="/demo/retire"
        initial={{
          ...DEFAULT_SETTINGS,
          primaryDob: '1990-01-01',
          spouseDob: '1993-01-01',
          monthlySpendingToday: 150_000,
          retireAtAge: 55,
        }}
        holdings={{
          cash: 15_000_000,
          equity: 4_000_000,
          locked: 100_000,
          excluded: [{ label: 'Property (not sold)', amount: 2_500_000 }],
        }}
        sipMonthly={115_000}
        asOf="2026-10-26"
        softShare={0.2}
      />
    </main>
  );
}
