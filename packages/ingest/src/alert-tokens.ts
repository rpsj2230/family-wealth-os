/**
 * The links in the inactivity alert: "I have received this" (/confirm/<token>) and "I'm fine — postpone" (/postpone/<token>).
 * The database keeps only the SHA-256 of a token (hex), which is what confirm_emergency_alert / postpone_emergency_alert compare.
 *
 * - The postpone token goes in one e-mail, so it is 32 random bytes.
 * - A person's confirmation token must be the same in the first message and every reminder, yet only its hash is stored. So it is
 *   derived: HMAC-SHA256 of (household, absence, position) under a secret only the job has. That is 32 bytes no one can guess
 *   without the secret, and the job can make it again for each reminder. If the secret changes, the job stores the new hash
 *   with the next reminder (the older messages' link then stops working; the newest one works).
 * Never log a token.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';

/** 32 random bytes, base64url (43 characters). */
export const newToken = (): string => randomBytes(32).toString('base64url');

/** What the database stores and compares: sha256, hex. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

/** The confirmation token of one person in one absence's chain (43 characters). */
export function chainToken(
  secret: string,
  householdId: string,
  absenceFrom: string,
  pos: number,
): string {
  if (secret.length < 16) throw new Error('chainToken: the link secret is too short');
  return createHmac('sha256', secret)
    .update(`fwos-alert|${householdId}|${Date.parse(absenceFrom)}|${pos}`)
    .digest('base64url');
}
