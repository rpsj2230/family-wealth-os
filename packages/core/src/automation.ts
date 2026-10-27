/**
 * Status cards for the scheduled jobs (bank-email reader, market data, daily summary, rate pages), worked out from what the jobs
 * leave behind in the database. The jobs do not write a heartbeat, so "last run" means the newest thing each one produced; the
 * wording says so, and a quiet mailbox is never presented as a failure.
 */
import { longDate } from './inbox-view';

export type AutomationTone = 'ok' | 'warn' | 'bad' | 'info';

export interface AutomationCard {
  key: 'email' | 'market' | 'digest' | 'rates';
  title: string;
  tone: AutomationTone;
  /** short pill: "Working", "Behind", "Switched off" */
  status: string;
  /** what it does and when it runs */
  schedule: string;
  /** one to three sentences with the dates */
  lines: string[];
  link?: { href: string; label: string };
}

export interface AutomationInput {
  today: string; // YYYY-MM-DD
  inbox: {
    /** timestamp of the newest message the reader logged */
    lastLoggedAt: string | null;
    /** messages logged in the last 7 days by outcome */
    week: { applied: number; needs_review: number; ignored: number; error: number };
    waiting: number;
    aiReady: boolean;
    label: string;
  };
  market: { navLatest: string | null; fxLatest: string | null };
  digest: {
    enabled: boolean;
    last: {
      date: string;
      status: 'sending' | 'accepted_by_provider' | 'failed';
      channel: string;
      recipients: number;
      error: string | null;
    } | null;
  };
  rates: { sources: number; lastRunOn: string | null };
}

export const isoDaysBetween = (fromIso: string, toIso: string) =>
  Math.round(
    (Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`) -
      Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );

/** "today", "yesterday", "3 days ago" */
export function agoText(iso: string, today: string): string {
  const d = isoDaysBetween(iso, today);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  return `${d} days ago`;
}

const when = (iso: string, today: string) => `${longDate(iso)} (${agoText(iso, today)})`;

export function buildAutomationCards(i: AutomationInput): AutomationCard[] {
  const cards: AutomationCard[] = [];

  // bank-email reader
  {
    const w = i.inbox.week;
    const total = w.applied + w.needs_review + w.ignored + w.error;
    let tone: AutomationTone = 'info';
    let status = 'Waiting for the first email';
    const lines: string[] = [];
    if (i.inbox.lastLoggedAt) {
      const idle = isoDaysBetween(i.inbox.lastLoggedAt, i.today);
      lines.push(`Newest email read: ${when(i.inbox.lastLoggedAt, i.today)}.`);
      lines.push(
        total === 0
          ? 'Nothing new in the last 7 days.'
          : `Last 7 days: ${w.applied} recorded, ${w.needs_review} for review, ${w.ignored} skipped${w.error ? `, ${w.error} with a problem` : ''}.`,
      );
      if (w.error > 0) {
        tone = 'warn';
        status = 'Some emails failed';
      } else if (idle <= 14) {
        tone = 'ok';
        status = 'Working';
      } else {
        tone = 'info';
        status = `Quiet for ${idle} days`;
        lines.push(
          'This is normal if no bank alert arrived. If you expected one, check that the Gmail label and the GitHub secrets are set.',
        );
      }
    } else {
      lines.push(
        `No email has been read yet. Forward a bank alert to the Gmail label ${i.inbox.label}; if it stays empty, check the reader’s GitHub secrets.`,
      );
    }
    if (i.inbox.waiting > 0) lines.push(`${i.inbox.waiting} waiting for your review.`);
    if (!i.inbox.aiReady)
      lines.push(
        'No AI key is switched on, so PDF statements are not read (Settings, Connections, Bank e-mails and AI).',
      );
    cards.push({
      key: 'email',
      title: 'Bank email reader',
      tone,
      status,
      schedule: `Reads the label ${i.inbox.label} every 3 hours.`,
      lines,
      link: { href: '/settings#email', label: 'Email and AI settings' },
    });
  }

  // market data
  {
    const nav = i.market.navLatest;
    const fx = i.market.fxLatest;
    const age = nav ? isoDaysBetween(nav, i.today) : null;
    let tone: AutomationTone = 'ok';
    let status = 'Up to date';
    if (age === null) {
      tone = 'warn';
      status = 'No data yet';
    } else if (age > 10) {
      tone = 'bad';
      status = 'Out of date';
    } else if (age > 4) {
      tone = 'warn';
      status = 'Behind';
    }
    cards.push({
      key: 'market',
      title: 'Market data',
      tone,
      status,
      schedule: 'Fund prices and the S$ rate are fetched every evening.',
      lines: [
        nav ? `Latest fund prices: ${when(nav, i.today)}.` : 'No fund prices have been loaded.',
        fx ? `Latest S$ rate: ${when(fx, i.today)}.` : 'No S$ rate has been loaded.',
        ...(tone === 'warn' || tone === 'bad'
          ? ['Run “Refresh market data” from the Actions tab on GitHub, or wait for tonight’s run.']
          : []),
      ],
    });
  }

  // daily summary
  {
    const l = i.digest.last;
    let tone: AutomationTone = 'info';
    let status = 'Switched off';
    const lines: string[] = [];
    if (!i.digest.enabled) lines.push('The daily summary is switched off in Settings.');
    else if (!l) {
      status = 'Not sent yet';
      lines.push('Nothing has been sent yet. The first one goes out at 08:30 Singapore time.');
    } else {
      const age = isoDaysBetween(l.date, i.today);
      if (l.status === 'failed') {
        tone = 'bad';
        status = 'Last one failed';
        lines.push(`The ${longDate(l.date)} summary was not sent${l.error ? `: ${l.error}` : '.'}`);
      } else if (l.status === 'sending') {
        tone = 'warn';
        status = 'Sending';
        lines.push(`The ${longDate(l.date)} summary was started but not confirmed.`);
      } else if (age <= 1) {
        tone = 'ok';
        status = 'Sent';
        lines.push(
          `Handed to the ${l.channel === 'telegram' ? 'Telegram' : 'mail'} server ${agoText(l.date, i.today)}${l.recipients ? ` for ${l.recipients} recipient${l.recipients === 1 ? '' : 's'}` : ''}.`,
        );
      } else {
        tone = 'warn';
        status = 'Late';
        lines.push(`Last handed over ${when(l.date, i.today)}.`);
      }
    }
    cards.push({
      key: 'digest',
      title: 'Daily summary',
      tone,
      status,
      schedule: 'Sent every morning at 08:30 Singapore time.',
      lines,
      link: { href: '/settings#email', label: 'Summary settings' },
    });
  }

  // bank rate pages
  {
    let tone: AutomationTone = 'info';
    let status = 'No pages set';
    const lines: string[] = [];
    if (i.rates.sources === 0)
      lines.push('Add the bank rate-page addresses in Settings so rates refresh by themselves.');
    else if (!i.rates.lastRunOn) {
      status = 'Not run yet';
      lines.push(`${i.rates.sources} rate pages set; none read yet.`);
    } else {
      const age = isoDaysBetween(i.rates.lastRunOn, i.today);
      tone = age <= 9 ? 'ok' : 'warn';
      status = age <= 9 ? 'Up to date' : 'Behind';
      lines.push(`${i.rates.sources} rate pages; last read ${when(i.rates.lastRunOn, i.today)}.`);
    }
    cards.push({
      key: 'rates',
      title: 'Bank rate pages',
      tone,
      status,
      schedule: 'Read every Sunday.',
      lines,
      link: { href: '/rates', label: 'Open Rates' },
    });
  }
  return cards;
}
