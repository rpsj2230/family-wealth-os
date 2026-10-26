/** Dates the way the household reads them: 26 Oct 2026. */
export function niceDate(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** "in 12 days", "today", "3 days ago" for a whole number of days from today. */
export function daysPhrase(days: number): string {
  if (days === 0) return 'today';
  const n = Math.abs(days);
  const unit = `${n} day${n === 1 ? '' : 's'}`;
  return days > 0 ? `in ${unit}` : `${unit} ago`;
}

/** Whole days from one calendar date to another (both as 2026-10-26). */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) /
      86_400_000,
  );
}

/** "Jun 2021" for a month and year. */
export function niceMonth(iso: string | null | undefined): string {
  if (!iso) return '–';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '–';
  return d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}
