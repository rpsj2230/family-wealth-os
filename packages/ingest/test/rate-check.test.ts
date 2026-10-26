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
