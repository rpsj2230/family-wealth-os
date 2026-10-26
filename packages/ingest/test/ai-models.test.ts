import { describe, expect, it } from 'vitest';
import { aiJson, buildAiChat } from '../src/bank-email';
import {
  modelsRequest,
  pickModel,
  aiErrorHint,
  rankModels,
  withModelFallback,
  resolveModel,
  resolveWorkingModel,
} from '../src/ai-models';

describe('pickModel', () => {
  it('prefers a current Groq chat model and skips speech and safety models', () => {
    const list = {
      data: [
        { id: 'whisper-large-v3' },
        { id: 'llama-guard-4-12b' },
        { id: 'llama-3.1-8b-instant' },
        { id: 'llama-3.3-70b-versatile' },
        { id: 'playai-tts' },
      ],
    };
    expect(pickModel('groq', list)).toBe('llama-3.3-70b-versatile');
  });
  it('falls back down the list when the best is gone', () => {
    expect(
      pickModel('groq', { data: [{ id: 'llama-3.1-8b-instant' }, { id: 'whisper-large-v3' }] }),
    ).toBe('llama-3.1-8b-instant');
    expect(pickModel('groq', { data: [{ id: 'some-new-model' }] })).toBe('some-new-model');
  });
  it('picks a stable Gemini flash model that can generate content, not previews or image models', () => {
    const list = {
      models: [
        {
          name: 'models/gemini-2.5-flash-preview-05-20',
          supportedGenerationMethods: ['generateContent'],
        },
        { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
        {
          name: 'models/gemini-2.5-flash',
          supportedGenerationMethods: ['generateContent', 'countTokens'],
        },
      ],
    };
    expect(pickModel('gemini', list)).toBe('gemini-2.5-flash');
  });
  it('returns null when the list is empty or unreadable', () => {
    expect(pickModel('groq', {})).toBeNull();
    expect(pickModel('gemini', null)).toBeNull();
  });
});

describe('resolveModel', () => {
  it('asks the provider and returns the pick', async () => {
    const calls: string[] = [];
    const m = await resolveModel(
      async (u) => {
        calls.push(u);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'llama-3.3-70b-versatile' }] }),
        };
      },
      'groq',
      'K',
    );
    expect(m).toBe('llama-3.3-70b-versatile');
    expect(calls[0]).toBe('https://api.groq.com/openai/v1/models');
    expect(modelsRequest('gemini', 'a b').url).toContain('key=a%20b');
  });
  it('gives null on a refused key or a network error, so the caller keeps its default', async () => {
    expect(
      await resolveModel(
        async () => ({ ok: false, status: 401, json: async () => ({}) }),
        'groq',
        'K',
      ),
    ).toBeNull();
    expect(
      await resolveModel(
        async () => {
          throw new Error('down');
        },
        'gemini',
        'K',
      ),
    ).toBeNull();
  });
});

