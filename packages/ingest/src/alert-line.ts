/**
 * The transaction a bank alert reports, so the alert becomes a statement line the day it arrives (no statement needed): how much
 * moved, which way, and the words that say with whom ("vide NEFT … from SAMPLE PERSON", "to VPA arjun@okaxis", "towards …"). The
 * balance after it comes from the alert's balance reading (bank-email.ts). Pure; returns null when the alert names no movement
 * (a balance-only alert), so nothing is guessed.
 */
import { cleanNarration } from './bank-statement';

export interface AlertMovement {
  /** + money in, − money out */
  amount: number;
  /** the alert's own words about the movement, cut to what names the other side */
  words: string;
}

const AMT = String.raw`([\d,]+(?:\.\d{1,2})?)`;
const CUR = String.raw`(?:INR|Rs\.?|₹)\s*`;
const OUT = /debit|withdrawn|spent|sent|paid|transferred/i;

const num = (s: string) => {
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** What an alert reports moved: "debited for INR 1,234.00", "credited with INR …", "INR 1,234 has been debited", "Rs. 500 sent". */
export function alertMovement(text: string): AlertMovement | null {
  const t = text.replace(/\s+/g, ' ');
  // the word first ("has been debited for INR 1,234.00", "is credited with INR …")
  const a = new RegExp(
    String.raw`\b(debited|credited|withdrawn|deposited)\s+(?:for|with|by)\s+${CUR}${AMT}`,
    'i',
  ).exec(t);
  // the amount first ("INR 1,234.00 has been debited from", "Rs.500.00 debited from a/c", "Rs 500 sent to")
  const b = new RegExp(
    String.raw`${CUR}${AMT}\s+(?:has\s+been\s+|is\s+|was\s+|were\s+)?(debited|credited|withdrawn|deposited|spent|sent|paid|transferred|received)\b`,
    'i',
  ).exec(t);
  const m =
    a && (!b || a.index <= b.index)
      ? { word: a[1]!, amt: a[2]!, at: a.index }
      : b
        ? { word: b[2]!, amt: b[1]!, at: b.index }
        : null;
  if (!m) return null;
  const amount = num(m.amt);
  if (amount === null) return null;
  const out = OUT.test(m.word);
  // the words about the other side, from the movement on: "vide …", "towards …", "to VPA …", "from …", "Info: …", "by …"
  const rest = t.slice(m.at);
  const plain = rest.replace(
    /\b(?:your\s+)?(?:a\/c|account|acct)\s*(?:no\.?)?\s*[#:]?\s*[Xx*]*\d{3,4}\b/gi,
    '',
  );
  const END = String.raw`(?=\.\s|\.$|\s+on\s+\d|\s+avl\b|\s+available\b|\s+(?:your\s+)?(?:new|ledger|account)\s+balance\b|\s+ref(?:erence)?\b|\s+if\s+(?:this|not)\b|$)`;
  // the telling markers first ("to VPA …", "vide NEFT …", "towards …", "Info: …"), then a plain "to", "from" or "by"
  const w =
    new RegExp(
      String.raw`\b(?:to\s+vpa|from\s+vpa|vide|towards|info:?|remarks?:?)\s+(.{3,90}?)${END}`,
      'i',
    ).exec(plain) ?? new RegExp(String.raw`\b(?:to|from|by)\s+(.{3,90}?)${END}`, 'i').exec(plain);
  const words = cleanNarration(w ? w[1]!.replace(/^(?:a\/c|account)\s+/i, '') : '').slice(0, 120);
  return { amount: out ? -amount : amount, words };
}
