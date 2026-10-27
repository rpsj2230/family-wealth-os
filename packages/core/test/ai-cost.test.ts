import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFromJson } from '../src/config';
import {
  costUsd,
  formatInrSmall,
  formatUsd,
  parsePriceLine,
  parsePrices,
  priceFor,
  summariseUsage,
  type AiUsageRow,
} from '../src/ai-cost';

const prices = parsePrices(DEFAULT_CONFIG.ai.prices);
const row = (o: Partial<AiUsageRow>): AiUsageRow => ({
  id: Math.random().toString(36),
  at: '2026-10-27T03:00:00Z',
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  purpose: 'rates_refresh',
  ok: true,
  status: 200,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  known: true,
  ms: 1000,
  note: null,
  ...o,
});

describe('price lines', () => {
  it('reads input / output and defaults the cache prices to a tenth and a quarter more', () => {
    expect(parsePriceLine('Claude-Haiku-5-5 = 0.10 / 0.50')).toEqual({
      model: 'claude-haiku-5-5',
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      cacheWrite: 0.125,
    });
  });
  it('reads all four prices and explains a line it cannot read', () => {
    expect(parsePriceLine('m = 1 / 2 / 0.3 / 4')).toMatchObject({ cacheRead: 0.3, cacheWrite: 4 });
    expect(parsePriceLine('no equals sign')).toHaveProperty('error');
    expect(parsePriceLine('m = 1')).toHaveProperty('error');
    expect(parsePriceLine('m = 1 / x')).toHaveProperty('error');
  });
  it('picks the most specific price for a model', () => {
    const p = parsePrices([
      'claude-haiku* = 1 / 5',
      'claude-haiku-5-5 = 0.1 / 0.5',
      '*:free = 0 / 0',
    ]);
    expect(priceFor(p, 'claude-haiku-5-5')?.input).toBe(0.1);
    expect(priceFor(p, 'claude-haiku-4-5')?.input).toBe(1);
    expect(priceFor(p, 'meta/llama-3:free')?.input).toBe(0);
    expect(priceFor(p, 'gpt-x')).toBeNull();
    expect(priceFor(p, null)).toBeNull();
  });
  it('the built-in config carries the prices and a rate, and keeps them when saved settings are bad', () => {
    expect(prices.length).toBeGreaterThan(0);
    expect(configFromJson({ ai: { usdInr: 0, prices: ['garbage'] } }).ai).toEqual(
      DEFAULT_CONFIG.ai,
    );
    expect(configFromJson({ ai: { usdInr: 90, prices: ['x = 1 / 2'] } }).ai).toEqual({
      usdInr: 90,
      prices: ['x = 1 / 2'],
    });
  });
});

describe('cost of a call', () => {
  it('prices each kind of token at its own rate', () => {
    const p = parsePriceLine('m = 1 / 5 / 0.1 / 1.25');
    if ('error' in p) throw new Error('bad');
    // 1M new input + 1M output + 1M cache read + 1M cache write
    expect(costUsd({ input: 1e6, output: 1e6, cacheRead: 1e6, cacheWrite: 1e6 }, p)).toBeCloseTo(
      7.35,
      6,
    );
  });
});

describe('summariseUsage', () => {
  const rows = [
    row({ at: '2026-10-27T03:00:00Z', input: 9000, output: 400, cacheRead: 0, cacheWrite: 800 }),
    row({
      at: '2026-10-27T03:01:00Z',
      input: 300,
      output: 400,
      cacheRead: 4000,
      purpose: 'inbox_email',
    }),
    row({ at: '2026-10-20T03:00:00Z', input: 10_000, output: 500 }),
    row({ at: '2026-09-02T03:00:00Z', input: 10_000, output: 500 }),
    row({
      at: '2026-10-27T04:00:00Z',
      provider: 'groq',
      model: 'llama-3.3',
      input: 500,
      output: 50,
    }),
    row({
      at: '2026-10-27T05:00:00Z',
      ok: false,
      status: 429,
      known: false,
      model: 'claude-haiku-5-5',
    }),
  ];
  const s = summariseUsage(rows, prices, '2026-10-27');

  it('adds up the calls, the failed ones and the tokens', () => {
    expect(s.totals.calls).toBe(6);
    expect(s.totals.failed).toBe(1);
    expect(s.totals.input).toBe(9000 + 300 + 10_000 + 10_000 + 500);
    expect(s.totals.cacheRead).toBe(4000);
  });
  it('prices only what has a price, and names the models that have none', () => {
    const first = (9000 * 0.1 + 400 * 0.5 + 800 * 0.125) / 1e6;
    expect(s.recent.find((r) => r.input === 9000)?.usd).toBeCloseTo(first, 10);
    expect(s.recent.find((r) => r.provider === 'groq')?.usd).toBeNull();
    expect(s.unpricedModels).toEqual(['llama-3.3']);
    expect(s.recent.find((r) => !r.ok)?.usd).toBeNull(); // no figures known for the failed call
  });
  it('cuts the periods by date', () => {
    const by = Object.fromEntries(s.periods.map((p) => [p.key, p.line.calls]));
    expect(by).toEqual({ today: 4, last7: 4, last30: 5, month: 5, all: 6 });
  });
  it('lists days newest first, and by purpose and model with the dearest first', () => {
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-10-27', '2026-10-20', '2026-09-02']);
    expect(s.byDay[0]!.calls).toBe(4);
    expect(s.byPurpose[0]!.key).toBe('rates_refresh');
    expect(s.byModel[0]!.model).toBe('claude-haiku-5-5');
  });
  it('reports how much came from the cache and what that saved', () => {
    expect(s.cache.readTokens).toBe(4000);
    expect(s.cache.hitRate).toBeCloseTo(
      4000 / (9000 + 800 + 300 + 4000 + 10_000 + 10_000 + 500),
      6,
    );
    expect(s.cache.savedUsd).toBeCloseTo((4000 * (0.1 - 0.01)) / 1e6, 12);
  });
  it('keeps only the most recent calls, newest first', () => {
    const small = summariseUsage(rows, prices, '2026-10-27', { recent: 2 });
    expect(small.recent.map((r) => r.at)).toEqual(['2026-10-27T05:00:00Z', '2026-10-27T04:00:00Z']);
  });
  it('is empty and calm with no calls', () => {
    const e = summariseUsage([], prices, '2026-10-27');
    expect(e.totals.calls).toBe(0);
    expect(e.cache.hitRate).toBeNull();
    expect(e.byDay).toEqual([]);
  });
});

describe('formatting', () => {
  it('shows tiny amounts with enough digits', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.00123)).toBe('$0.0012');
    expect(formatUsd(1.234)).toBe('$1.23');
    expect(formatInrSmall(0.5)).toBe('₹0.50');
    expect(formatInrSmall(1234.5)).toBe('₹1,235');
  });
});