describe('a listed model that cannot be called', () => {
  const list = {
    models: [
      'gemini-2.5-flash',
      'gemini-3.8-flash',
      'gemini-2.5-flash-lite',
      'gemini-3.8-flash-image',
    ].map((n) => ({ name: `models/${n}`, supportedGenerationMethods: ['generateContent'] })),
  };
  it('ranks the newest stable flash model first, then older ones', () => {
    expect(rankModels('gemini', list).slice(0, 3)).toEqual([
      'gemini-3.8-flash',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
  });
  it('skips a model that answers 404 and keeps the first that answers', async () => {
    const asked: string[] = [];
    const f = async (u: string) => {
      if (u.includes('/models?')) return { ok: true, status: 200, json: async () => list };
      asked.push(u);
      return u.includes('gemini-3.8-flash:')
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({}) };
    };
    expect(await resolveWorkingModel(f, 'gemini', 'K')).toBe('gemini-2.5-flash');
    expect(asked).toHaveLength(2);
  });
  it('keeps a model that is only rate limited, and gives null when none answers', async () => {
    const limited = async (u: string) =>
      u.includes('/models?')
        ? { ok: true, status: 200, json: async () => list }
        : { ok: false, status: 429, json: async () => ({}) };
    expect(await resolveWorkingModel(limited, 'gemini', 'K')).toBe('gemini-3.8-flash');
    const none = async (u: string) =>
      u.includes('/models?')
        ? { ok: true, status: 200, json: async () => list }
        : { ok: false, status: 404, json: async () => ({}) };
    expect(await resolveWorkingModel(none, 'gemini', 'K')).toBeNull();
  });
});

describe('aiErrorHint', () => {
  it('explains a Gemini project without a free tier and says what to do', () => {
    const h = aiErrorHint(
      'gemini',
      403,
      'The Gemini API free tier is not available for this project',
    );
    expect(h).toContain('no free tier');
    expect(h).toContain('Groq');
  });
  it('says what a refused key, a retired model and a used-up quota mean', () => {
    expect(aiErrorHint('groq', 401, '')).toContain('refused');
    expect(aiErrorHint('gemini', 404, 'no longer available to new users')).toContain(
      'no longer offered',
    );
    expect(aiErrorHint('groq', 429, '')).toContain('quota');
    expect(aiErrorHint('groq', 500, '')).toBeNull();
  });
});

describe('OpenRouter free models', () => {
  const list = {
    data: [
      {
        id: 'anthropic/claude-sonnet',
        pricing: { prompt: '0.003', completion: '0.015' },
        context_length: 200000,
      },
      {
        id: 'google/gemma-3-27b-it:free',
        pricing: { prompt: '0', completion: '0' },
        context_length: 96000,
      },
      {
        id: 'meta-llama/llama-3.3-70b-instruct:free',
        pricing: { prompt: '0', completion: '0' },
        context_length: 65000,
      },
      {
        id: 'deepseek/deepseek-r1:free',
        pricing: { prompt: '0', completion: '0' },
        context_length: 163000,
      },
      {
        id: 'openai/gpt-oss-120b:free',
        pricing: { prompt: '0', completion: '0' },
        context_length: 131000,
      },
      {
        id: 'some/vision-model-vl:free',
        pricing: { prompt: '0', completion: '0' },
        context_length: 32000,
      },
      {
        id: 'img/maker:free',
        pricing: { prompt: '0', completion: '0' },
        architecture: { input_modalities: ['text'], output_modalities: ['image'] },
      },
    ],
  };
  it('keeps only free, text-only models and ranks the strong instruction models first', () => {
    const r = rankModels('openrouter', list);
    expect(r).not.toContain('anthropic/claude-sonnet');
    expect(r).not.toContain('some/vision-model-vl:free');
    expect(r).not.toContain('img/maker:free');
    expect(r.slice(0, 3)).toEqual([
      'meta-llama/llama-3.3-70b-instruct:free',
      'openai/gpt-oss-120b:free',
      'google/gemma-3-27b-it:free',
    ]);
    expect(r[r.length - 1]).toBe('deepseek/deepseek-r1:free');
  });

  const ok = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });
  const reply = (status: number, text: string) => ({
    ok: status < 300,
    status,
    text: async () => text,
  });

  it('moves to the next free model when one errors, is limited, or answers something that is not JSON', async () => {
    const asked: string[] = [];
    const f = withModelFallback(
      async (_u, init) => {
        const m = JSON.parse(String(init?.body)).model as string;
        asked.push(m);
        if (m === 'a') return reply(429, 'rate limited');
        if (m === 'b') return reply(200, ok('Sorry, I cannot help with that.'));
        if (m === 'c') return reply(200, JSON.stringify({ error: { message: 'upstream down' } }));
        return reply(200, ok('Here you go: ```json\n{"readings": []}\n```'));
      },
      'openrouter',
      ['a', 'b', 'c', 'd', 'e'],
    );
    const r = await f('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({ model: 'x', messages: [] }),
    });
    expect(r.ok).toBe(true);
    expect(asked).toEqual(['a', 'b', 'c', 'd']);
  });
  it('says which models failed and why when none works', async () => {
    const f = withModelFallback(async () => reply(429, 'limit'), 'openrouter', ['a', 'b']);
    const r = await f('u', { body: JSON.stringify({}) });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(429);
    expect(await r.text()).toContain('a: 429; b: 429');
  });
  it('calls other providers exactly once, as they are', async () => {
    let n = 0;
    const f = withModelFallback(async () => (n++, reply(200, '{}')), 'groq', ['a', 'b']);
    await f('u', { body: '{}' });
    expect(n).toBe(1);
  });
});

