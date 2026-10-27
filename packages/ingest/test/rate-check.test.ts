import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiChain } from '../src/ai-chain';
import { checkRateSource } from '../src/rate-check';
import { chatReply, failure, fakeAiFetch } from './fake-ai';

const html = (body: string) =>
  new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
const page = (text: string) => html(`<html><body><p>${text}</p></body></html>`);

afterEach(() => vi.unstubAllGlobals());

describe('checkRateSource', () => {
  it('says the bank refused the automated visit when its page answers with an error', async () => {
    vi.stubGlobal('fetch', async () => new Response('busy', { status: 503 }));
    const r = await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/rates',
      ai: null,
    });
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(
      /^Cannot read: Sample Bank’s site refused the automated visit \(503 Service Unavailable\)/,
    );
    expect(r.verdict).toContain('Paste the page text instead');
    expect(r.steps[0]!.text).toContain('answered 503');
  });

  it('says the page did not load for an ordinary error', async () => {
    vi.stubGlobal('fetch', async () => new Response('gone', { status: 404 }));
    const r = await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/rates',
      ai: null,
    });
    expect(r.verdict).toMatch(/^Cannot read: Sample Bank’s own page did not load \(answered 404\)/);
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
    expect(r.verdict).toMatch(/^Cannot read: Sample Bank’s page has almost no readable text/);
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
    expect(r.verdict).toMatch(
      /^Cannot read: the bank’s page has no rates in its text \(its table is built by a script\)\./,
    );
  });

  it('says no key is switched on for an empty chain', async () => {
    readablePage();
    const r = await checkRateSource(args(createAiChain([])));
    expect(r.verdict).toMatch(/no AI key is switched on/);
  });
});

describe('checkRateSource: a bank page with no rates in its text', () => {
  it('says so plainly and reads nothing else: no comparison page is tried', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (u: string | URL | Request) => {
      asked.push(String(u));
      return page('Menu Login Offers '.repeat(30));
    });
    const fake = fakeAiFetch((c) => (c.body === null ? undefined : chatReply('{"offers":[]}')));
    const r = await checkRateSource({
      bank: 'HDFC Bank',
      url: 'https://www.hdfc.example.test/rates',
      ai: createAiChain([{ provider: 'groq', key: 'gsk_test_12345' }], { fetch: fake.fetch }),
    });
    expect(r.ok).toBe(false);
    expect(r.found).toBe(0);
    expect(r.verdict).toContain('has no rates in its text');
    expect(asked.some((u) => /bankbazaar|policybazaar/i.test(u))).toBe(false);
    for (const u of asked)
      expect(
        u === 'https://www.hdfc.example.test/rates' || new URL(u).host === 'www.hdfcbank.com',
      ).toBe(true);
  });
});

