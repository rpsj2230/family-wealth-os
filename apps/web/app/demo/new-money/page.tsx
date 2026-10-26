import type { Metadata } from 'next';
import Link from 'next/link';
import { NewMoneyView, parseNmTab } from '@/app/(app)/new-money/NewMoneyView';
import {
  DEMO_HOLDINGS,
  DEMO_LIMIT,
  DEMO_OFFERS,
  DEMO_PEOPLE,
  DEMO_RATES_TODAY,
  DEMO_RATE_PREFS,
  DEMO_STYLES,
} from '@/lib/demo-rates';

export const metadata: Metadata = {
  title: 'Sample: New money',
  robots: { index: false, follow: false },
};

/** Public preview of New money with invented rates and holdings. */
export default async function DemoNewMoney({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <p className="notice warn" role="note">
        Invented banks, rates and balances. Try{' '}
        {['1500000', '2500000', '6000000'].map((a) => (
          <Link key={a} href={`/demo/new-money?amount=${a}`} style={{ marginRight: 10 }}>
            ₹{Number(a).toLocaleString('en-IN')}
          </Link>
        ))}
      </p>
      <NewMoneyView
        sp={sp}
        tab={parseNmTab(sp.tab)}
        people={DEMO_PEOPLE}
        styles={DEMO_STYLES}
        offers={DEMO_OFFERS}
        holdings={DEMO_HOLDINGS}
        prefs={DEMO_RATE_PREFS}
        limit={DEMO_LIMIT}
        today={DEMO_RATES_TODAY}
        baselineRate={0.03}
        base="/demo/new-money"
        formAction="/demo/new-money"
        ratesHref="/demo/rates"
        banksBase="/demo/rates"
      />
    </main>
  );
}
