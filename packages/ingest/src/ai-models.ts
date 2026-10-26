/**
 * Choosing which model to ask. Providers retire models without warning (a retired name answers 404), so the reader asks the provider
 * which models the key can use and picks the best available one, falling back to a built-in name only when the list cannot be read.
 * Pure: the worker supplies `fetch`.
 */
import { buildAiChat, type AiProvider } from './bank-email';

export interface ModelsHttp {
  url: string;
  init: { method: 'GET'; headers: Record<string, string> };
}

export function modelsRequest(provider: AiProvider, apiKey: string): ModelsHttp {
  return provider === 'groq'
    ? {
        url: 'https://api.groq.com/openai/v1/models',
        init: { method: 'GET', headers: { authorization: `Bearer ${apiKey}` } },
      }
    : {
        url: `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
        init: { method: 'GET', headers: {} },
      };
}

/** Best first. A name matches the first pattern it fits. */
const PREFER: Record<AiProvider, RegExp[]> = {
  groq: [
    /^llama-3\.3-70b/,
    /^openai\/gpt-oss-120b$/,
    /^meta-llama\/llama-4-(maverick|scout)/,
    /^llama-3\.1-70b/,
    /^qwen/,
    /^openai\/gpt-oss-20b$/,
    /^llama-3\.1-8b-instant$/,
    /^llama/,
  ],
  gemini: [
    /^gemini-2\.5-flash$/,
    /^gemini-flash-latest$/,
    /^gemini-2\.5-flash-lite$/,
    /^gemini-2\.0-flash$/,
    /^gemini-2\.0-flash-lite$/,
    /^gemini-.*flash/,
    /^gemini-/,
  ],
};
/** Models that cannot answer a text question with JSON. */
const NOT_CHAT =
  /(whisper|tts|guard|embed|image|audio|live|transcri|moderation|imagen|veo|robotics|computer-use|preview|exp)/i;

function modelNames(provider: AiProvider, listJson: unknown): string[] {
  if (provider === 'groq') {
    const d = (listJson as { data?: { id?: string; active?: boolean }[] } | null)?.data;
    return (d ?? []).filter((m) => m.active !== false).map((m) => String(m.id ?? ''));
  }
  const d = (
    listJson as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null
  )?.models;
  return (d ?? [])
    .filter((m) =>
      (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'),
    )
    .map((m) => String(m.name ?? '').replace(/^models\//, ''));
}

const version = (n: string) => Number(/^gemini-(\d+(?:\.\d+)?)-/.exec(n)?.[1] ?? 0);

/**
 * Usable models, best first. A provider can list a model its key may no longer call (Gemini lists retired models that answer
 * 404 "no longer available to new users"), so the caller tries these in order (see `resolveWorkingModel`).
 */
export function rankModels(provider: AiProvider, listJson: unknown): string[] {
  const usable = modelNames(provider, listJson).filter((n) => n && !NOT_CHAT.test(n));
  const out: string[] = [];
  const add = (n: string) => {
    if (!out.includes(n)) out.push(n);
  };
  if (provider === 'gemini') {
    // newest stable flash first: older ones are the first to be withdrawn from new users
    for (const re of [
      /^gemini-\d+(?:\.\d+)?-flash$/,
      /^gemini-flash-latest$/,
      /^gemini-\d+(?:\.\d+)?-flash-lite$/,
    ])
      usable
        .filter((n) => re.test(n))
        .sort((x, y) => version(y) - version(x))
        .forEach(add);
  }
  for (const re of PREFER[provider]) usable.filter((n) => re.test(n)).forEach(add);
  usable.forEach(add);
  return out;
}

export function pickModel(provider: AiProvider, listJson: unknown): string | null {
  return rankModels(provider, listJson)[0] ?? null;
}

type Fetch = (
  u: string,
  init?: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** The model to use for this key, or null when the provider's list cannot be read (the caller then uses its default). */
export async function resolveModel(
  f: Fetch,
  provider: AiProvider,
  apiKey: string,
): Promise<string | null> {
  try {
    const req = modelsRequest(provider, apiKey);
    const res = await f(req.url, req.init as unknown as Record<string, unknown>);
    if (!res.ok) return null;
    return pickModel(provider, await res.json());
  } catch {
    return null;
  }
}

/**
 * The first model that really answers: each candidate gets a one-word question. A rate limit (429) still proves the key and the
 * model are valid, so that model is kept. Null when the list cannot be read or nothing answers (the caller uses its default).
 */
export async function resolveWorkingModel(
  f: Fetch,
  provider: AiProvider,
  apiKey: string,
  opts: { tries?: number } = {},
): Promise<string | null> {
  let ranked: string[];
  try {
    const req = modelsRequest(provider, apiKey);
    const res = await f(req.url, req.init as unknown as Record<string, unknown>);
    if (!res.ok) return null;
    ranked = rankModels(provider, await res.json());
  } catch {
    return null;
  }
  for (const model of ranked.slice(0, opts.tries ?? 6)) {
    try {
      const ping = buildAiChat(
        provider,
        apiKey,
        'Answer with the single word OK.',
        'Say OK.',
        model,
      );
      const r = await f(ping.url, ping.init as unknown as Record<string, unknown>);
      if (r.ok || r.status === 429) return model;
    } catch {
      // try the next one
    }
  }
  return null;
}
