/**
 * Sending a WhatsApp message. There is no WhatsApp account of our own: each person who should receive the inactivity alert on
 * WhatsApp activates CallMeBot's free personal API once on their own phone and receives a key (Settings > Emergency and access has the
 * steps). A message is then one GET to CallMeBot with that person's number, the text and their key, so it can only ever reach the
 * person who activated it.
 *
 * Privacy: the number and the key are in the request address. Nothing here logs the address, the number, the key or CallMeBot's
 * answer (which can repeat them); a failure is reported as a short reason without them.
 */

/** One way to send a WhatsApp message. Other providers (Twilio, the official Business API) can be added behind the same shape. */
export interface WhatsAppSender {
  readonly provider: string;
  send(to: { phone: string; key: string }, text: string): Promise<WhatsAppResult>;
}

export interface WhatsAppResult {
  ok: boolean;
  /** a short reason without the number or the key */
  error?: string;
}

export type TextFetch = (
  url: string,
  init?: { method?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export const CALLMEBOT_URL = 'https://api.callmebot.com/whatsapp.php';
/** CallMeBot's own WhatsApp number to activate with, and the message to send it (callmebot.com, checked 30 Oct 2026). */
export const CALLMEBOT_NUMBER = '+34 644 33 66 63';
export const CALLMEBOT_ACTIVATION = 'I allow callmebot to send me messages';
/** Long messages are cut here; the e-mail carries the whole text. */
export const WHATSAPP_LIMIT = 1500;

/** The request address. Never log it: it carries the number and the key. */
export function callMeBotUrl(phone: string, key: string, text: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return (
    `${CALLMEBOT_URL}?phone=${encodeURIComponent(digits)}` +
    `&text=${encodeURIComponent(text.slice(0, WHATSAPP_LIMIT))}` +
    `&apikey=${encodeURIComponent(key.trim())}`
  );
}

/** CallMeBot answers 200 with a short page; its words say whether the message was queued or the key was wrong. */
const REFUSED = /(invalid|error|not\s+(?:valid|activated|allowed)|wrong|blocked|banned|forbidden)/i;

export function callMeBot(f: TextFetch, timeoutMs = 20_000): WhatsAppSender {
  return {
    provider: 'CallMeBot',
    async send(to, text) {
      if (!/^\+\d{8,15}$/.test(to.phone.replace(/[^\d+]/g, '')))
        return { ok: false, error: 'not an international number' };
      if (!to.key.trim()) return { ok: false, error: 'not activated' };
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await f(callMeBotUrl(to.phone, to.key, text), {
          method: 'GET',
          signal: ctl.signal,
        });
        const body = await res.text().catch(() => '');
        if (!res.ok) return { ok: false, error: `CallMeBot answered ${res.status}` };
        if (REFUSED.test(body)) return { ok: false, error: 'CallMeBot refused the key or number' };
        return { ok: true };
      } catch {
        return { ok: false, error: 'CallMeBot could not be reached' };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
