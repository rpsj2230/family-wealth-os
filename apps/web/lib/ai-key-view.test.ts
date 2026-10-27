import { describe, expect, it } from 'vitest';
import { AI_PROVIDERS } from '@fwos/ingest/src/ai-providers';
import {
  inOrder,
  moveKey,
  renumbered,
  roleOf,
  summaryPill,
  testStatus,
  unusedProviders,
  usageStatus,
  type AiKeyRow,
} from './ai-key-view';
import { DEMO_AI_KEYS, demoTestChain, demoTestKey } from './demo-ai-keys';

const row = (over: Partial<AiKeyRow> & Pick<AiKeyRow, 'provider' | 'priority'>): AiKeyRow => ({
  enabled: true,
  label: null,
  lastOkAt: null,
  lastModel: null,
  lastErrorAt: null,
  lastErrorStatus: null,
  lastError: null,
  testedAt: null,
  testOk: null,
  testNote: null,
  ...over,
});
const three = [
  row({ provider: 'groq', priority: 3 }),
  row({ provider: 'anthropic', priority: 1 }),
  row({ provider: 'openrouter', priority: 2 }),
];
const order = (keys: AiKeyRow[]) => inOrder(keys).map((k) => k.provider);

describe('roleOf', () => {
  it('calls the first key that is on the first choice and counts fallbacks among the keys that are on', () => {
    const keys = [
      row({ provider: 'anthropic', priority: 1, enabled: false }),
      row({ provider: 'openrouter', priority: 2 }),
      row({ provider: 'groq', priority: 3 }),
      row({ provider: 'gemini', priority: 4 }),
    ];
    const r = roleOf(keys);
    expect(r.get('anthropic')).toBe('Switched off');
    expect(r.get('openrouter')).toBe('First choice');
    expect(r.get('groq')).toBe('Fallback 2');
    expect(r.get('gemini')).toBe('Fallback 3');
  });
});

describe('moveKey', () => {
  it('swaps with the neighbour and keeps priorities 1..n', () => {
    const up = moveKey(three, 'openrouter', 'up');
    expect(order(up)).toEqual(['openrouter', 'anthropic', 'groq']);
    expect(up.map((k) => k.priority).sort()).toEqual([1, 2, 3]);
    expect(order(moveKey(three, 'anthropic', 'down'))).toEqual(['openrouter', 'anthropic', 'groq']);
  });
  it('does nothing at either end or for a service that has no key', () => {
    expect(order(moveKey(three, 'anthropic', 'up'))).toEqual(['anthropic', 'openrouter', 'groq']);
    expect(order(moveKey(three, 'groq', 'down'))).toEqual(['anthropic', 'openrouter', 'groq']);
    expect(order(moveKey(three, 'gemini', 'up'))).toEqual(['anthropic', 'openrouter', 'groq']);
  });
  it('moves a switched-off key like any other', () => {
    const keys = three.map((k) => (k.provider === 'openrouter' ? { ...k, enabled: false } : k));
    expect(order(moveKey(keys, 'groq', 'up'))).toEqual(['anthropic', 'groq', 'openrouter']);
  });
});

describe('renumbered and unusedProviders', () => {
  it('closes gaps', () => {
    const r = renumbered([
      row({ provider: 'groq', priority: 7 }),
      row({ provider: 'gemini', priority: 9 }),
    ]);
    expect(r.map((k) => [k.provider, k.priority])).toEqual([
      ['groq', 1],
      ['gemini', 2],
    ]);
  });
  it('offers only the services without a key, in the usual order', () => {
    expect(unusedProviders(AI_PROVIDERS, three)).toEqual(['gemini']);
    expect(unusedProviders(AI_PROVIDERS, [])).toEqual([
      'anthropic',
      'openrouter',
      'groq',
      'gemini',
    ]);
  });
});

describe('usageStatus', () => {
  it('says a key was not used yet', () => {
    expect(usageStatus(row({ provider: 'groq', priority: 1 }))).toEqual({
      tone: 'idle',
      text: 'Not used yet',
    });
  });
  it('shows the newer of the last success and the last failure', () => {
    const base = row({
      provider: 'groq',
      priority: 1,
      lastOkAt: '2026-10-26T01:00:00Z',
      lastModel: 'llama-3.3-70b-versatile',
      lastErrorAt: '2026-10-25T01:00:00Z',
      lastError: 'Groq answered 429 (busy)',
    });
    expect(usageStatus(base)).toEqual({
      tone: 'ok',
      text: 'Last used OK 26 Oct 2026, 09:00 with llama-3.3-70b-versatile',
    });
    const failed = { ...base, lastErrorAt: '2026-10-27T01:00:00Z' };
    expect(usageStatus(failed)).toEqual({
      tone: 'bad',
      text: 'Last failed 27 Oct 2026, 09:00: Groq answered 429 (busy)',
    });
  });
  it('falls back to the status code when no reason was kept', () => {
    const s = usageStatus(
      row({
        provider: 'groq',
        priority: 1,
        lastErrorAt: '2026-10-27T01:00:00Z',
        lastErrorStatus: 0,
      }),
    );
    expect(s.text).toBe('Last failed 27 Oct 2026, 09:00: status 0');
  });
});

describe('testStatus and summaryPill', () => {
  it('reports the last test, or nothing', () => {
    expect(testStatus(row({ provider: 'groq', priority: 1 }))).toBeNull();
    expect(
      testStatus(
        row({
          provider: 'groq',
          priority: 1,
          testedAt: '2026-10-26T01:00:00Z',
          testOk: false,
          testNote: 'refused',
        }),
      ),
    ).toEqual({ tone: 'bad', text: 'Last test 26 Oct 2026, 09:00: not working (refused)' });
  });
  it('counts the keys that are on, and warns when there are none', () => {
    expect(summaryPill([])).toEqual({ tone: 'warn', text: 'No AI key' });
    expect(summaryPill(three.map((k) => ({ ...k, enabled: false })))).toEqual({
      tone: 'warn',
      text: 'All AI keys switched off',
    });
    expect(summaryPill(three)).toEqual({ tone: 'ok', text: '3 AI keys on' });
    expect(summaryPill([three[0]!])).toEqual({ tone: 'ok', text: '1 AI key on' });
  });
});

describe('the public sample', () => {
  it('shows a fail-over: the first choice is out of credit and the second answers', () => {
    const chain = demoTestChain(DEMO_AI_KEYS);
    expect(chain.ok).toBe(true);
    expect(chain.answeredBy).toBe('openrouter');
    expect(chain.steps.map((s) => [s.ok, s.neutral ?? false])).toEqual([
      [false, false],
      [true, false],
    ]);
  });
  it('asks the keys in the order they are in now, and says so when none is on', () => {
    const swapped = moveKey(DEMO_AI_KEYS, 'openrouter', 'up');
    const c = demoTestChain(swapped);
    expect(c.answeredBy).toBe('openrouter');
    expect(c.steps[1]!.neutral).toBe(true);
    const none = demoTestChain(DEMO_AI_KEYS.map((k) => ({ ...k, enabled: false })));
    expect(none).toMatchObject({ ok: false, answeredBy: null });
  });
  it('tests one key on its own, switched on or not', () => {
    expect(demoTestKey('anthropic').ok).toBe(false);
    expect(demoTestKey('groq')).toMatchObject({ ok: true, provider: 'groq' });
  });
  it('carries no secret', () => {
    expect(JSON.stringify(DEMO_AI_KEYS)).not.toMatch(/sk-|gsk_|AIza/);
  });
});
