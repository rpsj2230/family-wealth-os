'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  CalendarCheck,
  Ellipsis,
  FileText,
  HandCoins,
  Inbox,
  Landmark,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Palmtree,
  Percent,
  Banknote,
  Receipt,
  Settings,
  ShieldAlert,
  Target,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react';

interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Overview',
    items: [
      { href: '/', label: 'Home', icon: LayoutDashboard },
      { href: '/accounts', label: 'Accounts', icon: Landmark },
      { href: '/investments', label: 'Investments', icon: TrendingUp },
      { href: '/raise', label: 'I need money', icon: Banknote },
      { href: '/rates', label: 'Rates and new money', icon: Percent },
      { href: '/monthly', label: 'Monthly update', icon: CalendarCheck },
    ],
  },
  {
    title: 'Plan and tax',
    items: [
      { href: '/retire', label: 'Can I retire now?', icon: Palmtree },
      { href: '/goals', label: 'Goals', icon: Target },
      { href: '/tasks', label: 'Plan and tasks', icon: ListChecks },
      { href: '/tax', label: 'Tax (automatic)', icon: Receipt },
      { href: '/tax/filing', label: 'Filing papers', icon: FileText },
    ],
  },
  {
    title: 'More',
    items: [
      { href: '/others', label: 'Money lent, policies', icon: HandCoins },
      { href: '/inbox', label: 'Bank email inbox', icon: Inbox },
      { href: '/emergency', label: 'Family emergency guide', icon: ShieldAlert },
      { href: '/import', label: 'Import workbook', icon: Upload },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

const MOBILE: Item[] = [
  { href: '/', label: 'Home', icon: LayoutDashboard },
  { href: '/accounts', label: 'Accounts', icon: Landmark },
  { href: '/monthly', label: 'Update', icon: CalendarCheck },
  { href: '/investments', label: 'Invest', icon: TrendingUp },
  { href: '/more', label: 'More', icon: Ellipsis },
];

/** The most specific item that matches the current path is the highlighted one. */
function activeHref(path: string): string | null {
  const all = GROUPS.flatMap((g) => g.items).map((i) => i.href);
  const hits = all.filter((h) =>
    h === '/' ? path === '/' : path === h || path.startsWith(`${h}/`),
  );
  return hits.sort((a, b) => b.length - a.length)[0] ?? null;
}

export function Sidebar({ email, signOut }: { email: string; signOut: () => Promise<void> }) {
  const active = activeHref(usePathname());
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/" className="brand">
        <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
        <span>Family Wealth OS</span>
      </Link>
      {GROUPS.map((g) => (
        <div key={g.title} style={{ display: 'contents' }}>
          <div className="group">{g.title}</div>
          {g.items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={active === i.href ? 'page' : undefined}>
              <i.icon aria-hidden />
              {i.label}
            </Link>
          ))}
        </div>
      ))}
      <div className="who">
        <div>{email}</div>
        <form action={signOut}>
          <button className="signout" type="submit">
            <LogOut aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  const active = activeHref(path);
  return (
    <nav className="bottomnav" aria-label="Main (mobile)">
      {MOBILE.map((i) => {
        const current =
          i.href === '/more'
            ? path === '/more' || (!active && path !== '/' && !path.startsWith('/demo'))
            : active === i.href;
        return (
          <Link key={i.href} href={i.href} aria-current={current ? 'page' : undefined}>
            <i.icon aria-hidden />
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}
