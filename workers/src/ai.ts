/**
 * The AI link used by every job: which model to ask and how to call it. For OpenRouter's free models the call itself falls
 * back from one model to the next; for the other providers one working model is found first (see @fwos/ingest `ai-models`).
 */
import {
  modelsRequest,
  rankModels,
  resolveWorkingModel,
  withModelFallback,
  type AiProvider,
} from '@fwos/ingest';

type Init = Record<string, unknown> | undefined;
const timed = (ms: number) => (u: string, init?: Init) =>
  fetch(u, { ...init, signal: AbortSignal.timeout(ms) } as RequestInit);

export interface AiRuntime {
  /** the first model to ask (null: the provider's list could not be read, the built-in default is used) */
  model: string | null;
  /** all candidates in order, for messages */
  models: string[];
  /** a call that returns a JSON-bearing answer, falling back across models where the provider allows it */
  call: ReturnType<typeof withModelFallback>;
}

export async function prepareAi(provider: AiProvider, key: string): Promise<AiRuntime> {
  if (provider === 'openrouter') {
    let models: string[] = [];
    try {
      const req = modelsRequest(provider, key);
      const res = await timed(20_000)(req.url, req.init as unknown as Init);
      if (res.ok) models = rankModels(provider, await res.json());
    } catch {
      // the built-in default model is used
    }
    return {
      model: models[0] ?? null,
      models,
      call: withModelFallback(timed(60_000), provider, models, { maxTries: 6 }),
    };
  }
  const model = await resolveWorkingModel((u, i) => timed(20_000)(u, i as Init), provider, key);
  return {
    model,
    models: model ? [model] : [],
    call: withModelFallback(timed(60_000), provider, []),
  };
}
