import Link from 'next/link';
import type { ReactNode } from 'react';
import { BottomNav, Sidebar } from './AppNav';

async function noSignOut() {
  'use server';
}

/** The frame of the public sample pages: the real navigation, a notice that the figures are invented, and the page. */
export function DemoShell({ children, notice }: { children: ReactNode; notice?: ReactNode }) {
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
            {notice ?? (
              <>
                Sample with invented names and amounts. Nothing is saved here.{' '}
                <Link href="/login">Sign in</Link> to see your own.
              </>
            )}
          </p>
          {children}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
