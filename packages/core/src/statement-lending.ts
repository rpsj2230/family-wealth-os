/**
 * Money lent to people, as the bank statements show it. A payment to someone you lend to ("IMPS-…-SHELENDRA PRATAP SIN-HDFC") is
 * money lent; what comes back from them later, often in pieces over years, is them paying it back. Banks write a name their own
 * way ("Shalender" in your notes, "SHELENDRA" on the statement), so names are compared by their first letter and their consonants:
 * both are "shlndr". Pure.
 */

/** A name as banks may spell it: its first letter and the consonants after it ("shalender", "shelendra" → "shlndr"). */
export function nameKey(word: string): string {
  const w = word.toLowerCase().replace(/[^a-z]/g, '');
  return w ? w[0]! + w.slice(1).replace(/[aeiouy]/g, '') : '';
}

/** Words a narration is made of that are never a person's name (they would otherwise match one by their consonants). */
const NOT_NAMES = new Set(
  ['transfer', 'payment', 'credit', 'debit', 'mobile', 'refund', 'interest', 'charges'].map(
    nameKey,
  ),
);

/**
 * The person a narration names, of those given: the first word of a name (four letters or more) written the same way, or with
 * the vowels changed. Null when none is named.
 */
export function personNamed<T extends { name: string }>(narration: string, people: T[]): T | null {
  // each word, and each two neighbouring words written as one ("SHYAM VIR" is "Shyamvir")
  const parts = narration.split(/[^A-Za-z]+/).filter(Boolean);
  const words = new Set(
    [...parts, ...parts.slice(1).map((w, i) => parts[i]! + w)]
      .filter((w) => w.length >= 4)
      .map(nameKey)
      .filter((k) => k.length >= 3 && !NOT_NAMES.has(k)),
  );
  for (const p of people) {
    const first = p.name.trim().split(/\s+/)[0] ?? '';
    const k = nameKey(first);
    if (first.length >= 4 && k.length >= 3 && words.has(k)) return p;
  }
  return null;
}

export interface LendingLine {
  id: string;
  assetId: string;
  date: string;
  amount: number;
  narration: string;
}

export interface LendingPicture {
  name: string;
  /** payments to them of at least the asking limit: money lent */
  lent: LendingLine[];
  /** payments from them after the first loan: money paid back */
  repaid: LendingLine[];
  /** what they still owe, and after each loan or payment, in date order */
  owed: number;
  steps: { date: string; owed: number }[];
}

/**
 * Each person's loans and repayments from the statement lines that name them. A payment out below the limit is spending (a
 * small payment to the same person), not a loan; money from them before the first loan is not a repayment.
 */
export function lendingFromLines(
  lines: LendingLine[],
  names: string[],
  lendAtLeast: number,
): LendingPicture[] {
  const people = names.map((name) => ({ name }));
  const byName = new Map<string, LendingLine[]>();
  for (const l of lines) {
    const p = personNamed(l.narration, people);
    if (p) byName.set(p.name, [...(byName.get(p.name) ?? []), l]);
  }
  const out: LendingPicture[] = [];
  for (const name of names) {
    const ls = [...(byName.get(name) ?? [])].sort(
      (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
    );
    const lent = ls.filter((l) => l.amount < 0 && -l.amount >= lendAtLeast);
    const first = lent[0]?.date;
    const repaid = first ? ls.filter((l) => l.amount > 0 && l.date >= first) : [];
    let owed = 0;
    const steps: { date: string; owed: number }[] = [];
    for (const l of [...lent, ...repaid].sort((a, b) => a.date.localeCompare(b.date))) {
      owed = Math.round((owed - l.amount) * 100) / 100;
      const last = steps[steps.length - 1];
      if (last && last.date === l.date) last.owed = owed;
      else steps.push({ date: l.date, owed });
    }
    out.push({ name, lent, repaid, owed, steps });
  }
  return out;
}
