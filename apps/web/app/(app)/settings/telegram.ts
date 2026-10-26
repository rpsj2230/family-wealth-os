'use server';

import { revalidatePath } from 'next/cache';
import { findTelegramChats, parseChatIds, sendTelegram, type FoundChat } from '@fwos/ingest';
import { loadContext } from '@/lib/data';

export interface TelegramState {
  ok: boolean;
  message: string;
  chats?: FoundChat[];
}

const tokenOk = (t: string) => /^\d{5,15}:[A-Za-z0-9_-]{20,}$/.test(t);
const get = async (
  u: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => fetch(u, { ...init, signal: AbortSignal.timeout(15_000) });

/** Looks up the chats that have written to the bot, so nobody has to find a chat number by hand. */
export async function findChats(_p: TelegramState | null, f: FormData): Promise<TelegramState> {
  await loadContext();
  const token = String(f.get('token') ?? '').trim();
  if (!tokenOk(token))
    return {
      ok: false,
      message:
        'That does not look like a bot token. It looks like 123456789:AA… and comes from @BotFather.',
    };
  const r = await findTelegramChats(get, token);
  if (r.error) return { ok: false, message: r.error };
  if (r.chats.length === 0)
    return {
      ok: false,
      message: `No chat found yet. Open Telegram, search for @${r.bot ?? 'your bot'}, press Start and send it any message (or add it to your family group and write there), then press this again.`,
    };
  return {
    ok: true,
    message: `Found ${r.chats.length} chat${r.chats.length === 1 ? '' : 's'}. Tick the ones that should get the summary.`,
    chats: r.chats,
  };
}

/** Sends a short test message with the typed token (a saved token is never read back, so it cannot be tested from here). */
export async function testTelegram(_p: TelegramState | null, f: FormData): Promise<TelegramState> {
  await loadContext();
  const token = String(f.get('token') ?? '').trim();
  const chats = parseChatIds(String(f.get('chats') ?? ''));
  if (!tokenOk(token) || chats.length === 0)
    return { ok: false, message: 'Enter the bot token and at least one chat to test.' };
  for (const c of chats) {
    const r = await sendTelegram(
      get,
      token,
      c,
      'Family Wealth OS: this is a test. The daily summary will arrive here.',
    );
    if (!r.ok) return { ok: false, message: `Chat ${c}: ${r.error}` };
  }
  return { ok: true, message: 'Test message sent. Check Telegram.' };
}

/** The token is write-only: it is saved here and read back only by the scheduled job. */
export async function saveTelegram(_p: TelegramState | null, f: FormData): Promise<TelegramState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const clear = f.get('clear') === 'on';
  const token = String(f.get('token') ?? '').trim();
  const chats = parseChatIds(String(f.get('chats') ?? ''));
  if (!clear && token !== '' && !tokenOk(token))
    return { ok: false, message: 'That does not look like a bot token.' };
  if (!clear && chats.length === 0 && token === '')
    return { ok: false, message: 'Enter a token and a chat.' };
  const { error } = await supabase.rpc('save_telegram', {
    p_household: householdId,
    p_token: token === '' ? null : token,
    p_chat_ids: chats.length ? chats.join(',') : null,
    p_clear: clear,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  return {
    ok: true,
    message: clear
      ? 'Telegram is switched off.'
      : 'Saved. The next daily summary also goes to Telegram.',
  };
}
