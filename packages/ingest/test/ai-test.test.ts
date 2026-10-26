import { afterEach, describe, expect, it, vi } from 'vitest';
import { testAiConnection } from '../src/ai-test';

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
    stub((url, body) =>
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
