/**
 * Daily summary text for email and WhatsApp. Pure: it formats numbers it is given and never claims delivery.
 * Rules from the brief: say plainly when no new verified bank balance has arrived, show the date of every market input,
 * and never present an estimate as a verified balance.
 */
import { buildDigestEmail } from './digest-email';
import type { DigestFamily } from './digest-family';
import type { DigestGoalCard } from './digest-goals';
import type { DigestMaturity, DigestWealth } from './digest-wealth';
import type { Change, ShareMove } from './home';
import type { NetWorthResult } from './networth';

export interface DigestInput {
  date: string; // YYYY-MM-DD, Asia/Singapore date of the report
  householdName: string;
  netWorth: NetWorthResult;
  ownerNames: Record<string, string>;
  previous: { date: string; total: number } | null;
  /** newest as-of date among bank balance records (any source) */
  lastBankBalanceAsOf: string | null;
  attention: {
    maturedUnconfirmed: string[];
    maturingSoon: { name: string; daysLeft: number; amount: number }[];
    overdueLoans: { name: string; outstanding: number; daysOverdue: number }[];
    staleOrMissing: number;
    /** upcoming or missed policy dates; the digest keeps only those inside the reminder window */
    policyDates?: { insurer: string; kind: 'renewal' | 'ends'; on: string }[];
    /** open tasks with a due date; the digest keeps overdue ones and those due within a week */
    tasksDue?: { title: string; dueOn: string }[];
  };
  market: { navLatest: string | null; fx: Record<string, { rate: number; date: string }> };
  /** the retirement view; `card` is the goal-style card ("Can I retire now?" in the e-mail's format) */
  retirement?: {
    statusText: string;
    earliestAge: number | null;
    card?: DigestGoalCard | null;
  } | null;
  /** net worth, the day's change, the profit so far and the four kinds of holding, as Home shows them */
  wealth?: DigestWealth | null;
  /**
   * The family figures of money words v6 (Earned this FY, Own money, Lifetime profit, XIRR on own money, Earning rate now, each kind's
   * Profit and XIRR, what matures in 30 days), read off Home's model by `withHome`; absent, the summary leaves those lines out
   */
  family?: DigestFamily | null;
  /** the newest date a value was recorded on: "values as of" */
  asOf?: string | null;
  /** balances out of date or never recorded (Home's "late inputs") */
  lateInputs?: number;
  /** one card per goal, with how far it is and whether the pace gets there; undefined or null leaves the section out */
  goals?: DigestGoalCard[] | null;
  /** what needs the person, ranked as Home ranks it, each with the page where it is dealt with */
  needsYou?: { text: string; href: string; tone: 'bad' | 'warn' | 'info' }[];
  /** the change over the last Settings days, as Home shows it */
  month?: Change | null;
  /** the biggest moves since then, and the largest deposits paying out soon */
  changes?: {
    since: string;
    partial: boolean;
    kinds: ShareMove[];
    people: ShareMove[];
    maturities: DigestMaturity[];
    maturityDays: number;
  } | null;
  /** list lengths from Settings (digest.needsYouMax) */
  limits?: { needsYouMax: number };
  appUrl: string;
  /** how far ahead policy dates and tasks appear; from Settings (reminders) */
  reminders?: { policyDays: number; taskDays: number };
  /** better interest rates found elsewhere, already worded; from the rate comparison */
  rateIdeas?: string[];
  /** tax matters already worded: harvest deadline and amounts, refunds still to claim */
  taxIdeas?: string[];
  /** on the first day of a month: how wealth moved since the same day last month, in total and per person */
  monthly?: { since: string; change: number; byPerson: { name: string; change: number }[] } | null;
}

/** Where the links in the summary lead when no APP_URL is set. */
export const DEFAULT_APP_URL = 'https://family-wealth-os-nine.vercel.app';

export interface Digest {
  subject: string;
  /** compact plain text: the e-mail's text part and the Telegram message */
  text: string;
  html: string;
  whatsapp: string;
}

/** The daily summary in each form it is sent in. See `buildDigestEmail` for the layout. */
export function buildDigest(i: DigestInput): Digest {
  const e = buildDigestEmail(i);
  return { subject: e.subject, text: e.text, html: e.html, whatsapp: e.chat };
}
