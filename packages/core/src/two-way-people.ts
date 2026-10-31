/**
 * People who both received money from the family and sent money to it: the bank lines name the same person paying out and, later,
 * paying in. That is most often money lent and paid back, but it can as well be a shop, a relative settling a shared bill or money
 * changed between currencies, so it is never assumed: each person is listed once, with the totals, to be recorded as money lent if
 * it is (a loan record and a rule then place every line naming them, past and future). Pure: no I/O.
 */
import { lineNameGuess } from './line-name';
import type { Classified, LineClass, StmtLine } from './statement-classify';

/** Lines of money leaving the family, and coming into it, from someone the family does not hold an account for. */
const OUT: ReadonlySet<LineClass> = new Set(['spent', 'ask_out']);
const IN: ReadonlySet<LineClass> = new Set(['outside_in', 'ask_in']);

export interface TwoWayPerson {
  name: string;
  /** money paid to them, and received from them after the first payment */
  out: number;
  into: number;
  outLines: number;
  inLines: number;
  firstOut: string;
  lastIn: string;
  /** the person whose account paid them most (the lender to record) */
  ownerId: string;
}

export function twoWayPeople(
  lines: readonly Pick<StmtLine, 'id' | 'date' | 'amount' | 'narration' | 'ownerId'>[],
  classified: readonly Classified[],
  opts: {
    /** the household's own names (left out of the name a line is read for) */
    ownNames: string[];
    /** people already recorded as owing money (their lines are placed already) */
    borrowers: string[];
    /** Settings: only someone paid at least this much in all, and paying back at least this much, is listed */
    minimum: number;
  },
): TwoWayPerson[] {
  const cls = new Map(classified.map((c) => [c.id, c.cls]));
  const known = new Set(opts.borrowers.map((b) => b.toLowerCase()));
  const by = new Map<
    string,
    {
      name: string;
      outs: { date: string; amount: number; ownerId: string }[];
      ins: { date: string; amount: number }[];
    }
  >();
  for (const l of lines) {
    const c = cls.get(l.id);
    if (!c || (!OUT.has(c) && !IN.has(c))) continue;
    // a name of two words at least (a single word is too often a shop or a bank's own word), known by its first two words, as a
    // bank may add a word after it ("ATUL KUMAR-REPAY")
    const words = lineNameGuess(l.narration, opts.ownNames).split(' ').filter(Boolean);
    if (words.length < 2) continue;
    const name = words.slice(0, 2).join(' ');
    const key = name.toLowerCase();
    if (known.has(key) || opts.borrowers.some((b) => b.toLowerCase().startsWith(key))) continue;
    const g = by.get(key) ?? { name, outs: [], ins: [] };
    if (OUT.has(c) && l.amount < 0)
      g.outs.push({ date: l.date, amount: -l.amount, ownerId: l.ownerId });
    if (IN.has(c) && l.amount > 0) g.ins.push({ date: l.date, amount: l.amount });
    by.set(key, g);
  }
  const out: TwoWayPerson[] = [];
  for (const g of by.values()) {
    if (!g.outs.length) continue;
    const firstOut = g.outs.map((o) => o.date).sort()[0]!;
    const back = g.ins.filter((i) => i.date >= firstOut);
    const paid = g.outs.reduce((a, o) => a + o.amount, 0);
    const got = back.reduce((a, i) => a + i.amount, 0);
    if (paid < opts.minimum || got < opts.minimum) continue;
    const byOwner = new Map<string, number>();
    for (const o of g.outs) byOwner.set(o.ownerId, (byOwner.get(o.ownerId) ?? 0) + o.amount);
    out.push({
      name: g.name,
      out: paid,
      into: got,
      outLines: g.outs.length,
      inLines: back.length,
      firstOut,
      lastIn: back
        .map((i) => i.date)
        .sort()
        .pop()!,
      ownerId: [...byOwner].sort((a, b) => b[1] - a[1])[0]![0],
    });
  }
  return out.sort((a, b) => b.out - a.out);
}
