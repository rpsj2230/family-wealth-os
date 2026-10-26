import type { Metadata } from 'next';
import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { ReorderList, type ReorderBank } from '@/components/ReorderList';
import { demoModel } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample: change the order',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

export default function DemoReorder() {
  const { blocks, styles } = demoModel();
  const banks: ReorderBank[] = blocks.map((b) => ({
    key: b.key,
    name: b.name,
    rows: b.sections
      .flatMap((s) => s.rows)
      .sort((x, y) => x.order - y.order)
      .map((r) => ({ id: r.assetId, code: r.code, ownerId: r.ownerId })),
  }));
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
            Sample with invented names. Nothing is saved here. <Link href="/login">Sign in</Link> to
            change your own order.
          </p>
          <h1>Change the order</h1>
          <p className="muted">Drag a bank or a row, or use the arrow buttons.</p>
          <ReorderList banks={banks} styles={styles} />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
