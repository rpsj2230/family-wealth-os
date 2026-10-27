import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAiChain, type AiUsageEvent } from '@fwos/ingest';
import { syncBankRates, type SyncSource } from '../src/rate-sync';
import { chatReply, fakeAiFetch } from '../../ingest/test/fake-ai';
import { fakeDb } from './fake-db';

const HH = 'hh-1';
const TODAY = '2026-10-27';
const BANK = 'Sample Bank';

const html = (text: string) =>
  new Response(`<html><body><p>${text}</p></body></html>`, {
    status: 200,
    headers: { 'content-type': 'text/html' },
  });
const FD_PAGE = 'https://bank.example.test/deposits';
const SV_PAGE = 'https://bank.example.test/savings';
const BOTH_PAGE = 'https://bank.example.test/rates';

const fdOffer = {
  product: 'fd',
  accountKind: 'NRE',
  tenureFromMonths: 12,
  tenureToMonths: 12,
  ratePct: 7.1,
  balanceFromRupees: null,
  balanceToRupees: null,
  conditions: '',
};
const svOffer = {
  product: 'savings',
  accountKind: 'any',
  tenureFromMonths: 0,
  tenureToMonths: 0,
  ratePct: 2.5,
  balanceFromRupees: null,
  balanceToRupees: null,
  conditions: '',
};
const says = (...offers: object[]) => chatReply(JSON.stringify({ offers }));

function setup(
  opts: {
    offers?: Record<string, unknown>[];
    reply?: ReturnType<typeof chatReply>;
    withKey?: boolean;
  } = {},
) {
  const { db, tables, rows, log } = fakeDb({
    rate_sources: [
      { id: 's1', household_id: HH, bank: BANK, url: BOTH_PAGE, kind: 'both', enabled: true },
    ],
    rate_offers: opts.offers ?? [],
    rate_hints: [],
    assets: [],
  });
  const fake = fakeAiFetch((c) => (c.body === null ? undefined : (opts.reply ?? says(fdOffer))));
  const usage: AiUsageEvent[] = [];
  const ai =
    opts.withKey === false
      ? createAiChain([])
      : createAiChain([{ provider: 'groq', key: 'gsk_test_12345' }], {
          fetch: fake.fetch,
          usage: (e) => void usage.push(e),
        });
  const sources: SyncSource[] = [
    { id: 's1', url: BOTH_PAGE, kind: 'both', pageHash: null, readOn: null },
  ];
  const run = (over: Partial<Parameters<typeof syncBankRates>[0]> = {}) =>
    syncBankRates({
      db,
      household: HH,
      bank: BANK,
      sources: over.sources ?? [
        {
          ...sources[0]!,
          pageHash: (rows('rate_sources')[0]!.page_hash as string | undefined) ?? null,
          readOn: (rows('rate_sources')[0]!.read_on as string | undefined) ?? null,
        },
      ],
      ai,
      settings: { maxAmount: undefined, staleDays: 30 },
      today: TODAY,
      heldNames: [],
      ...over,
    });
  return { db, tables, rows, log, fake, usage, run };
}

const offer = (o: Record<string, unknown>) => ({
  id: `o-${Math.random().toString(36).slice(2, 8)}`,
  household_id: HH,
  bank: BANK,
  product: 'fd',
  account_kind: 'NRE',
  tenure_from_months: 12,
  tenure_to_months: 12,
  balance_from: null,
  balance_to: null,
  rate: 0.07,
  source_kind: 'ai',
  ai_rate: null,
  correction_reason: null,
  misread_count: 0,
  source_note: 'Read from bank.example.test',
  checked_on: '2026-10-01',
  ...o,
});

afterEach(() => vi.unstubAllGlobals());
const pageOk = () =>
  vi.stubGlobal('fetch', async () => html('Fixed deposit NRE 7.1% p.a. for one year. '.repeat(20)));

