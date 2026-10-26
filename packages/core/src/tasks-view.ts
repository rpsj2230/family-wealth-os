/**
 * How the Tasks page sorts a to-do list: what is overdue, what is due this week, what comes later, what has no date, and what
 * a task is about. Pure.
 */
export interface TaskLite {
  id: string;
  title: string;
  status: 'open' | 'done' | 'dropped';
  dueOn: string | null;
  assetId?: string | null;
  institutionId?: string | null;
}

export type TaskBucketKey = 'overdue' | 'week' | 'later' | 'nodate';
export interface TaskBucket<T extends TaskLite = TaskLite> {
  key: TaskBucketKey;
  label: string;
  tasks: T[];
}

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000;

/** Whole days from today to the due date: negative when overdue. Null for a task with no date. */
export const daysUntil = (dueOn: string | null, today: string): number | null =>
  dueOn ? Math.round(day(dueOn) - day(today)) : null;

/** "3 days overdue", "Due today", "Due tomorrow", "Due in 5 days", "Due 12 Dec 2026". */
export function dueText(dueOn: string | null, today: string, weekDays = 7): string {
  const d = daysUntil(dueOn, today);
  if (d === null) return 'No date';
  if (d < 0) return `${-d} day${d === -1 ? '' : 's'} overdue`;
  if (d === 0) return 'Due today';
  if (d === 1) return 'Due tomorrow';
  if (d <= weekDays) return `Due in ${d} days`;
  return `Due ${new Date(`${dueOn}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })}`;
}

/** Open tasks in four groups, soonest first inside each. Empty groups are kept so the caller decides whether to show them. */
export function groupOpenTasks<T extends TaskLite>(
  tasks: T[],
  today: string,
  weekDays = 7,
): TaskBucket<T>[] {
  const open = tasks.filter((t) => t.status === 'open');
  const byDue = (a: T, b: T) =>
    (a.dueOn ?? '').localeCompare(b.dueOn ?? '') || a.title.localeCompare(b.title);
  const pick = (f: (d: number) => boolean) =>
    open.filter((t) => t.dueOn !== null && f(daysUntil(t.dueOn, today)!)).sort(byDue);
  return [
    { key: 'overdue', label: 'Overdue', tasks: pick((d) => d < 0) },
    {
      key: 'week',
      label: `Due in the next ${weekDays} days`,
      tasks: pick((d) => d >= 0 && d <= weekDays),
    },
    { key: 'later', label: 'Later', tasks: pick((d) => d > weekDays) },
    { key: 'nodate', label: 'No date', tasks: open.filter((t) => t.dueOn === null).sort(byDue) },
  ];
}

export interface Concern {
  label: string;
  href: string;
}

/**
 * What a task is about, so it can link there: its account, its bank, or the page that made it
 * (tasks made by "I need money" start with [Raise ...], by the tax harvest with [Harvest ...]).
 */
export function taskConcern(
  t: Pick<TaskLite, 'title' | 'assetId' | 'institutionId'>,
  names: { asset?: ReadonlyMap<string, string>; institution?: ReadonlyMap<string, string> } = {},
): Concern | null {
  if (t.assetId)
    return { label: names.asset?.get(t.assetId) ?? 'The account', href: `/asset/${t.assetId}` };
  if (t.institutionId)
    return {
      label: names.institution?.get(t.institutionId) ?? 'The bank',
      href: `/bank/${t.institutionId}`,
    };
  if (/^\[Raise\b/i.test(t.title)) return { label: 'I need money', href: '/raise' };
  if (/^\[Harvest\b/i.test(t.title)) return { label: 'Tax harvest', href: '/tax' };
  return null;
}
