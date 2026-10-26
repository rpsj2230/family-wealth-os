import { describe, expect, it } from 'vitest';
import {
  findTelegramChats,
  parseChatIds,
  sendTelegram,
  splitForTelegram,
  type Fetch,
} from '../src/telegram';

const reply = (status: number, body: unknown) => ({
  ok: status < 400,
  status,
  json: async () => body,
});

describe('splitForTelegram', () => {
  it('keeps a short message whole', () => {
    expect(splitForTelegram('hello')).toEqual(['hello']);
    expect(splitForTelegram('  ')).toEqual([]);
  });
  it('splits a long message at blank lines, never over the limit', () => {
    const block = 'x'.repeat(900);
    const parts = splitForTelegram([block, block, block, block, block].join('\n\n'), 2000);
    expect(parts.length).toBe(3);
    expect(parts.every((p) => p.length <= 2000)).toBe(true);
    expect(parts.join('\n\n')).toBe([block, block, block, block, block].join('\n\n'));
  });
  it('cuts a single huge line rather than refuse it', () => {
    const parts = splitForTelegram('y'.repeat(5000), 2000);
    expect(parts.map((p) => p.length)).toEqual([2000, 2000, 1000]);
  });
});

describe('sendTelegram', () => {
  it('posts each part to the bot API and reports success', async () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    const f: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init!.body!) });
      return reply(200, { ok: true });
    };
    const r = await sendTelegram(f, 'TOKEN', '-100123', 'summary');
    expect(r).toEqual({ ok: true });
    expect(calls[0]!.url).toBe('https://api.telegram.org/botTOKEN/sendMessage');
    expect(calls[0]!.body).toMatchObject({ chat_id: '-100123', text: 'summary' });
  });
  it('says why Telegram refused', async () => {
    const f: Fetch = async () =>
      reply(403, { ok: false, description: 'Forbidden: bot was blocked by the user' });
    expect(await sendTelegram(f, 'T', '1', 'x')).toEqual({
      ok: false,
      error: 'Telegram said: Forbidden: bot was blocked by the user',
    });
  });
});

describe('findTelegramChats', () => {
  it('lists the people and groups that wrote to the bot, once each', async () => {
    const f: Fetch = async (url) =>
      url.endsWith('/getMe')
        ? reply(200, { ok: true, result: { username: 'my_family_bot' } })
        : reply(200, {
            ok: true,
            result: [
              { message: { chat: { id: 111, type: 'private', first_name: 'Asha' } } },
              { message: { chat: { id: 111, type: 'private', first_name: 'Asha' } } },
              { my_chat_member: { chat: { id: -100222, type: 'supergroup', title: 'Family' } } },
            ],
          });
    const r = await findTelegramChats(f, 'T');
    expect(r.bot).toBe('my_family_bot');
    expect(r.chats).toEqual([
      { id: '111', title: 'Asha', kind: 'private' },
      { id: '-100222', title: 'Family', kind: 'supergroup' },
    ]);
  });
  it('reports a wrong token', async () => {
    const f: Fetch = async () => reply(401, { ok: false, description: 'Unauthorized' });
    expect((await findTelegramChats(f, 'bad')).error).toBe('Telegram said: Unauthorized');
  });
});

describe('parseChatIds', () => {
  it('keeps valid ids and drops the rest', () => {
    expect(parseChatIds('123456, -100987654 ; abc 123456 12')).toEqual(['123456', '-100987654']);
  });
});
