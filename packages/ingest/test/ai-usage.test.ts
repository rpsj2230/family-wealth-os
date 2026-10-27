import { describe, expect, it } from 'vitest';
import { createAiChain, callAi } from '../src/ai-chain';
import { usageFromResponse, type AiUsageEvent } from '../src/ai-usage';
import { buildAiChat } from '../src/bank-email';
import { buildRatesRequest } from '../src/rates-ai';
import { chatReply, failure, fakeAiFetch } from './fake-ai';

describe('usageFromResponse', () => {
  it('reads Anthropic, keeping cache reads and writes apart from new input', () => {
    expect(
      usageFromResponse('anthropic', {
        usage: {
          input_tokens: 300,
          output_tokens: 120,
          cache_read_input_tokens: 4000,
          cache_creation_input_tokens: 800,
        },
      }),
    ).toEqual({ input: 300, output: 120, cacheRead: 4000, cacheWrite: 800 });
  });
  it('reads OpenAI-style answers and takes cached tokens out of the input', () => {
    expect(
      usageFromResponse('groq', {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 50,
          prompt_tokens_details: { cached_tokens: 400 },
        },
      }),
    ).toEqual({ input: 600, output: 50, cacheRead: 400, cacheWrite: 0 });
    expect(
      usageFromResponse('openrouter', { usage: { prompt_tokens: 10, completion_tokens: 2 } }),
    ).toEqual({
      input: 10,
      output: 2,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });
  it('reads Gemini, counting thinking tokens as output', () => {
    expect(
      usageFromResponse('gemini', {
        usageMetadata: {
          promptTokenCount: 500,
          candidatesTokenCount: 40,
          thoughtsTokenCount: 60,
          cachedContentTokenCount: 100,
        },
      }),
    ).toEqual({ input: 400, output: 100, cacheRead: 100, cacheWrite: 0 });
  });
  it('says nothing is known when the answer carries no figures', () => {
    expect(usageFromResponse('anthropic', { content: [] })).toBeNull();
    expect(usageFromResponse('groq', null)).toBeNull();
  });
});

describe('callAi reports every real call', () => {
  const answer = (extra: Record<string, unknown> = {}) => ({
    json: { ...(chatReply('{"ok":true}').json as object), ...extra },
  });
  const spec = {
    purpose: 'rates_refresh' as const,
    build: (p: string, k: string, m: string | undefined) =>
      buildAiChat(p as never, k, 'system', 'text', m),
    parse: (_p: string, json: unknown) =>
      (json as { choices?: unknown[] }).choices ? { fine: true } : null,
  };
  it('logs a used call with its tokens, and a refused one without', async () => {
    const events: AiUsageEvent[] = [];
    const fake = fakeAiFetch((c) =>
      c.body === null
        ? undefined
        : c.provider === 'anthropic'
          ? failure(401)
          : answer({ usage: { prompt_tokens: 900, completion_tokens: 30 } }),
    );
    const chain = createAiChain(
      [
        { provider: 'anthropic', key: 'sk-ant-1' },
        { provider: 'groq', key: 'gsk-2' },
      ],
      { fetch: fake.fetch, usage: (e) => void events.push(e) },
    );
    const r = await callAi(chain, spec as never);
    expect(r.ok).toBe(true);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      provider: 'anthropic',
      ok: false,
      status: 401,
      tokens: null,
      purpose: 'rates_refresh',
    });
    expect(events[1]).toMatchObject({
      provider: 'groq',
      ok: true,
      tokens: { input: 900, output: 30 },
    });
    expect(JSON.stringify(events)).not.toMatch(/sk-ant-1|gsk-2/);
  });
  it('still counts the tokens of an answer that had nothing usable in it', async () => {
    const events: AiUsageEvent[] = [];
    const fake = fakeAiFetch((c) =>
      c.body === null
        ? undefined
        : { json: { usage: { prompt_tokens: 50, completion_tokens: 5 } } },
    );
    const chain = createAiChain([{ provider: 'groq', key: 'gsk-2' }], {
      fetch: fake.fetch,
      usage: (e) => void events.push(e),
    });
    const r = await callAi(chain, spec as never);
    expect(r.ok).toBe(false);
    expect(events[0]).toMatchObject({ ok: false, status: 200, tokens: { input: 50, output: 5 } });
  });
  it('a logging failure never stops the reading', async () => {
    const fake = fakeAiFetch((c) => (c.body === null ? undefined : answer()));
    const chain = createAiChain([{ provider: 'groq', key: 'gsk-2' }], {
      fetch: fake.fetch,
      usage: () => {
        throw new Error('database down');
      },
    });
    expect((await callAi(chain, spec as never)).ok).toBe(true);
  });
});

describe('prompt caching', () => {
  it('keeps the start of every Anthropic rates request the same for every bank, so it can be cached', () => {
    const a = JSON.parse(
      buildRatesRequest('anthropic', 'k', 'HDFC Bank', 'page A', undefined, ['rule'], 10_000_000)
        .init.body,
    );
    const b = JSON.parse(
      buildRatesRequest('anthropic', 'k', 'IDFC First Bank', 'page B', undefined, [], 10_000_000)
        .init.body,
    );
    expect(a.system[0].text).toBe(b.system[0].text);
    expect(a.system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(a.messages[0].content).toContain('HDFC Bank');
    expect(a.messages[0].content).toContain('rule');
    expect(b.messages[0].content).toContain('IDFC First Bank');
  });
});
