import { describe, expect, it } from 'vitest';
import {
  modelsRequest,
  pickModel,
  rankModels,
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
