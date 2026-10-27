import { describe, expect, it } from 'vitest';
import {
  answeredBy,
  callAi,
  classifyFailure,
  createAiChain,
  explainFailure,
  NO_KEYS_REASON,
  orderedEnabled,
  scrubKey,
  type AiKeyEntry,
  type AiUse,
} from '../src/ai-chain';
import { buildAiChat, type AiProvider } from '../src/bank-email';
import {
  chatReply,
  claudeReply,
  failure,
  fakeAiFetch,
  type FakeCall,
  type FakeReply,
} from './fake-ai';

const ANT = { provider: 'anthropic', key: 'sk-ant-SECRET-111' } satisfies AiKeyEntry;
const OPR = { provider: 'openrouter', key: 'sk-or-SECRET-222' } satisfies AiKeyEntry;
const GRQ = { provider: 'groq', key: 'gsk_SECRET_333' } satisfies AiKeyEntry;
const GEM = { provider: 'gemini', key: 'AIza_SECRET_444' } satisfies AiKeyEntry;

/** The expected answer is a JSON object {"v": number}; the value is the number. */
const spec = {
  build: (provider: AiProvider, key: string, model: string | undefined) =>
    buildAiChat(provider, key, 'Reply with JSON.', 'text', model),
  parse: (_provider: AiProvider, json: unknown) => {
    const j = json as {
      choices?: { message?: { content?: string } }[];
      content?: { text?: string }[];
    };
    const text = j.choices?.[0]?.message?.content ?? j.content?.[0]?.text ?? '';
    try {
      const v = (JSON.parse(text) as { v?: unknown }).v;
      return typeof v === 'number' ? v : null;
    } catch {
      return null;
    }
  },
};

const good = (v = 7): FakeReply => chatReply(JSON.stringify({ v }));
const goodClaude = (v = 7): FakeReply => claudeReply(JSON.stringify({ v }));
const answer = (c: FakeCall, replies: Partial<Record<FakeCall['provider'], FakeReply>>) =>
  c.body === null ? undefined : replies[c.provider];

describe('callAi: order and fail-over', () => {
  it('a single key behaves as before: one question, its answer, nothing failed', async () => {
    const fake = fakeAiFetch((c) => answer(c, { groq: good(5) }));
    const uses: AiUse[] = [];
    const chain = createAiChain([GRQ], { fetch: fake.fetch, record: (u) => void uses.push(u) });
    const r = await callAi(chain, spec);
    expect(r).toMatchObject({ ok: true, value: 5, provider: 'groq', attempts: [] });
    expect(fake.chatCalls()).toHaveLength(1);
    expect(uses).toEqual([{ provider: 'groq', ok: true, status: 200, model: null, reason: null }]);
  });

  it('asks the first key first, and stops at the first usable answer', async () => {
    const fake = fakeAiFetch((c) => answer(c, { anthropic: goodClaude(1), groq: good(2) }));
    const chain = createAiChain([ANT, GRQ, GEM], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r).toMatchObject({ ok: true, value: 1, provider: 'anthropic' });
    expect(fake.chatCalls().map((c) => c.provider)).toEqual(['anthropic']);
  });

  it('goes to the next key in order when one fails, and reports who answered and what failed', async () => {
    const fake = fakeAiFetch((c) =>
      answer(c, { anthropic: failure(500), openrouter: failure(429), groq: good(3) }),
    );
    const chain = createAiChain([ANT, OPR, GRQ, GEM], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.provider).toBe('groq');
    expect(r.value).toBe(3);
    expect(r.attempts.map((a) => [a.provider, a.status])).toEqual([
      ['anthropic', 500],
      ['openrouter', 429],
    ]);
    expect(fake.chatCalls().map((c) => c.provider)).toEqual(['anthropic', 'openrouter', 'groq']);
    expect(answeredBy(r)).toBe(
      'Groq answered after Anthropic answered 500 (the service is having trouble); OpenRouter answered 429 (busy, or its limit is used up for now)',
    );
  });

  it('names the model that answered', async () => {
    const fake = fakeAiFetch((c) => {
      if (c.url.endsWith('/openai/v1/models'))
        return { json: { data: [{ id: 'llama-3.3-70b-versatile' }] } };
      return answer(c, { groq: good() });
    });
    const chain = createAiChain([GRQ], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r).toMatchObject({ ok: true, model: 'llama-3.3-70b-versatile' });
  });

  it('keeps the model fallback inside a provider: a second OpenRouter model answers without the next key being asked', async () => {
    const fake = fakeAiFetch((c) => {
      if (c.url.endsWith('/api/v1/models'))
        return {
          json: {
            data: ['meta-llama/llama-3.3-70b-instruct:free', 'openai/gpt-oss-120b:free'].map(
              (id) => ({
                id,
                pricing: { prompt: '0', completion: '0' },
              }),
            ),
          },
        };
      if (c.provider === 'openrouter')
        return c.model === 'meta-llama/llama-3.3-70b-instruct:free' ? failure(429) : good(9);
      return good(1);
    });
    const chain = createAiChain([OPR, GRQ], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r).toMatchObject({
      ok: true,
      value: 9,
      provider: 'openrouter',
      model: 'openai/gpt-oss-120b:free',
      attempts: [],
    });
    expect(fake.chatCalls().some((c) => c.provider === 'groq')).toBe(false);
  });
});

