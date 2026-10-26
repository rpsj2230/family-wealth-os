export interface ParsedTask {
  title: string;
  dueOn: string | null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function toIso(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    ? dt.toISOString().slice(0, 10)
    : null;
}

/**
 * One task per line, starting with a date: "2026-10-27 | Sell the folios", "27 Oct 2026 - Renew", "27/10/2026: Call the bank".
 * Lines that do not start with a readable date are reported, never guessed.
 */
export function parseTaskLines(text: string): { tasks: ParsedTask[]; errors: string[] } {
  const tasks: ParsedTask[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    let due: string | null = null;
    let rest = '';
    let m = /^(\d{4})-(\d{2})-(\d{2})\s*[|:\-–—\t ]\s*(.+)$/.exec(line);
    if (m) {
      due = toIso(+m[1]!, +m[2]!, +m[3]!);
      rest = m[4]!;
    } else if (
      (m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s*[|:\-–—\t ]\s*(.+)$/.exec(line))
    ) {
      const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
      due = mo > 0 ? toIso(+m[3]!, mo, +m[1]!) : null;
      rest = m[4]!;
    } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*[|:\-–—\t ]\s*(.+)$/.exec(line))) {
      due = toIso(+m[3]!, +m[2]!, +m[1]!);
      rest = m[4]!;
    }
    if (!due || !/[A-Za-z0-9]/.test(rest))
      errors.push(
        `Line ${i + 1}: start with a date such as 2026-10-27 or 27 Oct 2026, then the task.`,
      );
    else tasks.push({ title: rest.trim().slice(0, 300), dueOn: due });
  });
  return { tasks, errors };
}
