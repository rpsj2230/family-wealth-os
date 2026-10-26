/**
 * Sending the daily summary to Telegram. The Bot API is free and needs no phone number or business account: you make a bot with
 * @BotFather, send it a message, and it can write to you (or to a family group it has been added to). Pure helpers here; the worker
 * and the settings page supply `fetch`.
 */
export type Fetch = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export const TELEGRAM_LIMIT = 4000;

/** Splits a long message at blank lines (then lines) so no part passes Telegram's 4096-character limit. */
export function splitForTelegram(text: string, limit = TELEGRAM_LIMIT): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (clean.length <= limit) return clean ? [clean] : [];
  const parts: string[] = [];
  let cur = '';
  const push = () => {
    if (cur.trim()) parts.push(cur.trim());
    cur = '';
  };
  for (const block of clean.split(/\n{2,}/)) {
    const pieces = block.length > limit ? block.split('\n') : [block];
    for (const piece of pieces) {
      let p = piece;
      while (p.length > limit) {
        push();
        parts.push(p.slice(0, limit));
        p = p.slice(limit);
      }
      if ((cur ? cur.length + 2 : 0) + p.length > limit) push();
      cur = cur ? `${cur}\n\n${p}` : p;
    }
  }
  push();
  return parts;
}

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

const api = (token: string, method: string) => `https://api.telegram.org/bot${token}/${method}`;
const reason = (body: unknown, status: number) => {
  const d = (body as { description?: string } | null)?.description;
  return d ? `Telegram said: ${d}` : `Telegram answered ${status}`;
};

export async function sendTelegram(
  f: Fetch,
  token: string,
  chatId: string,
  text: string,
): Promise<TelegramResult> {
  for (const part of splitForTelegram(text)) {
    const res = await f(api(token, 'sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: part, disable_web_page_preview: true }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || (body as { ok?: boolean } | null)?.ok === false)
      return { ok: false, error: reason(body, res.status) };
  }
  return { ok: true };
}

export interface FoundChat {
  id: string;
  title: string;
  kind: string;
}

/** The chats that have written to the bot recently (a person who pressed Start, or a group the bot was added to). */
export async function findTelegramChats(
  f: Fetch,
  token: string,
): Promise<{ chats: FoundChat[]; bot?: string; error?: string }> {
  const me = await f(api(token, 'getMe'));
  const meBody = (await me.json().catch(() => null)) as {
    ok?: boolean;
    result?: { username?: string };
  } | null;
  if (!me.ok || !meBody?.ok) return { chats: [], error: reason(meBody, me.status) };
  const up = await f(api(token, 'getUpdates'));
  const body = (await up.json().catch(() => null)) as {
    ok?: boolean;
    result?: {
      message?: {
        chat?: { id: number; type: string; title?: string; first_name?: string; username?: string };
      };
      my_chat_member?: { chat?: { id: number; type: string; title?: string } };
    }[];
  } | null;
  if (!up.ok || !body?.ok)
    return { chats: [], bot: meBody.result?.username ?? '', error: reason(body, up.status) };
  const seen = new Map<string, FoundChat>();
  for (const u of body.result ?? []) {
    const c = u.message?.chat ?? u.my_chat_member?.chat;
    if (!c) continue;
    const named = c as { title?: string; first_name?: string; username?: string };
    seen.set(String(c.id), {
      id: String(c.id),
      title: named.title ?? named.first_name ?? named.username ?? 'Chat',
      kind: c.type,
    });
  }
  return { chats: [...seen.values()], bot: meBody.result?.username ?? '' };
}

/** Chat ids as typed ("12345, -100678"): the valid ones, no repeats. */
export function parseChatIds(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[\s,;]+/)
        .map((x) => x.trim())
        .filter((x) => /^-?\d{3,20}$/.test(x)),
    ),
  ];
}
