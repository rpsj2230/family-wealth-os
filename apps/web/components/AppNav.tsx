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
  PiggyBank,
  Banknote,
  Receipt,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Target,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react';

export interface Item {
  href: string;
  label: string;
  icon: LucideIcon;
}
export const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Overview',
    items: [{ href: '/', label: 'Home', icon: LayoutDashboard }],
  },
  {
    title: 'What we hold',
    items: [
      { href: '/accounts', label: 'Accounts', icon: Landmark },
      { href: '/deposits', label: 'Deposits and insurance', icon: ShieldCheck },
      { href: '/investments', label: 'Investments', icon: TrendingUp },
      { href: '/others', label: 'Lent, policies, property', icon: HandCoins },
    ],
  },
  {
    title: 'Keep it current',
    items: [
      { href: '/monthly', label: 'Monthly update', icon: CalendarCheck },
      { href: '/inbox', label: 'Bank emails', icon: Inbox },
      { href: '/import', label: 'Import', icon: Upload },
    ],
  },
  {
    title: 'Decide',
    items: [
      { href: '/raise', label: 'I need money', icon: Banknote },
      { href: '/new-money', label: 'New money', icon: PiggyBank },
      { href: '/rates', label: 'Rates', icon: Percent },
      { href: '/retire', label: 'Can I retire now?', icon: Palmtree },
    ],
  },
  {
    title: 'Plan and tax',
    items: [
      { href: '/goals', label: 'Goals', icon: Target },
      { href: '/tasks', label: 'Plan and tasks', icon: ListChecks },
      { href: '/tax', label: 'Tax', icon: Receipt },
      { href: '/tax/filing', label: 'Filing papers', icon: FileText },
    ],
  },
  {
    title: 'Safety and setup',
    items: [
      { href: '/emergency', label: 'Family emergency guide', icon: ShieldAlert },
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
