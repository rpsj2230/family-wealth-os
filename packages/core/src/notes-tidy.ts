/**
 * Account notes copied from a sheet mix two kinds of facts: things about the account (an address change is due, KYC is done) and
 * things about the whole bank (minimum balance, lounge cards, no debit card). The second kind belongs on the bank, once. These
 * functions split a note into its clauses, decide which are bank-level, and plan the move. Pure.
 */

/** Phrases that describe the bank relationship rather than one account. */
const BANK_LEVEL =
  /\b(amb|mab|aqb|minimum (?:average |monthly )?balance|lounge|debit card|credit card|forex card|cheque ?book|net ?banking|relationship manager)\b/i;
/** Phrases that always start a new clause, so a comma before them is a real separator. */
const STARTS_CLAUSE =
  /^(amb|mab|lounge|no debit|debit card|credit card|address|kyc|number|change|nominee|maturity|upi|auto)/i;

/** Splits on full stops, semicolons and line breaks, and on commas that begin a new topic ("AMB - NA, Lounge Card - Domestic (8)"). */
export function noteClauses(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const sentence of text.split(/\s*(?:[;\n]|\.(?=\s|$))\s*/)) {
    let current = '';
    for (const part of sentence.split(/\s*,\s*/)) {
      if (!part.trim()) continue;
      if (current && STARTS_CLAUSE.test(part.trim())) {
        out.push(current);
        current = part.trim();
      } else current = current ? `${current}, ${part.trim()}` : part.trim();
    }
    if (current) out.push(current);
  }
  return out.map((c) => c.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

export interface NoteSplit {
  bank: string[];
  account: string[];
}

export function splitNote(text: string | null | undefined): NoteSplit {
  const bank: string[] = [];
  const account: string[] = [];
  for (const c of noteClauses(text)) (BANK_LEVEL.test(c) ? bank : account).push(c);
  return { bank, account };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Lounge and card details are per person; minimum balance is the same for everyone at the bank. */
const PERSONAL = /\b(lounge|debit card|credit card|forex card)\b/i;
export const NOTE_LIMIT = 500;

export interface NoteRow {
  assetId: string;
  ownerName: string;
  institutionId: string | null;
  notes: string | null;
}

export interface TidyPlan {
  /** accounts whose note changes, with what stayed and what moved up */
  assets: { assetId: string; notes: string | null; moved: string[] }[];
  /** banks whose note grows */
  banks: { institutionId: string; notes: string; added: string[] }[];
  /** clauses that could not be moved because the bank note would pass its length limit: they stay on the account */
  kept: { assetId: string; clause: string }[];
}

/**
 * Moves bank-level clauses from account notes to the bank's own note. A clause already on the bank note is not added twice;
 * card details are written with the person's name so two people's cards stay apart. An account note that ends up empty becomes null.
 */
export function tidyPlan(rows: NoteRow[], bankNotes: Map<string, string | null>): TidyPlan {
  const bankNow = new Map<string, string[]>(
    [...bankNotes].map(([id, n]) => [id, n ? n.split(/\s*·\s*/).filter(Boolean) : []]),
  );
  const added = new Map<string, string[]>();
  const plan: TidyPlan = { assets: [], banks: [], kept: [] };
  const has = (inst: string, clause: string) =>
    (bankNow.get(inst) ?? []).some(
      (e) => norm(e.replace(/^[^:]{1,30}:\s*/, '')) === norm(clause) || norm(e) === norm(clause),
    );
  for (const r of rows) {
    if (!r.notes || !r.institutionId) continue;
    const { bank, account } = splitNote(r.notes);
    if (bank.length === 0) continue;
    const moved: string[] = [];
    const stay = [...account];
    for (const clause of bank) {
      const inst = r.institutionId;
      if (has(inst, clause)) {
        moved.push(clause);
        continue;
      }
      const text =
        PERSONAL.test(clause) && r.ownerName ? `${r.ownerName.split(' ')[0]}: ${clause}` : clause;
      const next = [...(bankNow.get(inst) ?? []), text];
      if (next.join(' · ').length > NOTE_LIMIT) {
        plan.kept.push({ assetId: r.assetId, clause });
        stay.push(clause);
        continue;
      }
      bankNow.set(inst, next);
      added.set(inst, [...(added.get(inst) ?? []), text]);
      moved.push(clause);
    }
    if (moved.length > 0)
      plan.assets.push({ assetId: r.assetId, notes: stay.length ? stay.join('. ') : null, moved });
  }
  for (const [institutionId, a] of added)
    plan.banks.push({
      institutionId,
      notes: (bankNow.get(institutionId) ?? []).join(' · '),
      added: a,
    });
  return plan;
}

/** A sheet's "Changes Req" for a row, written into that account's note so it travels with the account. */
export function withChangeRequest(
  notes: string | null | undefined,
  change: string | null | undefined,
): string | null {
  const n = (notes ?? '').trim();
  const c = (change ?? '').trim();
  if (!c) return n || null;
  const line = `Change: ${c}`;
  return n ? `${n}. ${line}` : line;
}
