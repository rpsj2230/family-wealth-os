/**
 * Which account is a savings or cash line when its tab does not say? Older tabs write a plain "Cash" under "Yes Bank - Rupash"; the
 * newer ones write "Cash-NRE JO-0279" or "Cash-NRO-7031". The accounts are the same ones, so the older line can be identified from the
 * tabs around it. This module does that, and only that: pure functions on plain values, no workbook, no database.
 *
 * For each bank-and-person group the lines of a tab are an ordered list. A tab whose lines are all identified is a witness. For a tab
 * with a line that is not, the nearest witness before it and the nearest after it say which accounts exist around that month and in
 * which order they are listed. The rules, strongest first:
 *
 *  1. Position. The tab has as many lines as the witness on each side, listed in the same order: the line is the account at its
 *     position. CERTAIN when both sides agree. With a witness on one side only (the oldest or the newest tabs) it is LIKELY.
 *  2. Order, allowing for accounts opened or closed. The counts differ. An account in both witnesses was open in between and must
 *     have a line here; an account in only one was opened or closed in between and may have one. Every way of giving the
 *     unidentified lines an account that keeps the listed order of the witnesses is tried; the line is LIKELY when one way is left.
 *  3. Balance, as a tie-break only. When order leaves two accounts, the one whose balances next door are clearly closer to this
 *     line's (by the configured ratio) is LIKELY; otherwise the line stays AMBIGUOUS and the candidates are listed.
 *  4. The accounts on file are the candidates in the first place, so a line that states NRE or a last four digits never gets an
 *     account that differs. (The caller narrows them with kind, last four, joint and status.)
 *
 * Contradictions block the inference instead of being overruled: the position names an account that differs from what the line
 * itself states, the neighbouring tabs disagree about the accounts or their order, or the balance is wildly out of line with what that
 * account held next door. A BLOCKED line is listed with the reason; a person can still choose.
 */

export type IdentityState = 'certain' | 'likely' | 'ambiguous' | 'blocked';
export type IdentityBasis = 'position' | 'order' | 'balance' | 'relaxed' | 'none';

/** What is known about an account, to put it in words. */
export interface IdentityFact {
  label: string;
  accountKind: 'NRE' | 'NRO' | null;
  last4: string | null;
  joint: boolean;
}

/** A savings or cash line of one tab. */
export interface IdentLine {
  /** tab and cell: the line's stable id */
  id: string;
  tab: string;
  /** the month the tab stands for, YYYY-MM */
  month: string;
  /** may be a witness for other tabs (not a copy, date not in doubt) */
  witness: boolean;
  /** may be given an account (its date is not in doubt) */
  inferable: boolean;
  /** the bank-and-person group the line is read in */
  group: string;
  groupName: string;
  /** 1-based place among the group's cash lines in its tab */
  pos: number;
  label: string;
  /** the line's amount in rupees (a Singapore dollar balance times its rate) */
  amountInr: number;
  /** "asset:<id>" for an account on file, "group:<key>" for one that is not; null when the line is ambiguous */
  identity: string | null;
  /** the identity says which account it is (a plain "Cash" does not) */
  specific: boolean;
  /** the accounts on file the line could be, as identities; empty for an identified line */
  candidates: string[];
}

export interface IdentityOptions {
  /** facts about the accounts, by identity */
  facts: Map<string, IdentityFact>;
  /** a balance more than this many times higher or lower than next door, and by more than the floor, is a jump */
  jumpFactor: number;
  jumpFloor: number;
  /** of two accounts, the one this many times closer in balance is taken as the likely one */
  tieRatio: number;
}

export interface Inference {
  state: IdentityState;
  basis: IdentityBasis;
  /** the account for a certain or likely line; null otherwise */
  identity: string | null;
  /** the accounts the line could be (for a blocked line, a proposed account comes first) */
  candidates: string[];
  /** plain words: why, naming the tab it was inferred from */
  why: string;
  /** the tabs the answer comes from */
  fromTabs: string[];
  /** set when the inference was blocked: what contradicts it */
  contradiction: string | null;
}