describe('callAi: what counts as a failure', () => {
  it('goes on after a timeout or a network error (no answer at all)', async () => {
    const slow = Object.assign(new Error('The operation was aborted due to timeout'), {
      name: 'TimeoutError',
    });
    const fake = fakeAiFetch((c) => {
      if (c.body === null) return undefined;
      if (c.provider === 'anthropic') return { throws: slow };
      if (c.provider === 'openrouter') return { throws: new Error('fetch failed') };
      return good(4);
    });
    const chain = createAiChain([ANT, OPR, GRQ], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r).toMatchObject({ ok: true, provider: 'groq' });
    if (!r.ok) return;
    expect(r.attempts.map((a) => [a.status, a.keyLevel])).toEqual([
      [0, false],
      [0, false],
    ]);
    expect(r.attempts[0]!.reason).toContain('did not answer in time');
    expect(r.attempts[1]!.reason).toContain('could not be reached');
  });

  it('goes on when the answer cannot be read as the expected JSON, and when the caller finds it unusable', async () => {
    const fake = fakeAiFetch((c) =>
      answer(c, {
        anthropic: claudeReply('I am sorry, I cannot help with that.'),
        openrouter: good(0),
        groq: good(8),
      }),
    );
    const chain = createAiChain([ANT, OPR, GRQ], { fetch: fake.fetch });
    const picky = {
      ...spec,
      parse: (p: AiProvider, j: unknown) => ((spec.parse(p, j) ?? 0) > 0 ? spec.parse(p, j) : null),
    };
    const r = await callAi(chain, picky);
    expect(r).toMatchObject({ ok: true, value: 8, provider: 'groq' });
    if (!r.ok) return;
    expect(r.attempts.map((a) => [a.provider, a.status])).toEqual([
      ['anthropic', 200],
      ['openrouter', 200],
    ]);
    expect(r.attempts[0]!.reason).toContain('nothing usable');
  });

  it('treats a parse that throws, or an answer that is not JSON at all, as unusable', async () => {
    const fake = fakeAiFetch((c) =>
      c.body === null
        ? undefined
        : c.provider === 'anthropic'
          ? { text: '<html>oops</html>' }
          : good(2),
    );
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
    const r = await callAi(chain, {
      ...spec,
      parse: (p, j) => {
        if (p === 'anthropic') throw new Error('unexpected shape');
        return spec.parse(p, j);
      },
    });
    expect(r).toMatchObject({ ok: true, provider: 'groq' });
  });
});