describe('checkRateSource: a bank whose rate document sits behind a link on its own page', () => {
  const HUB = 'https://equitas.bank.in/nri-banking/';
  const DOC = 'https://equitas.bank.in/strapi-dev/uploads/Interest_rates_pdf_1.html';
  const link =
    '<a class="float" href="/strapi-dev/uploads/Interest_rates_pdf_1.html">Interest Rates</a>';
  const route =
    (extra: Record<string, () => Response> = {}) =>
    async (u: string | URL | Request) => {
      const url = String(u);
      if (extra[url]) return extra[url]!();
      if (url === HUB) return html(`<html><body>${link}</body></html>`);
      if (url === DOC) return page('NRE fixed deposit 7.10% p.a. for 12 months. '.repeat(15));
      return new Response('not found', { status: 404 });
    };
  const check = () =>
    checkRateSource({
      bank: 'Equitas Small Finance Bank',
      url: 'https://equitas.bank.in/other',
      ai: null,
    });

  it('finds the link, says where it led and how much was read', async () => {
    vi.stubGlobal('fetch', route());
    const r = await check();
    const found = r.steps.find((s) => s.text.startsWith('Found the “Interest Rates” link'));
    expect(found?.ok).toBe(true);
    expect(found?.text).toContain(
      'equitas.bank.in/nri-banking/ → equitas.bank.in/strapi-dev/uploads/Interest_rates_pdf_1.html, read ',
    );
    const doc = r.docs.find((d) => d.via === HUB);
    expect(doc).toMatchObject({ url: DOC, ok: true, kind: 'both' });
    expect(doc!.chars).toBeGreaterThan(200);
    // a document was read; only the key is missing
    expect(r.verdict).toMatch(/no AI key is switched on/);
  });

  it('says the link was not found when the page has only a script-made button', async () => {
    vi.stubGlobal(
      'fetch',
      route({
        [HUB]: () =>
          html('<html><body><button onclick="x()">Interest Rates</button></body></html>'),
      }),
    );
    const r = await check();
    expect(r.ok).toBe(false);
    expect(
      r.steps.some((s) =>
        s.text.startsWith(
          'Cannot read: the “Interest Rates” link was not found in the page’s text (the button may be built by a script)',
        ),
      ),
    ).toBe(true);
  });

  it('ignores a link that leaves the bank’s own domain and never reads it', async () => {
    const asked: string[] = [];
    const inner = route({
      [HUB]: () => html('<a href="https://www.bankbazaar.com/rates.pdf">Interest Rates</a>'),
    });
    vi.stubGlobal('fetch', async (u: string | URL | Request) => {
      asked.push(String(u));
      return inner(u);
    });
    const r = await check();
    expect(asked.some((u) => u.includes('bankbazaar'))).toBe(false);
    expect(r.docs.some((d) => d.url.includes('bankbazaar'))).toBe(false);
  });

  it('reports a document that was found but cannot be read', async () => {
    vi.stubGlobal('fetch', route({ [DOC]: () => new Response('gone', { status: 404 }) }));
    const r = await check();
    const step = r.steps.find((s) => s.text.includes('but it could not be read'));
    expect(step?.text).toContain('equitas.bank.in/strapi-dev/uploads/Interest_rates_pdf_1.html');
    expect(step?.text).toContain('answered 404');
    expect(r.docs.find((d) => d.via)?.ok).toBe(false);
    expect(r.ok).toBe(false);
  });

  it('says plainly that the site refused the automated visit, and does not try to get round it', async () => {
    const asked: { url: string; ua: string | undefined }[] = [];
    vi.stubGlobal('fetch', async (u: string | URL | Request, init?: RequestInit) => {
      asked.push({
        url: String(u),
        ua: (init?.headers as Record<string, string> | undefined)?.['user-agent'],
      });
      return new Response('Request Rejected', { status: 503 });
    });
    const r = await check();
    expect(r.ok).toBe(false);
    expect(r.verdict).toMatch(
      /^Cannot read: Equitas Small Finance Bank’s site refused the automated visit \(503 Service Unavailable\)/,
    );
    expect(r.verdict).toContain('expand every section');
    for (const a of asked) expect(a.ua).toBe('family-wealth-os/1.0 (personal use)');
  });

  it('reads a 403 from ESAF as a refusal', async () => {
    vi.stubGlobal('fetch', async () => new Response('Access Denied', { status: 403 }));
    const r = await checkRateSource({
      bank: 'ESAF Small Finance Bank',
      url: 'https://www.esaf.bank.in/x',
      ai: null,
    });
    expect(r.verdict).toContain(
      'Cannot read: ESAF Small Finance Bank’s site refused the automated visit (403 Access Denied).',
    );
  });
});

describe('checkRateSource: documents typed by the kind of rates they carry', () => {
  it('labels each document so the reader takes only that kind from it', async () => {
    const seen: string[] = [];
    vi.stubGlobal('fetch', async (u: string | URL | Request) =>
      page(`${String(u).includes('sav') ? 'Savings 2.5% ' : 'Deposit 7.1% '}`.repeat(60)),
    );
    const fake = fakeAiFetch((c) => {
      if (c.body !== null) seen.push(JSON.stringify(c.body));
      return c.body === null ? undefined : chatReply('{"offers":[]}');
    });
    await checkRateSource({
      bank: 'Sample Bank',
      url: 'https://example.test/savings-rates',
      kind: 'savings',
      ai: createAiChain([{ provider: 'groq', key: 'gsk_test_12345' }], { fetch: fake.fetch }),
    });
    expect(seen.join('')).toContain('savings account rates only');
  });
});
