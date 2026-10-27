import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canonicalBanks, sameBank, sourceStatus, withRunAge } from '@fwos/core';
import { BankView, parseBankTab } from '@/app/(app)/rates/BankView';
import {
  DEMO_EVENTS,
  DEMO_HINTS,
  DEMO_HOLDINGS,
  DEMO_OFFERS,
  DEMO_RATES_TODAY,
  DEMO_RATE_PREFS,
  DEMO_SOURCES,
} from '@/lib/demo-rates';
import { slugify } from '@/lib/slug';

export const metadata: Metadata = {
  title: 'Sample: one bank’s rates',
  robots: { index: false, follow: false },
};

/** Public preview of a bank's rates page with invented data. Edits are not stored: the rows only show how editing works. */
export default async function DemoBank({
  params,
  searchParams,
}: {
  params: Promise<{ bank: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { bank: slug } = await params;
  const sp = await searchParams;
  const names = canonicalBanks([
    ...DEMO_HOLDINGS.map((h) => h.bank),
    ...DEMO_OFFERS.map((o) => o.bank),
  ]);
  const bank = names.find((n) => slugify(n) === slug);
  if (!bank) notFound();
  const src = DEMO_SOURCES.find((s) => sameBank(s.bank, bank)) ?? null;
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented bank and rates. You can change a figure to see how editing works; nothing is saved
        here.
      </p>
      <BankView
        bank={bank}
        offers={DEMO_OFFERS.filter((o) => sameBank(o.bank, bank))}
        events={DEMO_EVENTS.filter((e) => sameBank(e.bank, bank))}
        hints={DEMO_HINTS.filter((h) => sameBank(h.bank, bank))}
        source={withRunAge(sourceStatus(src, DEMO_RATES_TODAY), DEMO_RATES_TODAY)}
        today={DEMO_RATES_TODAY}
        staleDays={DEMO_RATE_PREFS.staleDays}
        tab={parseBankTab(sp.tab)}
        base={`/demo/rates/${slugify(bank)}`}
        backHref="/demo/rates"
        newMoneyHref="/demo/new-money"
        syncHref="/demo/rates/sync"
        held={DEMO_HOLDINGS.filter((h) => sameBank(h.bank, bank)).reduce(
          (t, h) => t + h.current,
          0,
        )}
      />
    </main>
  );
}
