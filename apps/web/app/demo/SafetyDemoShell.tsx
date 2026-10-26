import Link from 'next/link';
import { BottomNav, Sidebar } from '@/components/AppNav';

async function noSignOut() {
  'use server';
}

/** The app frame (sidebar, top bar, bottom bar) around a public sample page with invented data. */
export function SafetyDemoShell({
  children,
  notice = 'Sample screen with invented names and numbers.',
}: {
  children: React.ReactNode;
  notice?: string;
}) {
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            {notice} <Link href="/login">Sign in</Link> to see your own.
          </p>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}

export { noSignOut };