describe('callAi: remembering within a run', () => {
  it('does not ask a key whose key-level failure it has seen, for the rest of the run', async () => {
    for (const refusal of [failure(401), failure(402), failure(403)]) {
      const fake = fakeAiFetch((c) => answer(c, { anthropic: refusal, groq: good() }));
      const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
      const first = await callAi(chain, spec);
      const second = await callAi(chain, spec);
      const third = await callAi(chain, spec);
      expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
      expect(fake.chatCalls().filter((c) => c.provider === 'anthropic')).toHaveLength(1);
      expect(fake.chatCalls().filter((c) => c.provider === 'groq')).toHaveLength(3);
      if (second.ok) {
        expect(second.attempts).toHaveLength(1);
        expect(second.attempts[0]).toMatchObject({ provider: 'anthropic', skipped: true });
      }
    }
  });

  it('treats "no credit" in the body as key-level even when the status is a plain 400', async () => {
    const fake = fakeAiFetch((c) =>
      answer(c, {
        anthropic: failure(400, 'Your credit balance is too low to access the Anthropic API.'),
        groq: good(),
      }),
    );
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
    await callAi(chain, spec);
    const r = await callAi(chain, spec);
    expect(fake.chatCalls().filter((c) => c.provider === 'anthropic')).toHaveLength(1);
    if (r.ok) expect(r.attempts[0]).toMatchObject({ skipped: true });
  });

  it('retries a busy or slow key on the next item', async () => {
    let n = 0;
    const fake = fakeAiFetch((c) => {
      if (c.body === null) return undefined;
      if (c.provider === 'anthropic') return n++ === 0 ? failure(429) : goodClaude(6);
      return good(2);
    });
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
    const first = await callAi(chain, spec);
    const second = await callAi(chain, spec);
    expect(first).toMatchObject({ ok: true, provider: 'groq' });
    expect(second).toMatchObject({ ok: true, provider: 'anthropic', value: 6 });
  });

  it('leaves a service out after several busy answers in a row, and forgives it after one good answer', async () => {
    let busy = true;
    const fake = fakeAiFetch((c) => {
      if (c.body === null) return undefined;
      if (c.provider === 'anthropic') return busy ? failure(503) : goodClaude(6);
      return good(2);
    });
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch, strikes: 3 });
    for (let i = 0; i < 5; i++) await callAi(chain, spec);
    // asked three times, then left out
    expect(fake.chatCalls().filter((c) => c.provider === 'anthropic')).toHaveLength(3);
    const skipped = await callAi(chain, spec);
    if (skipped.ok) expect(skipped.attempts[0]!.reason).toContain('failed 3 times in a row');

    // a good answer resets the count
    busy = false;
    const chain2 = createAiChain([ANT, GRQ], { fetch: fake.fetch, strikes: 2 });
    busy = true;
    await callAi(chain2, spec);
    busy = false;
    await callAi(chain2, spec);
    busy = true;
    await callAi(chain2, spec);
    const r = await callAi(chain2, spec);
    expect(r.ok && r.attempts[0]?.skipped).toBeFalsy();
  });

  it('does not count an answer with nothing usable as trouble with the service', async () => {
    const fake = fakeAiFetch((c) => answer(c, { anthropic: claudeReply('no json'), groq: good() }));
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch, strikes: 1 });
    await callAi(chain, spec);
    await callAi(chain, spec);
    expect(fake.chatCalls().filter((c) => c.provider === 'anthropic')).toHaveLength(2);
  });
});

describe('callAi: when nothing answers', () => {
  it('says there is no key to ask when the chain is empty, and asks nothing', async () => {
    const fake = fakeAiFetch(() => undefined);
    const r = await callAi(createAiChain([], { fetch: fake.fetch }), spec);
    expect(r).toMatchObject({ ok: false, noKeys: true, reason: NO_KEYS_REASON, attempts: [] });
    expect(fake.calls).toHaveLength(0);
  });

  it('returns every key’s reason in plain words, with the way out', async () => {
    const fake = fakeAiFetch((c) =>
      answer(c, {
        anthropic: failure(401, 'invalid x-api-key'),
        groq: failure(429, 'rate limited'),
      }),
    );
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.noKeys).toBe(false);
    expect(r.attempts).toHaveLength(2);
    expect(r.reason).toContain('None of the 2 AI keys could answer.');
    expect(r.reason).toContain(
      '1. Anthropic (Claude Haiku): Anthropic refused the key. Create a key at console.anthropic.com',
    );
    expect(r.reason).toContain('2. Groq: The free quota is used up for now');
    expect(r.reason).toContain('Open Settings > Connections');
    expect(r.brief).toBe(
      'Anthropic answered 401 (the key was refused); Groq answered 429 (busy, or its limit is used up for now)',
    );
  });

  it('words a single failing key without counting', async () => {
    const fake = fakeAiFetch((c) => answer(c, { gemini: failure(500) }));
    const r = await callAi(createAiChain([GEM], { fetch: fake.fetch }), spec);
    if (r.ok) throw new Error('should fail');
    expect(r.reason.startsWith('The AI key could not answer. Google Gemini: ')).toBe(true);
    expect(explainFailure(r.attempts)).toBe(r.reason);
  });

  it('lists the skipped keys when every key was refused earlier', async () => {
    const fake = fakeAiFetch((c) => answer(c, { anthropic: failure(401), groq: failure(402) }));
    const chain = createAiChain([ANT, GRQ], { fetch: fake.fetch });
    await callAi(chain, spec);
    const r = await callAi(chain, spec);
    if (r.ok) throw new Error('should fail');
    expect(r.attempts.every((a) => a.skipped)).toBe(true);
    expect(r.reason).toContain('was skipped');
    expect(fake.chatCalls()).toHaveLength(2);
  });

  it('never puts a key in a result, a reason or a detail, even when the service or the network echoes it', async () => {
    const fake = fakeAiFetch((c) => {
      if (c.body === null) return undefined;
      if (c.provider === 'anthropic')
        return failure(401, `invalid x-api-key: ${ANT.key} and again ${ANT.key}`);
      if (c.provider === 'openrouter')
        return { throws: new Error(`connect failed https://x.test/v1?key=${OPR.key}&a=1`) };
      return failure(500, `server said key=${GEM.key}`);
    });
    const chain = createAiChain([ANT, OPR, GEM], { fetch: fake.fetch });
    const r = await callAi(chain, spec);
    const dump = JSON.stringify(r);
    for (const k of [ANT.key, OPR.key, GEM.key]) expect(dump).not.toContain(k);
    expect(dump).toContain('[key]');
  });
});

