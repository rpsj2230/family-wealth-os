/**
 * The subject line of the daily summary and the first line of its Telegram and WhatsApp versions. Deterministic and pure.
 *
 *   Family Wealth Summary · 27 Oct 2026 · Net worth ₹4.82 Cr (+0.4% today) · 2 need you
 *
 * It is shortened step by step when it would run past the limit, so a phone does not cut it mid-figure: first the day's
 * percentage goes, then the "need you" marker, then the net worth; the date is never dropped. The wording is stable on purpose
 * (a Gmail filter or label can match "Family Wealth Summary"); the figures and the date change.
 */
import { inr, niceDate, signedPct } from './digest-format';

/** Name at the front of every summary: the text to match in a mail filter. */
export const DIGEST_SUBJECT_NAME = 'Family Wealth Summary';

/** The longest subject we aim for; a phone's mail list cuts off near here. */
export const DIGEST_SUBJECT_LIMIT = 72;

export interface SubjectInput {
  /** ISO date of the report */
  date: string;
  netWorth: number;
  /** the day's change as a share of yesterday's value; null when unknown */
  dayPct: number | null;
  /** how many things need the person today (0 leaves the marker out) */
  needsYou: number;
}

/** "2 need you" / "1 needs you". */
export const needsYouMarker = (n: number): string => `${n} ${n === 1 ? 'needs' : 'need'} you`;

export function digestSubject(i: SubjectInput): string {
  const head = `${DIGEST_SUBJECT_NAME} · ${niceDate(i.date)}`;
  const worth = `Net worth ${inr(i.netWorth)}`;
  const pct = signedPct(i.dayPct);
  const marker = i.needsYou > 0 ? needsYouMarker(i.needsYou) : '';
  const tiers = [
    [head, pct ? `${worth} (${pct} today)` : worth, marker],
    [head, worth, marker],
    [head, worth],
    [head],
  ];
  for (const parts of tiers) {
    const s = parts.filter(Boolean).join(' · ');
    if (s.length <= DIGEST_SUBJECT_LIMIT) return s;
  }
  return head;
}
