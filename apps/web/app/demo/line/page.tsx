import type { Metadata } from 'next';
import Link from 'next/link';
import { accountLines, lineDetail } from '@fwos/data';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { LineView } from '@/components/LineView';
import { StatementLines } from '@/components/StatementLines';
import { demoTrail } from '@/lib/demo-trail';

export const metadata: Metadata = {
  title: 'Sample: a transaction and its trail',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of an account's statement lines and one line's page with its trail, on the invented sample household. */
export default async function DemoLine({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; l?: string }>;
}) {
  const sp = await searchParams;
  const { data, labels, names, accounts } = demoTrail();
  const assetId = data.holdings.some((h) => h.id === sp.a && h.statements) ? sp.a! : accounts.b;
  const lines = accountLines(data, assetId);
  const d = lineDetail(
    data,
    sp.l ?? lines.find((l) => l.amount > 0 && l.kind !== 'Interest')?.id ?? '',
  );
  const href = (a: string, l?: string) => `/demo/line?a=${a}${l ? `&l=${l}` : ''}`;
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            Sample with invented figures. <Link href="/login">Sign in</Link>
          </p>
          {d && d.line.assetId === assetId && (
            <LineView
              d={d}
              data={data}
              labels={labels}
              names={names}
              lineHref={(a, l) => href(a, l)}
              assetHref={(a) => href(a)}
              trailHref={(a) => `/demo/trail?h=${a}`}
              answerHref="/demo/reconcile"
            />
          )}
          <StatementLines
            assetId={assetId}
            lines={lines}
            hrefTemplate={`/demo/line?a=${assetId}&l={id}`}
            answerHref="/demo/reconcile"
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