describe('syncBankRates', () => {
  it('reads the bank’s page, saves the rates and records the result on the bank’s rows', async () => {
    pageOk();
    const t = setup();
    const r = await t.run();
    expect(r.status).toBe('synced');
    expect(r.message).toMatch(/^1 rates saved: 1 new, 0 changed, 0 unchanged/);
    expect(r.saved?.inserted).toBe(1);
    const saved = t.rows('rate_offers');
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ bank: BANK, product: 'fd', rate: 0.071, source_kind: 'ai' });
    expect(String(saved[0]!.source_note)).toMatch(/^Read from bank\.example\.test: rates/);
    const src = t.rows('rate_sources')[0]!;
    expect(src.last_run_on).toBe(TODAY);
    expect(String(src.last_result)).toMatch(/^1 rates saved/);
    expect(src.read_on).toBe(TODAY);
    expect(String(src.page_hash)).toHaveLength(64);
    expect(src.last_docs).toMatchObject([{ url: BOTH_PAGE, kind: 'both', ok: true }]);
  });

  it('logs the AI call for the cost page with the purpose rates_refresh', async () => {
    pageOk();
    const t = setup();
    await t.run();
    expect(t.usage.length).toBeGreaterThan(0);
    expect(t.usage.every((u) => u.purpose === 'rates_refresh')).toBe(true);
  });

  it('does not ask the AI again when the page is the same: the rates are confirmed as checked today', async () => {
    pageOk();
    const t = setup();
    await t.run();
    const calls = t.fake.chatCalls().length;
    t.rows('rate_offers')[0]!.checked_on = '2026-10-20';
    const again = await t.run();
    expect(again.status).toBe('unchanged');
    expect(again.message).toMatch(
      /^Unchanged since 2026-10-27: not read again \(no AI cost\); 1 rates confirmed as checked today\./,
    );
    expect(t.fake.chatCalls().length).toBe(calls);
    expect(t.rows('rate_offers')[0]!.checked_on).toBe(TODAY);
  });

  it('reads again when the page changed', async () => {
    pageOk();
    const t = setup();
    await t.run();
    const calls = t.fake.chatCalls().length;
    vi.stubGlobal('fetch', async () =>
      html('Fixed deposit NRE 7.25% p.a. for one year. '.repeat(20)),
    );
    const again = await t.run();
    expect(again.status).toBe('synced');
    expect(t.fake.chatCalls().length).toBeGreaterThan(calls);
  });

  it('says plainly it cannot read a page the bank refused, and keeps the rates on file', async () => {
    vi.stubGlobal('fetch', async () => new Response('Access Denied', { status: 403 }));
    const t = setup({ offers: [offer({})] });
    const r = await t.run();
    expect(r.status).toBe('cannot');
    expect(r.message).toMatch(
      /^Cannot read: Sample Bank’s site refused the automated visit \(403 Access Denied\)\./,
    );
    expect(r.saved).toBeNull();
    expect(t.rows('rate_offers')).toHaveLength(1);
    expect(t.rows('rate_offers')[0]!.rate).toBe(0.07);
    const src = t.rows('rate_sources')[0]!;
    expect(String(src.last_result)).toMatch(/^Cannot read:/);
    expect(src.last_run_on).toBe(TODAY);
    expect(t.fake.chatCalls()).toHaveLength(0);
  });

  it('says the page has no rates in its text when every key answers with none', async () => {
    pageOk();
    const t = setup({ reply: chatReply('{"offers":[]}'), offers: [offer({})] });
    const r = await t.run();
    expect(r.status).toBe('cannot');
    expect(r.message).toMatch(
      /^Cannot read: the bank’s page has no rates in its text \(its table is built by a script\)/,
    );
    expect(t.rows('rate_offers')).toHaveLength(1);
  });

  it('says so when no AI key is switched on, without reading anything', async () => {
    const asked: string[] = [];
    vi.stubGlobal('fetch', async (u: string | URL | Request) => {
      asked.push(String(u));
      return html('x'.repeat(400));
    });
    const t = setup({ withKey: false });
    const r = await t.run();
    expect(r.status).toBe('no_key');
    expect(r.message).toMatch(/^Not read: no AI key is switched on\./);
    expect(r.message).toContain('Settings > Connections');
    expect(asked).toHaveLength(0);
    expect(String(t.rows('rate_sources')[0]!.last_result)).toMatch(/^Not read: no AI key/);
  });

  it('never overwrites a rate you typed yourself', async () => {
    pageOk();
    const typed = offer({ source_kind: 'manual', rate: 0.075, source_note: 'Typed in the form' });
    const t = setup({ offers: [typed] });
    const r = await t.run();
    expect(r.status).toBe('synced');
    const row = t.rows('rate_offers').find((o) => o.id === typed.id)!;
    expect(row.rate).toBe(0.075);
    expect(row.source_kind).toBe('manual');
    expect(row.page_rate).toBeCloseTo(0.071, 5);
    expect(r.message).toContain('1 typed rates differ from the page');
    expect(t.rows('rate_offers')).toHaveLength(1);
  });

  it('replaces rates once saved from comparison websites with the bank’s own, and says how many', async () => {
    pageOk();
    const same = offer({
      rate: 0.069,
      source_note: 'Reference only, from comparison.example.test (third party)',
    });
    const gone = offer({
      tenure_from_months: 36,
      tenure_to_months: 36,
      source_note: 'Reference only, from comparison.example.test (third party)',
    });
    const typed = offer({
      product: 'savings',
      account_kind: 'any',
      tenure_from_months: 0,
      tenure_to_months: 0,
      source_kind: 'manual',
      source_note: 'Typed in the form',
    });
    const t = setup({ offers: [same, gone, typed] });
    const r = await t.run();
    expect(r.saved?.replacedThirdParty).toBe(2);
    expect(r.message).toContain('2 from comparison websites replaced by the bank');
    const left = t.rows('rate_offers');
    expect(left.some((o) => String(o.source_note).startsWith('Reference only'))).toBe(false);
    expect(left.find((o) => o.id === same.id)).toMatchObject({ rate: 0.071 });
    expect(String(left.find((o) => o.id === same.id)!.source_note)).toMatch(/^Read from/);
    expect(left.find((o) => o.id === gone.id)).toBeUndefined();
    expect(left.find((o) => o.id === typed.id)).toBeDefined();
  });

  it('does not treat rates from comparison websites as confirmed by an unchanged page', async () => {
    pageOk();
    const t = setup();
    await t.run();
    t.rows('rate_offers')[0]!.source_note = 'Reference only, from comparison.example.test';
    const again = await t.run();
    expect(again.status).toBe('synced');
    expect(String(t.rows('rate_offers')[0]!.source_note)).toMatch(/^Read from/);
  });

  it('keeps the rates of a kind whose page could not be read', async () => {
    vi.stubGlobal('fetch', async (u: string | URL | Request) =>
      String(u) === FD_PAGE
        ? html('Fixed deposit NRE 7.1% p.a. for one year. '.repeat(20))
        : new Response('gone', { status: 404 }),
    );
    const savings = offer({
      product: 'savings',
      account_kind: 'any',
      tenure_from_months: 0,
      tenure_to_months: 0,
      rate: 0.025,
    });
    const t = setup({ offers: [savings], reply: says(fdOffer, svOffer) });
    const r = await t.run({
      sources: [
        { id: 's1', url: FD_PAGE, kind: 'fd', pageHash: null, readOn: null },
        { id: 's1', url: SV_PAGE, kind: 'savings', pageHash: null, readOn: null },
      ],
    });
    expect(r.status).toBe('synced');
    expect(r.docs.map((d) => [d.kind, d.ok])).toEqual([
      ['fd', true],
      ['savings', false],
    ]);
    const left = t.rows('rate_offers');
    // the savings rate on file stays, and a savings rate the AI invented from a deposits page is not saved
    expect(left.filter((o) => o.product === 'savings')).toHaveLength(1);
    expect(left.find((o) => o.id === savings.id)!.rate).toBe(0.025);
    expect(left.filter((o) => o.product === 'fd')).toHaveLength(1);
  });

  it('tells the reader which kind each document carries', async () => {
    pageOk();
    const t = setup();
    await t.run({
      sources: [{ id: 's1', url: SV_PAGE, kind: 'savings', pageHash: null, readOn: null }],
    });
    const asked = JSON.stringify(t.fake.chatCalls().map((c) => c.body));
    expect(asked).toContain('savings account rates only');
  });

  it('never throws: a failure is the result', async () => {
    pageOk();
    const t = setup();
    const broken = {
      from: () => {
        throw new Error('database is down');
      },
    } as unknown as Parameters<typeof syncBankRates>[0]['db'];
    const r = await syncBankRates({
      db: broken,
      household: HH,
      bank: BANK,
      sources: [{ id: 's1', url: BOTH_PAGE, kind: 'both', pageHash: null, readOn: null }],
      ai: createAiChain([{ provider: 'groq', key: 'gsk_test_12345' }], { fetch: t.fake.fetch }),
      settings: { maxAmount: undefined, staleDays: 30 },
      today: TODAY,
      heldNames: [],
    });
    // the result cannot even be recorded, but the call still does not throw to its caller
    expect(r.status).toBe('cannot');
    expect(r.message).toContain('database is down');
    expect(r.message).toContain('could not be recorded');
  });
});
