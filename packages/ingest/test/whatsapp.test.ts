import { describe, expect, it } from 'vitest';
import { CALLMEBOT_URL, callMeBot, callMeBotUrl, type TextFetch } from '../src/whatsapp';

const fake =
  (status: number, body: string, seen: string[] = []): TextFetch =>
  async (url) => {
    seen.push(url);
    return { ok: status < 400, status, text: async () => body };
  };

describe('CallMeBot', () => {
  it('builds the documented request with an encoded text', () => {
    const u = new URL(callMeBotUrl('+65 9123 4567', ' 123456 ', 'Hello & welcome\nline two'));
    expect(`${u.origin}${u.pathname}`).toBe(CALLMEBOT_URL);
    expect(u.searchParams.get('phone')).toBe('+6591234567');
    expect(u.searchParams.get('apikey')).toBe('123456');
    expect(u.searchParams.get('text')).toBe('Hello & welcome\nline two');
  });

  it('sends one GET and reports a queued message as sent', async () => {
    const seen: string[] = [];
    const r = await callMeBot(
      fake(200, 'Message queued. You will receive it in a few seconds.', seen),
    ).send({ phone: '+6591234567', key: '123456' }, 'hi');
    expect(r).toEqual({ ok: true });
    expect(seen).toHaveLength(1);
  });

  it('reports a refused key or a bad answer without repeating the number or the key', async () => {
    const to = { phone: '+6591234567', key: '123456' };
    const bad = await callMeBot(fake(200, 'APIKey is invalid for +6591234567')).send(to, 'hi');
    expect(bad.ok).toBe(false);
    expect(bad.error).not.toMatch(/6591234567|123456/);
    expect(await callMeBot(fake(500, 'oops')).send(to, 'hi')).toEqual({
      ok: false,
      error: 'CallMeBot answered 500',
    });
    const down = await callMeBot(async () => {
      throw new Error('getaddrinfo failed for api.callmebot.com?phone=+6591234567&apikey=123456');
    }).send(to, 'hi');
    expect(down).toEqual({ ok: false, error: 'CallMeBot could not be reached' });
  });

  it('does not call at all without an international number or a key', async () => {
    const seen: string[] = [];
    const s = callMeBot(fake(200, 'queued', seen));
    expect(await s.send({ phone: '91234567', key: '123456' }, 'hi')).toMatchObject({ ok: false });
    expect(await s.send({ phone: '+6591234567', key: ' ' }, 'hi')).toMatchObject({ ok: false });
    expect(seen).toHaveLength(0);
  });
});