describe('withModelFallback remembers what it learned', () => {
  const body = JSON.stringify({ messages: [] });
  const ok = JSON.stringify({ choices: [{ message: { content: '{"a":1}' } }] });
  it('asks a model that worked first next time, and does not ask one that was refused again', async () => {
    const asked: string[] = [];
    const f = async (_u: string, init?: Record<string, unknown>) => {
      const model = (JSON.parse(String(init?.body)) as { model: string }).model;
      asked.push(model);
      if (model === 'restricted') return { ok: false, status: 403, text: async () => 'no' };
      return { ok: true, status: 200, text: async () => ok };
    };
    const call = withModelFallback(f, 'openrouter', ['restricted', 'good', 'other']);
    await call('https://x.test', { body });
    expect(asked).toEqual(['restricted', 'good']);
    asked.length = 0;
    await call('https://x.test', { body });
    expect(asked).toEqual(['good']);
  });
});

describe('Anthropic provider', () => {
  it('asks the Messages API for Claude Haiku with no sampling setting and JSON asked for in words', () => {
    const r = buildAiChat('anthropic', 'sk-ant-test', 'Read it.', 'some text');
    expect(r.url).toBe('https://api.anthropic.com/v1/messages');
    expect(r.init.headers['x-api-key']).toBe('sk-ant-test');
    expect(r.init.headers['anthropic-version']).toBe('2023-06-01');
    const b = JSON.parse(r.init.body) as Record<string, unknown>;
    expect(b.model).toBe('claude-haiku-5-5');
    expect(b).not.toHaveProperty('temperature');
    expect(b.max_tokens).toBeGreaterThan(1000);
    expect(String(b.system)).toContain('JSON');
    expect(b.messages).toEqual([{ role: 'user', content: 'some text' }]);
  });
  it('reads the text blocks of the answer and ignores thinking blocks', () => {
    const answer = {
      content: [
        { type: 'thinking', thinking: '' },
        {
          type: 'text',
          text: '{"readings":[{"bank":"HDFC","last4":"1234","amount":1000,"currency":"INR","asOf":"2026-10-01"}]}',
        },
      ],
    };
    expect(aiJson('anthropic', answer)).toEqual({
      readings: [
        { bank: 'HDFC', last4: '1234', amount: 1000, currency: 'INR', asOf: '2026-10-01' },
      ],
    });
  });
  it('lists models with the key and prefers Haiku 5.5, then the next tiers', () => {
    const req = modelsRequest('anthropic', 'k');
    expect(req.url).toContain('/v1/models');
    expect(req.init.headers['x-api-key']).toBe('k');
    const list = {
      data: [
        { id: 'claude-opus-5-5' },
        { id: 'claude-sonnet-5-5' },
        { id: 'claude-haiku-4-5' },
        { id: 'claude-haiku-5-5' },
      ],
    };
    expect(rankModels('anthropic', list)).toEqual([
      'claude-haiku-5-5',
      'claude-sonnet-5-5',
      'claude-haiku-4-5',
      'claude-opus-5-5',
    ]);
  });
  it('explains an invalid key and an empty balance in plain words', () => {
    expect(aiErrorHint('anthropic', 401, '')).toContain('console.anthropic.com');
    expect(
      aiErrorHint('anthropic', 400, 'Your credit balance is too low to access the API'),
    ).toContain('credit');
    expect(aiErrorHint('anthropic', 529, '')).toContain('busy');
  });
});
