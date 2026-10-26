/**
 * The AI link used by every job: which model to ask and how to call it. For OpenRouter's free models the call itself falls
 * back from one model to the next; for the other providers one working model is found first (see @fwos/ingest `ai-models`).
 */
import type { AiProvider } from './bank-email';
import { modelsRequest, rankModels, resolveWorkingModel, withModelFallback } from './ai-models';

type Init = Record<string, unknown> | undefined;
const timed = (ms: number) => (u: string, init?: Init) =>
  fetch(u, { ...init, signal: AbortSignal.timeout(ms) } as RequestInit);

export interface AiLimits {
  /** milliseconds allowed for reading the model list */
  listMs?: number;
  /** milliseconds allowed for each question */
  callMs?: number;
  /** most free models tried for one question */
  tries?: number;
}

export interface AiRuntime {
  /** the first model to ask (null: the provider's list could not be read, the built-in default is used) */
  model: string | null;
  /** all candidates in order, for messages */
  models: string[];
  /** a call that returns a JSON-bearing answer, falling back across models where the provider allows it */
  call: ReturnType<typeof withModelFallback>;
}

export async function prepareAi(
  provider: AiProvider,
  key: string,
  limits: AiLimits = {},
): Promise<AiRuntime> {
  const listMs = limits.listMs ?? 20_000;
  const callMs = limits.callMs ?? 60_000;
  if (provider === 'openrouter') {
    let models: string[] = [];
    try {
      const req = modelsRequest(provider, key);
      const res = await timed(listMs)(req.url, req.init as unknown as Init);
      if (res.ok) models = rankModels(provider, await res.json());
    } catch {
      // the built-in default model is used
    }
    return {
      model: models[0] ?? null,
      models,
      call: withModelFallback(timed(callMs), provider, models, { maxTries: limits.tries ?? 6 }),
    };
  }
  const model = await resolveWorkingModel((u, i) => timed(listMs)(u, i as Init), provider, key);
  return {
    model,
    models: model ? [model] : [],
    call: withModelFallback(timed(callMs), provider, []),
  };
}
