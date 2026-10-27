import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkRateSource } from '../src/rate-check';

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
    expect(r.verdict).toMatch(/no AI key is saved/);
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

describe('checkRateSource: a bank page with no rates in its text', () => {
  it('falls back to the public comparison pages when the bank page has text but no rates', async () => {
    let asked = 0;
    vi.stubGlobal('fetch', async (u: string | URL | Request, init?: RequestInit) => {
      const url = String(u);
      if (/\/models/.test(url))
        return new Response(JSON.stringify({ data: [{ id: 'llama-3.3-70b-versatile' }] }), {
          status: 200,
        });
      if (/chat\/completions/.test(url)) {
        // the first call a key gets is a short check that the model answers; only the rate questions count
        const isRates = String(init?.body ?? '').includes('interest-rate page');
        if (isRates) asked++;
        const offers =
          asked === 1
            ? []
            : [
                {
                  product: 'fd',
                  accountKind: 'any',
                  tenureFromMonths: 12,
                  tenureToMonths: 12,
                  ratePct: 6.25,
                },
              ];
        return new Response(
          JSON.stringify({ choices: [{ message: { content: JSON.stringify({ offers }) } }] }),
          { status: 200 },
        );
      }
      return page(
        url.includes('bankbazaar')
          ? 'HDFC NRE FD rates 6.25% '.repeat(30)
          : 'Menu Login Offers '.repeat(30),
      );
    });
    const r = await checkRateSource({
      bank: 'HDFC Bank',
      url: 'https://www.hdfc.example/rates',
      ai: { provider: 'groq', key: 'gsk_test_12345' },
    });
    expect(asked).toBe(2);
    expect(r.ok).toBe(true);
    expect(r.steps.some((s) => /public comparison pages/.test(s.text))).toBe(true);
  });
});
