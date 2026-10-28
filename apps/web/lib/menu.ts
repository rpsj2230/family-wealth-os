/**
 * The menu behind “More”: every page that is not in the phone's bottom bar (Home, Accounts, Update, Invest), grouped by the job
 * the person is doing. Kept as data so a new page is one line, and so a test can check that no entry points at a missing page.
 */
import {
  BellRing,
  Cable,
  Coins,
  FileText,
  HandCoins,
  Inbox,
  Landmark,
  ListChecks,
  Palmtree,
  Percent,
  PiggyBank,
  Banknote,
  Receipt,
  Route,
  Scale,
  Settings,
  Share2,
  ShieldAlert,
  Target,
  TrendingUp,
  Table2,
  Upload,
  UserRound,
  ClipboardCheck,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';

export interface MenuItem {
  href: string;
  label: string;
  /** one line: what you do there */
  hint: string;
  icon: LucideIcon;
}

export interface MenuGroup {
  title: string;
  items: MenuItem[];
}

export const MENU: MenuGroup[] = [
  {
    title: 'What we hold',
    items: [
      {
        href: '/deposits',
        label: 'All deposits',
        hint: 'Every fixed deposit with its rate, maturity and insurance cover.',
        icon: Landmark,
      },
      {
        href: '/reports',
        label: 'Reports',
        hint: 'Sheet-style summaries of deposits and funds: by maturity, start, bank, person, year.',
        icon: Table2,
      },
      {
        href: '/investments?tab=match',
        label: 'Match funds',
        hint: 'Link each fund to its official scheme so its value follows the live price.',
        icon: TrendingUp,
      },
      {
        href: '/others',
        label: 'Lent, policies and property',
        hint: 'Money lent out, insurance policies, property and other holdings.',
        icon: HandCoins,
      },
    ],
  },
  {
    title: 'Bring data in',
    items: [
      {
        href: '/inbox',
        label: 'Bank e-mail inbox',
        hint: 'Balances read from forwarded e-mails, and the ones waiting for your decision, with my suggestion.',
        icon: Inbox,
      },
      {
        href: '/import',
        label: 'Import',
        hint: 'Choose any file: workbook, fund statement, fund export or tax statement.',
        icon: Upload,
      },
    ],
  },
  {
    title: 'Decide and plan',
    items: [
      {
        href: '/reconcile',
        label: 'Explain movements',
        hint: 'Where matured money went, what a balance change was, where a new deposit came from.',
        icon: Scale,
      },
      {
        href: '/trail',
        label: 'Money trail',
        hint: 'Where the money in each account and deposit came from, and whose it was.',
        icon: Route,
      },
      {
        href: '/raise',
        label: 'I need money',
        hint: 'Where an amount can come from, by when, and what it costs.',
        icon: Banknote,
      },
      {
        href: '/new-money',
        label: 'New money',
        hint: 'Where a sum should go, spread to stay inside the insurance limit.',
        icon: PiggyBank,
      },
      {
        href: '/rates',
        label: 'Rates',
        hint: 'Savings and deposit rates by bank, where they came from, and how they moved.',
        icon: Percent,
      },
      {
        href: '/retire',
        label: 'Can I retire now?',
        hint: 'The retirement verdict and the assumptions behind it.',
        icon: Palmtree,
      },
      {
        href: '/goals',
        label: 'Goals',
        hint: 'What money is set aside for, and whether it is enough.',
        icon: Target,
      },
      {
        href: '/tasks',
        label: 'Plan and tasks',
        hint: 'Dated things to do, with reminders.',
        icon: ListChecks,
      },
    ],
  },
  {
    title: 'Tax',
    items: [
      {
        href: '/tax',
        label: 'Tax',
        hint: 'Tax-free gain still to book, losses to harvest, refunds to claim.',
        icon: Receipt,
      },
      {
        href: '/tax/filing',
        label: 'Filing papers',
        hint: 'Schedules for your return, 26AS and AIS checks.',
        icon: FileText,
      },
    ],
  },
  {
    title: 'Settings and safety',
    items: [
      {
        href: '/settings?tab=setup',
        label: 'Setup checklist',
        hint: 'What is set up and what still needs you.',
        icon: ClipboardCheck,
      },
      {
        href: '/settings?tab=people',
        label: 'People and income',
        hint: 'Dates of birth, PAN last four, income and spending.',
        icon: UserRound,
      },
      {
        href: '/settings?tab=rules',
        label: 'Money rules',
        hint: 'Deposit limits, reminders, estimates, rate and harvest rules.',
        icon: SlidersHorizontal,
      },
      {
        href: '/settings?tab=tax',
        label: 'Tax rules',
        hint: 'Rates and the tax-free allowance for each financial year.',
        icon: Scale,
      },
      {
        href: '/settings?tab=notifications',
        label: 'Notifications',
        hint: 'Daily summary by e-mail, Telegram or WhatsApp.',
        icon: BellRing,
      },
      {
        href: '/ai-cost',
        label: 'AI cost',
        hint: 'What the AI has cost so far, by day and by what it did.',
        icon: Coins,
      },
      {
        href: '/settings?tab=connections',
        label: 'Connections',
        hint: 'AI keys, Gmail label and bank rate pages.',
        icon: Cable,
      },
      {
        href: '/emergency',
        label: 'Family emergency guide',
        hint: 'The printable handbook: what to do, who to call, where things are.',
        icon: ShieldAlert,
      },
      {
        href: '/settings?tab=access',
        label: 'Emergency access',
        hint: 'Who can open the handbook, and what it says.',
        icon: Settings,
      },
      {
        href: '/share',
        label: 'Share today’s summary',
        hint: 'The daily summary as text for WhatsApp.',
        icon: Share2,
      },
    ],
  },
];

/** The page behind a menu address: /settings?tab=tax -> settings, /tax/filing -> tax/filing. */
export const routeOf = (href: string) => href.split(/[?#]/)[0]!.replace(/^\//, '');