const ordOf = (month: string): number => Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7));
const inr = (n: number): string =>
  '₹' + Math.round(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const ordinal = (n: number): string => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

/** "the joint NRE account Cash-NRE JO-0278" */
export function accountWords(id: string, facts: Map<string, IdentityFact>): string {
  const f = facts.get(id);
  if (!f) return 'an account';
  const kind = f.accountKind ?? 'savings';
  const name = f.label.replace(/\s+/g, ' ').trim();
  return `the ${f.joint ? 'joint ' : ''}${kind} account${name ? ` ${name}` : ''}`;
}

interface Witness {
  tab: string;
  month: string;
  seq: string[];
  amount: Map<string, number>;
}

const sameSeq = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Relative difference of two balances: 0 when equal, towards 1 when nothing alike. */
const rel = (a: number, b: number): number =>
  Math.abs(a - b) / (Math.max(Math.abs(a), Math.abs(b)) + 1);

/**
 * Gives every ambiguous line of every group an answer, or says why it cannot. Lines that are already identified are used as
 * witnesses and are not in the result.
 */
export function inferIdentities(lines: IdentLine[], opts: IdentityOptions): Map<string, Inference> {
  const out = new Map<string, Inference>();
  const byGroup = new Map<string, Map<string, IdentLine[]>>();
  for (const l of lines) {
    const tabs = byGroup.get(l.group) ?? new Map<string, IdentLine[]>();
    tabs.set(l.tab, [...(tabs.get(l.tab) ?? []), l]);
    byGroup.set(l.group, tabs);
  }
  for (const tabs of byGroup.values()) {
    for (const t of tabs.values()) t.sort((a, b) => a.pos - b.pos);
    const witnesses: Witness[] = [];
    for (const t of tabs.values()) {
      if (!t.every((l) => l.witness && l.identity !== null && l.specific)) continue;
      const seq = t.map((l) => l.identity!);
      if (new Set(seq).size !== seq.length) continue;
      witnesses.push({
        tab: t[0]!.tab,
        month: t[0]!.month,
        seq,
        amount: new Map(t.map((l) => [l.identity!, l.amountInr])),
      });
    }
    for (const t of tabs.values())
      if (t.some((l) => l.identity === null && l.candidates.length > 0))
        solveTab(t, witnesses, opts, out);
  }
  return out;
}

function solveTab(
  tab: IdentLine[],
  witnesses: Witness[],
  opts: IdentityOptions,
  out: Map<string, Inference>,
): void {
  const n = tab.length;
  const head = tab[0]!;
  const groupName = head.groupName;
  const t = ordOf(head.month);
  const targets = tab.flatMap((l, i) =>
    l.identity === null && l.candidates.length > 0 ? [i] : [],
  );
  const set = (i: number, r: Partial<Inference> & Pick<Inference, 'state' | 'why'>) =>
    out.set(tab[i]!.id, {
      basis: 'none',
      identity: null,
      candidates: tab[i]!.candidates,
      fromTabs: [],
      contradiction: null,
      ...r,
    });

  if (!head.inferable) {
    for (const i of targets)
      set(i, {
        state: 'ambiguous',
        why: 'The month of this tab is in doubt, so the tabs next to it in time are not known. Choose the account yourself.',
      });
    return;
  }

  const others = witnesses.filter((w) => w.tab !== head.tab && ordOf(w.month) !== t);
  const before = others
    .filter((w) => ordOf(w.month) < t)
    .sort((a, b) => ordOf(b.month) - ordOf(a.month))[0];
  const after = others
    .filter((w) => ordOf(w.month) > t)
    .sort((a, b) => ordOf(a.month) - ordOf(b.month))[0];
  const sides = [before, after].filter((w): w is Witness => !!w);
  if (sides.length === 0) {
    for (const i of targets)
      set(i, {
        state: 'ambiguous',
        why: `No other tab names every ${groupName} account (by NRE/NRO, last four digits or on file), so there is nothing to work it out from. Choose the account yourself.`,
      });
    return;
  }
  const present = sides.map((w) => new Set(w.seq));
  const mayHave = new Set(sides.flatMap((w) => w.seq));
  const mustHave = sides.length === 2 ? sides[0]!.seq.filter((x) => present[1]!.has(x)) : [];
  // do the two sides list the accounts they share in the same order?
  const sidesAgree =
    sides.length < 2 ||
    sameSeq(
      sides[0]!.seq.filter((x) => present[1]!.has(x)),
      sides[1]!.seq.filter((x) => present[0]!.has(x)),
    );
  const fixed = tab.map((l) => l.identity);
  const fromTabs = sides.map((w) => w.tab);
  const tabsText = `the ${fromTabs.join(' and ')} tab${sides.length > 1 ? 's' : ''}`;
  const equalCounts = sides.every((w) => w.seq.length === n);

  const orderOk = (seq: string[]): boolean => {
    const checks = sides.map((w, k) => {
      const mine = seq.filter((x) => present[k]!.has(x));
      return sameSeq(
        mine,
        w.seq.filter((x) => mine.includes(x)),
      );
    });
    return sidesAgree ? checks.every(Boolean) : checks.some(Boolean);
  };

  /** every way of giving the open lines an account; `strict` keeps the listed order and the accounts open in between */
  const enumerate = (forced: Map<number, string>, strict: boolean): string[][] => {
    const results: string[][] = [];
    const seq: string[] = fixed.map((x) => x ?? '');
    let steps = 0;
    const used0 = new Set(fixed.filter((x): x is string => x !== null));
    const dfs = (k: number, used: Set<string>): void => {
      if (++steps > 20_000) return;
      if (k === targets.length) {
        if (!strict || (mustHave.every((x) => seq.includes(x)) && orderOk(seq)))
          results.push([...seq]);
        return;
      }
      const i = targets[k]!;
      const choices = forced.has(i)
        ? [forced.get(i)!]
        : tab[i]!.candidates.filter((c) => mayHave.has(c));
      for (const c of choices) {
        if (used.has(c)) continue;
        seq[i] = c;
        used.add(c);
        dfs(k + 1, used);
        used.delete(c);
        seq[i] = '';
      }
    };
    dfs(0, used0);
    return results;
  };

  // balances next door, for the tie-break and the jump test
  const neighbours = (id: string): { tab: string; v: number }[] =>
    sides.flatMap((w) => (w.amount.has(id) ? [{ tab: w.tab, v: w.amount.get(id)! }] : []));
  const dist = (v: number, id: string): number | null => {
    const ref = neighbours(id);
    return ref.length === 0 ? null : ref.reduce((s, r) => s + rel(v, r.v), 0) / ref.length;
  };
  const heldText = (id: string): string =>
    neighbours(id)
      .map((r) => `${inr(r.v)} in ${r.tab}`)
      .join(' and ');
  const jumpOf = (v: number, id: string): string | null => {
    const ref = neighbours(id).map((r) => r.v);
    if (ref.length === 0) return null;
    const hi = Math.max(...ref);
    const lo = Math.min(...ref);
    const up = v > hi * opts.jumpFactor && v - hi > opts.jumpFloor;
    const down = lo > v * opts.jumpFactor && lo - v > opts.jumpFloor;
    return up || down
      ? `its balance of ${inr(v)} is far from what ${accountWords(id, opts.facts)} held next door (${heldText(id)})`
      : null;
  };

  // ---- the ways the lines can be given accounts ------------------------------------------------
  const forced = new Map<number, string>();
  let strict = true;
  let results = enumerate(forced, true);
  if (results.length === 0) {
    results = enumerate(forced, false);
    strict = false;
  }
  if (results.length === 0) {
    // a contradiction with what a line states, or neighbours that disagree
    const proposal = sides.length >= 1 && equalCounts && sidesAgree ? sides[0]!.seq : null;
    for (const i of targets) {
      const l = tab[i]!;
      let contradiction = `${tabsText[0]!.toUpperCase()}${tabsText.slice(1)} ${sides.length > 1 ? 'do' : 'does'} not fit the accounts of this tab.`;
      let why = `The tabs next to this one (${tabsText}) disagree about which accounts there are or in what order, so nothing was inferred. Choose the account yourself.`;
      const prop = proposal?.[i];
      if (prop && !l.candidates.includes(prop)) {
        contradiction = `At this position ${tabsText} ${sides.length > 1 ? 'have' : 'has'} ${accountWords(prop, opts.facts)}, but the line itself points to ${l.candidates
          .map((c) => accountWords(c, opts.facts))
          .join(' or ')}.`;
        why = `Not inferred. ${contradiction} Choose the account yourself.`;
      }
      set(i, {
        state: 'blocked',
        why,
        fromTabs,
        contradiction,
        ...(prop && l.candidates.includes(prop)
          ? { candidates: [prop, ...l.candidates.filter((c) => c !== prop)] }
          : {}),
      });
    }
    return;
  }

  // ---- values per line; tie-break by balance ---------------------------------------------------
  const valuesOf = (rs: string[][]) =>
    new Map(targets.map((i) => [i, [...new Set(rs.map((r) => r[i]!))]]));
  let values = valuesOf(results);
  const byBalance = new Map<number, { id: string; others: string[] }>();
  for (;;) {
    let pick: { i: number; id: string; others: string[]; ratio: number } | null = null;
    for (const i of targets) {
      const vs = values.get(i)!;
      if (vs.length < 2 || byBalance.has(i)) continue;
      const ranked = vs
        .map((id) => ({ id, d: dist(tab[i]!.amountInr, id) }))
        .filter((x): x is { id: string; d: number } => x.d !== null)
        .sort((a, b) => a.d - b.d);
      if (ranked.length < 2) continue;
      const best = ranked[0]!;
      const second = ranked[1]!;
      if (best.d < second.d && best.d * opts.tieRatio <= second.d) {
        const ratio = best.d === 0 ? Infinity : second.d / best.d;
        if (!pick || ratio > pick.ratio)
          pick = { i, id: best.id, others: vs.filter((x) => x !== best.id), ratio };
      }
    }
    if (!pick) break;
    forced.set(pick.i, pick.id);
    const next = enumerate(forced, strict);
    if (next.length === 0) {
      forced.delete(pick.i);
      break;
    }
    byBalance.set(pick.i, { id: pick.id, others: pick.others });
    results = next;
    values = valuesOf(results);
  }

  const positional =
    strict &&
    sides.length === 2 &&
    equalCounts &&
    sidesAgree &&
    sameSeq(sides[0]!.seq, sides[1]!.seq) &&
    results.length === 1;
  for (const i of targets) {
    const l = tab[i]!;
    const vs = values.get(i)!;
    if (vs.length !== 1) {
      set(i, {
        state: 'ambiguous',
        candidates: vs,
        fromTabs,
        why: `Could be ${vs.map((c) => accountWords(c, opts.facts)).join(' or ')}. The order of the accounts in ${tabsText} does not settle it, and neither do the balances next door. Choose the account yourself.`,
      });
      continue;
    }
    const id = vs[0]!;
    const acct = accountWords(id, opts.facts);
    const tie = byBalance.get(i);
    const basis: IdentityBasis = tie
      ? 'balance'
      : !strict
        ? 'relaxed'
        : positional
          ? 'position'
          : 'order';
    const jump = jumpOf(l.amountInr, id);
    if (jump) {
      const contradiction = `${jump.charAt(0).toUpperCase()}${jump.slice(1)}.`;
      set(i, {
        state: 'blocked',
        basis,
        fromTabs,
        contradiction,
        candidates: [id, ...l.candidates.filter((c) => c !== id)],
        why: `Not inferred. It would be ${acct} (${
          tie ? 'the closer balance' : `its place in ${tabsText}`
        }), but ${jump}. Choose the account yourself.`,
      });
      continue;
    }
    let why: string;
    let state: IdentityState = 'likely';
    if (tie) {
      const other = tie.others
        .map((o) => `${accountWords(o, opts.facts)} (${heldText(o)})`)
        .join(' or ');
      why = `Order alone leaves more than one account. This balance (${inr(l.amountInr)}) is much closer to what ${acct} held next door (${heldText(id)}) than to ${other}, so it is probably ${acct}. Confirm it to use it.`;
    } else if (!strict) {
      why = `The order of the accounts differs from ${tabsText}, but ${acct} is the one left after the other lines of ${groupName} are accounted for. Confirm it to use it.`;
    } else if (positional) {
      state = 'certain';
      why = `Same position (${ordinal(l.pos)} of ${n}) in ${groupName} as in ${tabsText}, where it is ${acct}.`;
    } else if (equalCounts) {
      why = `Same position (${ordinal(l.pos)} of ${n}) in ${groupName} as in ${tabsText}, where it is ${acct}. ${
        sides.length === 1
          ? 'Only one tab on that side names the accounts'
          : 'The two tabs do not list the accounts alike'
      }, so confirm it to use it.`;
    } else {
      const counts = sides.map((w) => `${w.seq.length} in ${w.tab}`).join(' and ');
      const left = [...mayHave].filter((x) => !results[0]!.includes(x));
      why = `${groupName} has ${n} line${n === 1 ? '' : 's'} here against ${counts}. Keeping the listed order and ${
        left.length
          ? `leaving out the account${left.length > 1 ? 's' : ''} opened or closed in between (${left
              .map((x) => accountWords(x, opts.facts))
              .join(', ')})`
          : 'allowing for accounts opened or closed in between'
      }, this ${ordinal(l.pos)} line is ${acct}. Confirm it to use it.`;
    }
    set(i, {
      state,
      basis,
      identity: id,
      fromTabs,
      candidates: [id, ...l.candidates.filter((c) => c !== id)],
      why,
    });
  }
}
