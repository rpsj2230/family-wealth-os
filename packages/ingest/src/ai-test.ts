/**
 * The AI connection test: is a key saved, does the provider answer, and is a made-up bank alert read back correctly?
 * Used by the Settings button and by the self-test job. Pure apart from the network calls it makes; it returns plain steps
 * and never includes the key.
 */
import { aiErrorHint, probeModels } from './ai-models';
import { prepareAi, type AiLimits } from './ai-runtime';
import { buildAiRequest, parseAiResponse, type AiProvider } from './bank-email';

export interface AiTestStep {
  ok: boolean;
  text: string;
}

export interface AiTestResult {
  ok: boolean;
  provider: AiProvider;
  /** the model that answered the test question */
  model: string | null;
  steps: AiTestStep[];
  ms: number;
}

export const PROVIDER_NAME: Record<AiProvider, string> = {
  openrouter: 'OpenRouter (free models)',
  groq: 'Groq',
  gemini: 'Google Gemini',
};

export async function testAiConnection(args: {
  provider: AiProvider;
  key: string;
  today: string;
  limits?: AiLimits;
}): Promise<AiTestResult> {
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
  const rt = await prepareAi(args.provider, args.key, args.limits);
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
      (u, i) => fetch(u, { ...i, signal: AbortSignal.timeout(args.limits?.listMs ?? 20_000) }),
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

  const alert = `Dear Customer, your Sample Bank account XXXXXX4321 has been credited with INR 25,000.00 on ${args.today}. Available balance in your account is INR 1,23,456.78 as on ${args.today}.`;
  const req = buildAiRequest(args.provider, args.key, alert, rt.model ?? undefined);
  let res;
  try {
    res = await rt.call(req.url, req.init as unknown as Record<string, unknown>);
  } catch (e) {
    steps.push({ ok: false, text: `The AI service did not answer (${(e as Error).message}).` });
    return done(false, null);
  }
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 300);
    steps.push({
      ok: false,
      text: `The AI service answered ${res.status}: ${body} ${aiErrorHint(args.provider, res.status, body) ?? ''}`.trim(),
    });
    return done(false, null);
  }
  const model = res.model ?? rt.model;
  const r = parseAiResponse(args.provider, await res.json(), { today: args.today })[0];
  if (r && Math.abs(r.amount - 123456.78) < 0.01 && r.last4 === '4321') {
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
