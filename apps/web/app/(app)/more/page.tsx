import Link from 'next/link';
import {
  FileText,
  Landmark,
  Percent,
  HandCoins,
  Inbox,
  ListChecks,
  LogOut,
  Settings,
  Share2,
  ShieldAlert,
  Target,
  Receipt,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { signOut } from '../../login/actions';

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/inbox', label: 'Bank email inbox', icon: Inbox },
  { href: '/deposits', label: 'All deposits', icon: Landmark },
  { href: '/funds', label: 'Fund matching', icon: TrendingUp },
  { href: '/rates', label: 'Rates and new money', icon: Percent },
  { href: '/funds', label: 'Mutual funds', icon: TrendingUp },
  { href: '/goals', label: 'Goals', icon: Target },
  { href: '/others', label: 'Money lent and policies', icon: HandCoins },
  { href: '/tax', label: 'Tax simulator', icon: Receipt },
  { href: '/tax/filing', label: 'Tax filing papers', icon: FileText },
  { href: '/tasks', label: 'Tasks', icon: ListChecks },
  { href: '/emergency', label: 'Family emergency guide', icon: ShieldAlert },
  { href: '/share', label: 'Share on WhatsApp', icon: Share2 },
  { href: '/import', label: 'Import a workbook', icon: Upload },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export default function More() {
  return (
    <>
      <h1>More</h1>
      <div className="moregrid">
        {ITEMS.map((i) => (
          <Link key={i.href} href={i.href} className="tile">
            <i.icon aria-hidden />
            <span>{i.label}</span>
          </Link>
        ))}
      </div>
      <form action={signOut} style={{ marginTop: 16 }}>
        <button className="btn ghost" type="submit">
          <LogOut aria-hidden size={16} /> Sign out
        </button>
      </form>
    </>
  );
}
