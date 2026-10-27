/**
 * The AI connection tests: is a key saved, does the provider answer, and is a made-up bank alert read back correctly?
 * `testAiConnection` tests one key on its own; `testAiChain` asks the keys in their order, exactly as the jobs do, and says which
 * one answers. Used by the Settings buttons and by the self-test job. Pure apart from the network calls it makes (through the
 * injected `fetch`); both return plain steps and never include a key.
 */
import { callAi, scrubKey, type AiAttempt, type AiChain } from './ai-chain';
import { aiErrorHint, probeModels, realFetch, type AiFetch } from './ai-models';
import { PROVIDER_NAME } from './ai-providers';
import { prepareAi, type AiLimits } from './ai-runtime';
import {
  buildAiRequest,
  parseAiResponse,
  type AiProvider,
  type BalanceReading,
} from './bank-email';

export interface AiTestStep {
  ok: boolean;
  text: string;
  /** not a result: a key that was not needed */
  neutral?: boolean;
}

export interface AiTestResult {
  ok: boolean;
  provider: AiProvider;
  /** the model that answered the test question */
  model: string | null;
  steps: AiTestStep[];
  ms: number;
}

/** The made-up alert both tests send. The balance and the last four digits are what the answer must read back. */
const testAlert = (today: string) =>
  `Dear Customer, your Sample Bank account XXXXXX4321 has been credited with INR 25,000.00 on ${today}. Available balance in your account is INR 1,23,456.78 as on ${today}.`;

const readBackRight = (r: BalanceReading | undefined): boolean =>
  !!r && Math.abs(r.amount - 123456.78) < 0.01 && r.last4 === '4321';

export async function testAiConnection(args: {
  provider: AiProvider;
  key: string;
  today: string;
  limits?: AiLimits;
  fetch?: AiFetch;
}): Promise<AiTestResult> {
  const f = args.fetch ?? realFetch;
  const t0 = Date.now();
  const steps: AiTestStep[] = [];
  const done = (ok: boolean, model: string | null): AiTestResult => ({
    ok,
    provider: args.provider,
    model,
    steps,
    ms: Date.now() - t0,
  });
  steps.push({ ok: true, text: `A ${PROVIDER_NAME[args.provider]} key is saved.` });
  const rt = await prepareAi(args.provider, args.key, args.limits, f);
  if (args.provider === 'openrouter') {
    if (rt.models.length === 0) {
      steps.push({
        ok: false,
        text: 'OpenRouter listed no free model for this key. Check the key at openrouter.ai/keys.',
      });
      return done(false, null);
    }
    steps.push({
      ok: true,
      text: `${rt.models.length} free models are available; they are tried in this order: ${rt.models.slice(0, 4).join(', ')}${rt.models.length > 4 ? ', …' : ''}.`,
    });
  } else if (!rt.model) {
    const probes = await probeModels(
      (u, i) => f(u, { ...i, signal: AbortSignal.timeout(args.limits?.listMs ?? 20_000) }),
      args.provider,
      args.key,
      3,
    );
    const first = probes.find((p) => p.status !== 404) ?? probes[0];
    steps.push({
      ok: false,
      text: `No model answered with this key${first ? ` (${first.status})` : ''}. ${first ? (aiErrorHint(args.provider, first.status, first.note) ?? first.note) : ''}`.trim(),
    });
    return done(false, null);
  } else steps.push({ ok: true, text: `The key works; the model is ${rt.model}.` });

  const req = buildAiRequest(args.provider, args.key, testAlert(args.today), rt.model ?? undefined);
  let res;
  try {
    res = await rt.call(req.url, req.init as unknown as Record<string, unknown>);
  } catch (e) {
    steps.push({
      ok: false,
      text: `The AI service did not answer (${scrubKey((e as Error).message, args.key)}).`,
    });
    return done(false, null);
  }
  if (!res.ok) {
    const body = scrubKey(
      (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300),
      args.key,
    );
    steps.push({
      ok: false,
      text: `The AI service answered ${res.status}: ${body} ${aiErrorHint(args.provider, res.status, body) ?? ''}`.trim(),
    });
    return done(false, null);
  }
  const model = res.model ?? rt.model;
  const r = parseAiResponse(args.provider, await res.json(), { today: args.today })[0];
  if (r && readBackRight(r)) {
    steps.push({
      ok: true,
      text: `A made-up bank alert was read back correctly (balance ${r.amount.toLocaleString('en-IN')}, account ending ${r.last4})${model ? ` by ${model}` : ''}.`,
    });
    return done(true, model);
  }
  steps.push({
    ok: false,
    text: r
      ? `The alert was read wrongly (balance ${r.amount}, account ending ${r.last4}).`
      : 'The AI answered, but no balance could be understood from its reply.',
  });
  return done(false, model);
}

export interface AiChainTest {
  /** some key read the made-up alert back correctly */
  ok: boolean;
  /** the key that answered, in the order the jobs use */
  provider: AiProvider | null;
  model: string | null;
  /** one line per key, in order */
  steps: AiTestStep[];
  attempts: AiAttempt[];
  ms: number;
}

/**
 * The whole chain: the keys that are switched on are asked in their order with the made-up alert, exactly as a job would ask them, and
 * the first one that reads it back correctly answers. Keys after it are not asked (a job would not ask them either); keys before it
 * say why they failed.
 */
export async function testAiChain(chain: AiChain, today: string): Promise<AiChainTest> {
  const t0 = Date.now();
  const res = await callAi(chain, {
    purpose: 'ai_test',
    build: (provider, key, model) => buildAiRequest(provider, key, testAlert(today), model),
    parse: (provider, json) => {
      const r = parseAiResponse(provider, json, { today })[0];
      return r !== undefined && readBackRight(r) ? r : null;
    },
  });
  const steps: AiTestStep[] = [];
  const line = (n: number, provider: AiProvider, text: string) =>
    `${n}. ${PROVIDER_NAME[provider]}: ${text}`;
  res.attempts.forEach((a, i) =>
    steps.push({ ok: false, text: line(i + 1, a.provider, a.reason) }),
  );
  if (res.ok) {
    const n = res.attempts.length + 1;
    steps.push({
      ok: true,
      text: line(
        n,
        res.provider,
        `answered; the made-up alert was read back correctly${res.model ? ` by ${res.model}` : ''}.`,
      ),
    });
    chain.keys.slice(n).forEach((k, i) =>
      steps.push({
        ok: true,
        neutral: true,
        text: line(
          n + 1 + i,
          k.provider,
          'not asked: an earlier key answered. Use its own Test button to try it.',
        ),
      }),
    );
  } else if (res.noKeys) steps.push({ ok: false, text: res.reason });
  return {
    ok: res.ok,
    provider: res.ok ? res.provider : null,
    model: res.ok ? res.model : null,
    steps,
    attempts: res.attempts,
    ms: Date.now() - t0,
  };
}
