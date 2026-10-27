import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiChain } from '../src/ai-chain';
import { checkRateSource } from '../src/rate-check';
import { chatReply, failure, fakeAiFetch } from './fake-ai';

const page = (text: string) =>
  new Response(`<html><body><p>${text}</p></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });

afterEach(() => vi.unstubAllGlobals());

describe('checkRateSource', () => {
  it('says the page cannot be read when the bank answers with an error', async () => {
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }));
    const r = await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/rates',
      ai: null,
    });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(/does not let a program open its page/);
    expect(r.verdict).toContain('Paste the page instead');
    expect(r.steps[0]!.text).toContain('answered 503');
  });

  it('says a key is needed when the page reads but no AI key is saved', async () => {
    vi.stubGlobal('fetch', async () => page('Savings 3.5% p.a. '.repeat(30)));
    const r = await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/rates',
      ai: null,
    });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(/no AI key is switched on/);
    expect(r.steps[0]!.ok).toBe(true);
  });

  it('says the page has too little text when it needs a browser', async () => {
    vi.stubGlobal('fetch', async () => page('Loading'));
    const r = await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/rates',
      ai: null,
    });
    expect(r.ok).toBe(false);
    expect(r.steps[0]!.text).toContain('almost no readable text');
  });
});

describe('checkRateSource: with several AI keys', () => {
  const rates = chatReply(
    JSON.stringify({
      offers: [
        {
          product: 'fd',
          accountKind: 'NRE',
          tenureFromMonths: 12,
          tenureToMonths: 12,
          ratePct: 7.1,
          balanceFromRupees: null,
          balanceToRupees: null,
          conditions: '',
        },
      ],
    }),
  );
  const keys = [
    { provider: 'anthropic' as const, key: 'sk-ant-secret-1' },
    { provider: 'groq' as const, key: 'gsk-secret-2' },
  ];
  const args = (ai: ReturnType<typeof createAiChain>) => ({
    bank: 'Sample Bank',
    url: 'https://example.test/rates',
    ai,
  });
  const readablePage = () =>
    vi.stubGlobal('fetch', async () => page('Fixed deposit 7.1% p.a. for one year. '.repeat(20)));

  it('uses the next key when the first is refused, and shows both in the steps', async () => {
    readablePage();
    const fake = fakeAiFetch((c) =>
      c.body === null ? undefined : c.provider === 'anthropic' ? failure(401) : rates,
    );
    const r = await checkRateSource(args(createAiChain(keys, { fetch: fake.fetch })));
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(r.steps.some((s) => !s.ok && s.text.includes('Anthropic'))).toBe(true);
    expect(r.steps[r.steps.length - 1]!.text).toContain('Groq found 1 rates');
    expect(r.steps[r.steps.length - 1]!.text).toContain('after Anthropic answered 401');
  });

  it('puts every key’s reason in the verdict when none can answer', async () => {
    readablePage();
    const fake = fakeAiFetch((c) => (c.body === null ? undefined : failure(401)));
    const r = await checkRateSource(args(createAiChain(keys, { fetch: fake.fetch })));
    expect(r.ok).toBe(false);
    expect(r.verdict).toContain('None of the 2 AI keys could answer');
    expect(r.verdict).not.toMatch(/secret/);
  });

  it('blames the page, not the keys, when every key answers but finds no rates', async () => {
    readablePage();
    const none = chatReply('{"offers":[]}');
    const fake = fakeAiFetch((c) => (c.body === null ? undefined : none));
    const r = await checkRateSource(args(createAiChain(keys, { fetch: fake.fetch })));
    expect(r.ok).toBe(false);
    expect(r.verdict).toBe('Cannot sync: no rates could be found on the page.');
  });

  it('says no key is switched on for an empty chain', async () => {
    readablePage();
    const r = await checkRateSource(args(createAiChain([])));
    expect(r.verdict).toMatch(/no AI key is switched on/);
  });
});