describe('callAi: recording', () => {
  it('records every real use with the plain reason, and nothing for a skipped key', async () => {
    const fake = fakeAiFetch((c) => answer(c, { anthropic: failure(401), groq: good() }));
    const uses: AiUse[] = [];
    const chain = createAiChain([ANT, GRQ], {
      fetch: fake.fetch,
      record: (u) => void uses.push(u),
    });
    await callAi(chain, spec);
    await callAi(chain, spec);
    expect(uses.map((u) => [u.provider, u.ok, u.status])).toEqual([
      ['anthropic', false, 401],
      ['groq', true, 200],
      ['groq', true, 200],
    ]);
    expect(uses[0]!.reason).toBe('Anthropic answered 401 (the key was refused)');
  });

  it('a recorder that fails never stops the reading', async () => {
    const fake = fakeAiFetch((c) => answer(c, { groq: good(3) }));
    const chain = createAiChain([GRQ], {
      fetch: fake.fetch,
      record: async () => {
        throw new Error('database down');
      },
    });
    expect(await callAi(chain, spec)).toMatchObject({ ok: true, value: 3 });
  });
});

describe('orderedEnabled', () => {
  const row = (provider: AiProvider, priority: number, enabled: boolean) => ({
    provider,
    key: `k-${provider}`,
    priority,
    enabled,
  });
  it('sorts by priority and leaves out the keys that are switched off', () => {
    expect(
      orderedEnabled([
        row('groq', 3, true),
        row('anthropic', 1, false),
        row('gemini', 2, true),
        row('openrouter', 4, true),
      ]).map((k) => k.provider),
    ).toEqual(['gemini', 'groq', 'openrouter']);
  });
  it('returns nothing when every key is off', () => {
    expect(orderedEnabled([row('groq', 1, false)])).toEqual([]);
  });
  it('keeps the given order for equal priorities', () => {
    expect(
      orderedEnabled([row('groq', 1, true), row('gemini', 1, true)]).map((k) => k.provider),
    ).toEqual(['groq', 'gemini']);
  });
});

describe('classifyFailure', () => {
  const cases: [number, string, boolean][] = [
    [401, '', true],
    [402, '', true],
    [403, '', true],
    [403, 'Every free model tried failed (a: 403; b: 403).', false],
    [400, 'Your credit balance is too low', true],
    [400, 'API key not valid. Please pass a valid API key.', true],
    [429, 'You exceeded your current quota, please check your plan and billing details', false],
    [429, '', false],
    [500, '', false],
    [503, 'insufficient capacity', false],
    [404, 'model not found', false],
    [400, 'bad request', false],
    [0, '', false],
  ];
  it.each(cases)('status %i %j is key-level: %s', (status, body, keyLevel) => {
    expect(classifyFailure(status, body).keyLevel).toBe(keyLevel);
  });
  it('names a missing credit as such', () => {
    expect(classifyFailure(402, '').what).toBe('no credit left');
    expect(classifyFailure(400, 'Your credit balance is too low').what).toBe('no credit left');
    expect(classifyFailure(401, 'credit').what).toBe('the key was refused');
  });
});

describe('scrubKey', () => {
  it('removes the key and key= parameters', () => {
    expect(scrubKey('bad abcd1234xyz here', 'abcd1234xyz')).toBe('bad [key] here');
    expect(scrubKey('GET /v1/models?pageSize=2&key=SECRET&x=1', 'other-key')).toBe(
      'GET /v1/models?pageSize=2&key=[key]&x=1',
    );
  });
  it('leaves text alone when the key is too short to be a key', () => {
    expect(scrubKey('abc', 'abc')).toBe('abc');
  });
});
