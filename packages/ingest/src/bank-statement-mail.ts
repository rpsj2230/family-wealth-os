/**
 * A bank statement e-mailed by the bank, read with no one at the keyboard: opened with the passwords saved in Settings (write-only;
 * tried here and never kept or printed), and placed on the one account it belongs to. Pure apart from opening the file, so the rules
 * are tested without a mailbox or a database (test/bank-statement-mail.test.ts). Saving the lines is @fwos/data
 * importBankStatementMail.
 */
import { readBankStatement, type BankStatement } from './bank-statement';
import { isPasswordError } from './cas-pdf';
import type { PasswordCandidate } from './cas-open';

export type OpenedBankStatement =
  | {
      ok: true;
      stmt: BankStatement;
      /** whose password opened it; null when it needed none */ ownerId: string | null;
    }
  | { ok: false; reason: string };

/**
 * Opens a statement file: first without a password, then with each person's saved passwords in turn. The reason, when it fails, never
 * carries a password.
 */
export async function openBankStatement(
  bytes: Uint8Array,
  candidates: readonly PasswordCandidate[],
  read: (b: Uint8Array, password?: string) => Promise<BankStatement> = readBankStatement,
): Promise<OpenedBankStatement> {
  try {
    return { ok: true, stmt: await read(bytes), ownerId: null };
  } catch (e) {
    if (!isPasswordError(e))
      return {
        ok: false,
        reason: `The file could not be read: ${(e as Error).message}`.slice(0, 200),
      };
  }
  for (const c of candidates)
    for (const p of c.passwords) {
      try {
        return { ok: true, stmt: await read(bytes, p), ownerId: c.ownerId };
      } catch (e) {
        if (!isPasswordError(e))
          return {
            ok: false,
            reason: `The file opened but could not be read: ${(e as Error).message}`.slice(0, 200),
          };
      }
    }
  return {
    ok: false,
    reason:
      'None of the saved passwords opens it. Save the password this bank uses for its statements under Import > Gmail statements > Statement passwords; the next scan tries again.',
  };
}

/** A bank account the statement may belong to. */
export interface StatementAccount {
  id: string;
  ownerId: string;
  last4: string | null;
  /** the bank's name as on file ("HDFC Bank", "IDFC First Bank") */
  bank: string;
  currency: string;
  /** the holder's name as on file ("Ragini"), to find on the statement or the mail it came to */
  owner?: string;
}

/** The part of a sender's domain that names the bank: "alerts@hdfcbank.net" → "hdfcbank", "x@estatement.yesbank.in" → "yesbank". */
export function senderBankWord(address: string): string {
  const d = (address.split('@')[1] ?? '')
    .toLowerCase()
    .replace(/\.(bank\.in|co\.in|net\.in|com|in|net|bank)$/g, '');
  const parts = d.split('.');
  return parts[parts.length - 1] ?? '';
}

/** Does this bank's name fit the sender's word? "HDFC Bank" fits "hdfcbank", "AU Small Finance Bank" fits "aubank". */
export function bankFitsSender(bank: string, word: string): boolean {
  const first =
    bank
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)[0] ?? '';
  return first.length >= 2 && word.startsWith(first);
}

/** Does a text name this person (the first name, or any word of four letters or more of the name, as a whole word)? */
export function namesPerson(text: string, person: string | undefined): boolean {
  if (!person || !text) return false;
  const words = person
    .toLowerCase()
    .split(/\s+/)
    .filter((w, i) => w.length >= 4 || (i === 0 && w.length >= 3));
  const t = ` ${text.toLowerCase().replace(/[^a-z]+/g, ' ')} `;
  return words.some((w) => t.includes(` ${w} `));
}

/**
 * The one account a statement belongs to, by what it shows and how it came: the last four digits it prints; then whose password
 * opened it; the holder's name in its heading; whose mailbox it was sent to; and the bank the sender is. Each narrows the accounts
 * only when it leaves one or more. A statement that prints no account number is placed when the rest leaves exactly one rupee
 * account at the sender's bank. Rupee accounts only (a bank in India sends these). Null with the reason when no single account
 * fits; nothing is then saved.
 */
export function pickStatementAccount(
  stmt: Pick<BankStatement, 'last4' | 'header'>,
  ownerId: string | null,
  fromAddress: string,
  accounts: readonly StatementAccount[],
  /** the mail's recipients (To, Delivered-To, a forward's To line), to tell whose mailbox it came to */
  to = '',
): { ok: true; account: StatementAccount } | { ok: false; reason: string } {
  const word = senderBankWord(fromAddress);
  const narrow = (xs: StatementAccount[], keep: (a: StatementAccount) => boolean) => {
    const k = xs.filter(keep);
    return k.length ? k : xs;
  };
  let fit = accounts.filter((a) => a.currency === 'INR');
  if (stmt.last4) {
    fit = fit.filter((a) => a.last4 === stmt.last4);
    if (fit.length === 0)
      return {
        ok: false,
        reason: `No account ending ${stmt.last4} is on record: add its last four digits to the account (Accounts), and the next scan reads it.`,
      };
  } else {
    // no account number: only the accounts at the sender's bank are candidates
    fit = word ? fit.filter((a) => bankFitsSender(a.bank, word)) : [];
    if (fit.length === 0)
      return {
        ok: false,
        reason:
          'The statement does not print its account number, and no account at the sender’s bank is on record.',
      };
  }
  if (fit.length > 1 && ownerId) fit = narrow(fit, (a) => a.ownerId === ownerId);
  if (fit.length > 1 && stmt.header) fit = narrow(fit, (a) => namesPerson(stmt.header!, a.owner));
  if (fit.length > 1 && to) fit = narrow(fit, (a) => namesPerson(to, a.owner));
  if (fit.length > 1 && word) fit = narrow(fit, (a) => bankFitsSender(a.bank, word));
  return fit.length === 1
    ? { ok: true, account: fit[0]! }
    : {
        ok: false,
        reason: stmt.last4
          ? `${fit.length} accounts end ${stmt.last4} and the statement does not say which one it is.`
          : `${fit.length} accounts at this bank could be it and the statement prints no account number.`,
      };
}
