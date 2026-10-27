import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiChain } from '../src/ai-chain';
import { testAiChain, testAiConnection } from '../src/ai-test';
import { chatReply, failure, fakeAiFetch } from './fake-ai';

const today = '2026-10-26';
const reading = (amount: number, last4: string) =>
  JSON.stringify({
    readings: [{ bank: 'Sample Bank', last4, amount, currency: 'INR', asOf: today }],
  });
const chat = (content: string) => JSON.stringify({ choices: [{ message: { content } }] });

function stub(handler: (url: string, body: Record<string, unknown> | null) => Response) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: { body?: string }) =>
      handler(url, init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null),
    ),
  );
}
const json = (o: unknown, status = 200) =>
  new Response(typeof o === 'string' ? o : JSON.stringify(o), { status });

afterEach(() => vi.unstubAllGlobals());

describe('testAiConnection', () => {
  it('passes when the made-up alert is read back correctly, and names the model that answered', async () => {
    stub((url) =>
      url.includes('/models')
        ? json({
            data: [
              {
                id: 'meta-llama/llama-3.3-70b-instruct:free',
                pricing: { prompt: '0', completion: '0' },
              },
            ],
          })
        : json(chat(reading(123456.78, '4321'))),
    );
    const r = await testAiConnection({ provider: 'openrouter', key: 'sk-or-test', today });
    expect(r.ok).toBe(true);
    expect(r.model).toBe('meta-llama/llama-3.3-70b-instruct:free');
    expect(r.steps.every((s) => s.ok)).toBe(true);
    expect(JSON.stringify(r)).not.toContain('sk-or-test');
  });

  it('falls back to the next free model and still passes', async () => {
    const asked: string[] = [];
    stub((url, body) => {
      if (url.includes('/models'))
        return json({
          data: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free'].map(
            (id) => ({
              id,
              pricing: { prompt: '0', completion: '0' },
            }),
          ),
        });
      asked.push(String(body?.model));
      return body?.model === 'meta-llama/llama-3.3-70b-instruct:free'
        ? json({ error: { message: 'busy' } }, 429)
        : json(chat(reading(123456.78, '4321')));
    });
    const r = await testAiConnection({ provider: 'openrouter', key: 'k', today });
    expect(r.ok).toBe(true);
    expect(r.model).toBe('openai/gpt-oss-120b:free');
    expect(asked).toHaveLength(2);
  });

  it('says what is wrong and how to fix it when the provider refuses the key', async () => {
    stub(() => json({ error: { message: 'free tier is not available for this project' } }, 403));
    const r = await testAiConnection({ provider: 'gemini', key: 'k', today });
    expect(r.ok).toBe(false);
    const problem = r.steps.find((s) => !s.ok)!;
    expect(problem.text.length).toBeGreaterThan(20);
  });

  it('fails when the alert is read wrongly', async () => {
    stub((url) =>
      url.includes('/models')
        ? json({ data: [{ id: 'llama-3.3-70b-versatile' }] })
        : json(chat(reading(1, '9999'))),
    );
    const r = await testAiConnection({ provider: 'groq', key: 'k', today });
    expect(r.ok).toBe(false);
    expect(r.steps[r.steps.length - 1]!.text).toContain('read wrongly');
  });
});

describe('testAiChain', () => {
  const alertRead = (amount: number, last4: string) => chatReply(reading(amount, last4));
  const keys = [
    { provider: 'anthropic' as const, key: 'sk-ant-secret-1' },
    { provider: 'groq' as const, key: 'gsk-secret-2' },
    { provider: 'gemini' as const, key: 'AIza-secret-3' },
  ];

  it('asks the keys in order and says which one answers, what the failed ones did, and that later ones were not needed', async () => {
    const fake = fakeAiFetch((c) =>
      c.body === null
        ? undefined
        : c.provider === 'anthropic'
          ? failure(401)
          : alertRead(123456.78, '4321'),
    );
    const r = await testAiChain(createAiChain(keys, { fetch: fake.fetch }), today);
    expect(r.ok).toBe(true);
    expect(r.provider).toBe('groq');
    expect(r.steps.map((s) => [s.ok, s.neutral ?? false])).toEqual([
      [false, false],
      [true, false],
      [true, true],
    ]);
    expect(r.steps[0]!.text).toContain('1. Anthropic (Claude Haiku): Anthropic refused the key');
    expect(r.steps[1]!.text).toContain(
      '2. Groq: answered; the made-up alert was read back correctly',
    );
    expect(r.steps[2]!.text).toContain('3. Google Gemini: not asked');
    expect(fake.chatCalls().map((c) => c.provider)).toEqual(['anthropic', 'groq']);
    expect(JSON.stringify(r)).not.toMatch(/secret/);
  });

  it('moves on from a key that reads the alert wrongly', async () => {
    const fake = fakeAiFetch((c) =>
      c.body === null
        ? undefined
        : c.provider === 'anthropic'
          ? alertRead(1, '9999')
          : alertRead(123456.78, '4321'),
    );
    const r = await testAiChain(createAiChain(keys.slice(0, 2), { fetch: fake.fetch }), today);
    expect(r).toMatchObject({ ok: true, provider: 'groq' });
    expect(r.steps[0]!.text).toContain('nothing usable');
  });

  it('fails with a line per key when none can answer', async () => {
    const fake = fakeAiFetch((c) =>
      c.body === null ? undefined : failure(c.provider === 'groq' ? 429 : 500),
    );
    const r = await testAiChain(createAiChain(keys.slice(0, 2), { fetch: fake.fetch }), today);
    expect(r).toMatchObject({ ok: false, provider: null, model: null });
    expect(r.steps).toHaveLength(2);
    expect(r.steps.every((s) => !s.ok)).toBe(true);
  });

  it('says so when no key is switched on', async () => {
    const r = await testAiChain(createAiChain([]), today);
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.text).toContain('No AI key is switched on');
  });
});
