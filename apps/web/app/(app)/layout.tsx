import Link from 'next/link';
import { signOut } from '../login/actions';
import { loadAccess } from '@/lib/data';
import { BottomNav, Sidebar } from '@/components/AppNav';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await loadAccess();
  if (ctx.role === 'emergency_viewer')
    return (
      <div className="viewer">
        <header className="topbar">
          <Link href="/emergency" className="brand">
            <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
            <span>Family handbook</span>
          </Link>
          <form action={signOut} style={{ marginLeft: 'auto' }}>
            <button className="btn ghost compact" type="submit">
              Sign out
            </button>
          </form>
        </header>
        <main className="content">{children}</main>
      </div>
    );
  return (
    <div className="shell">
      <Sidebar email={ctx.email} signOut={signOut} />
      <div>
        <header className="topbar">
          <Link href="/" className="brand">
            <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">{children}</main>
      </div>
      <BottomNav />
    </div>
  );
}
