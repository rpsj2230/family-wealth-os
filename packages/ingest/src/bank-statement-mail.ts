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

/**
 * The one account a statement belongs to: the last four digits it prints, narrowed by whose password opened it and by the bank the
 * sender is, in that order. Rupee accounts only (a bank in India sends these). Null with the reason when no single account fits;
 * nothing is then saved.
 */
export function pickStatementAccount(
  stmt: Pick<BankStatement, 'last4'>,
  ownerId: string | null,
  fromAddress: string,
  accounts: readonly StatementAccount[],
): { ok: true; account: StatementAccount } | { ok: false; reason: string } {
  if (!stmt.last4)
    return {
      ok: false,
      reason:
        'The statement does not print its account number, so the account it belongs to is not known.',
    };
  let fit = accounts.filter((a) => a.currency === 'INR' && a.last4 === stmt.last4);
  if (fit.length === 0)
    return {
      ok: false,
      reason: `No account ending ${stmt.last4} is on record: add its last four digits to the account (Accounts), and the next scan reads it.`,
    };
  if (fit.length > 1 && ownerId) {
    const mine = fit.filter((a) => a.ownerId === ownerId);
    if (mine.length) fit = mine;
  }
  if (fit.length > 1) {
    const word = senderBankWord(fromAddress);
    const atBank = fit.filter((a) => bankFitsSender(a.bank, word));
    if (atBank.length) fit = atBank;
  }
  return fit.length === 1
    ? { ok: true, account: fit[0]! }
    : {
        ok: false,
        reason: `${fit.length} accounts end ${stmt.last4} and the statement does not say which one it is.`,
      };
}
