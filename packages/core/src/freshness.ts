export type Confidence =
  'verified' | 'manual_confirmed' | 'imported_unverified' | 'manual_unverified' | 'estimated';

export type Freshness =
  'missing' | 'current' | 'older_than_expected' | 'stale' | 'imported_unverified';

const MS_PER_DAY = 86_400_000;

/**
 * Classify how trustworthy an observation is *today*.
 * - current: within the expected refresh window
 * - older_than_expected: past the window but within 2x
 * - stale: past 2x the window
 * - imported_unverified: freshly imported but not yet confirmed (shown in addition to age)
 * A balance is never presented as "today's" unless its as-of date is within the window.
 */
export function classifyFreshness(args: {
  asOf: Date | null;
  today: Date;
  expectedDays: number;
  confidence?: Confidence;
}): { status: Freshness; ageDays: number | null } {
  if (!args.asOf) return { status: 'missing', ageDays: null };
  const age = Math.floor((args.today.getTime() - args.asOf.getTime()) / MS_PER_DAY);
  if (age < 0) return { status: 'current', ageDays: 0 };
  if (age > args.expectedDays * 2) return { status: 'stale', ageDays: age };
  if (age > args.expectedDays) return { status: 'older_than_expected', ageDays: age };
  if (args.confidence === 'imported_unverified')
    return { status: 'imported_unverified', ageDays: age };
  return { status: 'current', ageDays: age };
}
