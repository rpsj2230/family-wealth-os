/**
 * Opening a fund statement PDF: tries no password, then each person's passwords (the saved PAN in both cases, then any extra statement
 * passwords saved for that person), and checks the statement belongs to that person. Free of the database, so it is tested with real
 * encrypted PDFs. No password or PAN is ever logged or returned.
 */
import { casPdfText, isPasswordError } from './cas-pdf';
import { parseCas, type CasStatement } from './cas';
import { splitByOwner, type SkippedFolios } from './cas-import';

/** What is recorded when a statement that came by e-mail is protected by a password that none of the saved ones fits. */
export const MAIL_PASSWORD_FAILED =
  "Could not open: none of the saved passwords fits. Ask for the statement again with your PAN as the password, or add this statement's password under Statement passwords.";

export type PasswordCandidate = { ownerId: string; passwords: string[]; panLast4: string | null };

export type Opened =
  | {
      ok: true;
      stmt: CasStatement;
      /** the person whose password opened it or whose PAN it names (the first person in the file when it names nobody) */
      ownerId: string;
      /**
       * The statement split by person. A statement keyed on an email address can hold several people's folios; each scheme belongs
       * to the person whose PAN is printed on its folio, not to whoever opened the file.
       */
      groups: { ownerId: string; stmt: CasStatement }[];
      /** folios of someone who is not in the family list: named, not applied */
      skipped: SkippedFolios[];
    }
  | { ok: false; ownerId: string | null; detail: string };

/**
 * Opens a fund statement with each candidate's passwords (the PAN, or the password chosen when the statement was requested)
 * until one fits, and checks the statement belongs to that person. No password or PAN is logged or returned.
 */
export async function openStatement(
  pdf: Uint8Array,
  candidates: PasswordCandidate[],
  fromMail = false,
): Promise<Opened> {
  let text: string | null = null;
  let owner: string | null = null;
  let panLast4: string | null = null;
  let lastError: unknown = null;
  // an unprotected statement opens without a password
  try {
    text = await casPdfText(pdf);
  } catch (e) {
    lastError = e;
  }
  if (text === null)
    outer: for (const c of candidates) {
      for (const pw of c.passwords) {
        try {
          text = await casPdfText(pdf, pw);
          owner = c.ownerId;
          panLast4 = c.panLast4;
          break outer;
        } catch (e) {
          lastError = e;
          if (!isPasswordError(e)) break outer;
        }
      }
    }
  if (text === null)
    return {
      ok: false,
      ownerId: null,
      detail: isPasswordError(lastError)
        ? fromMail
          ? MAIL_PASSWORD_FAILED
          : candidates.some((c) => c.passwords.length > 0)
            ? 'The password did not open the statement. Use the password you chose when you requested it (CAMS and KFintech let you choose one; if you chose your PAN, type it in capital letters).'
            : 'The statement is password-protected: type its password (the one you chose when requesting it, or your PAN).'
        : `The PDF could not be read (${(lastError as Error | null)?.message ?? 'unknown error'}).`,
    };
  const stmt = parseCas(text);
  if (owner === null) {
    const hit = candidates.filter(
      (c) => c.panLast4 && stmt.pan && c.panLast4 === stmt.pan.slice(-4),
    );
    if (hit.length === 1) {
      owner = hit[0]!.ownerId;
      panLast4 = hit[0]!.panLast4;
    }
  }
  // folios that print their own PAN are told apart by it; a statement that does not (a holdings statement, an old layout) belongs to
  // the person it names, as before
  const hasFolioPan = stmt.schemes.some((s) => s.folioPan);
  if (owner === null && !hasFolioPan)
    return {
      ok: false,
      ownerId: null,
      detail:
        'The statement opened without a password, but its PAN does not match anyone saved in Settings.',
    };
  if (!hasFolioPan && stmt.pan && panLast4 && stmt.pan.slice(-4) !== panLast4)
    return {
      ok: false,
      ownerId: owner,
      detail:
        'This statement belongs to a different person than the one chosen (the PAN on it does not match).',
    };
  if (stmt.schemes.length === 0)
    return {
      ok: false,
      ownerId: owner,
      detail: stmt.warnings.join(' ') || 'Nothing recognised.',
    };
  const { groups, skipped } = splitByOwner(
    stmt,
    candidates.map((c) => ({ ownerId: c.ownerId, panLast4: c.panLast4 })),
    owner,
  );
  if (groups.length === 0)
    return {
      ok: false,
      ownerId: owner,
      detail:
        'None of the folios in this statement belong to anyone in your family list: the PANs printed on them do not match the PAN saved for anyone in Settings.',
    };
  return { ok: true, stmt, ownerId: owner ?? groups[0]!.ownerId, groups, skipped };
}
