/**
 * The links in the inactivity alert: "I have received this" (/confirm/<token>) and "I'm fine — postpone" (/postpone/<token>).
 * The database keeps only the SHA-256 of a token (hex), which is what confirm_emergency_alert / postpone_emergency_alert compare.
 *
 * Every warning and every reminder of one absence must carry a working link, yet no raw token is stored. So a token is derived:
 *   key   = HMAC-SHA256(server secret, fixed label)            (the secret is one the job already has: the service-role key)
 *   token = base64url(HMAC-SHA256(key, `${purpose}|${householdId}|${absenceFrom}|${contactPos}`))
 * with purpose 'postpone' (contactPos -1) or 'confirm'. That is 32 bytes no one can guess without the secret; the same absence
 * gives the same token, a new absence a different one. If the secret changes, the next message stores the new hash (older
 * messages' links then stop working; the newest one works). Never log a token.
 */
import { createHash, createHmac } from 'node:crypto';

export type AlertLinkPurpose = 'postpone' | 'confirm';

const LABEL = 'fwos inactivity alert links v1';

/** The key the tokens are made with, derived from a server secret with a fixed label. */
export function alertLinkKey(serverSecret: string): Buffer {
  if (serverSecret.length < 16) throw new Error('alertLinkKey: the server secret is too short');
  return createHmac('sha256', serverSecret).update(LABEL).digest();
}

/** The same instant written either way ("…+00:00" or "….000Z") gives the same token. */
const instant = (t: string) => {
  const ms = Date.parse(t);
  if (!Number.isFinite(ms)) throw new Error('alertToken: the absence has no valid start');
  return new Date(ms).toISOString();
};

/** A link token (43 characters, base64url). */
export function alertToken(
  key: Buffer,
  purpose: AlertLinkPurpose,
  householdId: string,
  absenceFrom: string,
  contactPos: number,
): string {
  return createHmac('sha256', key)
    .update(`${purpose}|${householdId}|${instant(absenceFrom)}|${contactPos}`)
    .digest('base64url');
}

/** What the database stores and compares: sha256, hex. */
export const hashToken = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');
