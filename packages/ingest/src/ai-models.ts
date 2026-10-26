/**
 * Choosing which model to ask. Providers retire models without warning (a retired name answers 404), so the reader asks the provider
 * which models the key can use and picks the best available one, falling back to a built-in name only when the list cannot be read.
 * Pure: the worker supplies `fetch`.
 */
import type { AiProvider } from './bank-email';

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

export function pickModel(provider: AiProvider, listJson: unknown): string | null {
  let names: string[];
  if (provider === 'groq') {
    const d = (listJson as { data?: { id?: string; active?: boolean }[] } | null)?.data;
    names = (d ?? []).filter((m) => m.active !== false).map((m) => String(m.id ?? ''));
  } else {
    const d = (
      listJson as { models?: { name?: string; supportedGenerationMethods?: string[] }[] } | null
    )?.models;
    names = (d ?? [])
      .filter((m) =>
        (m.supportedGenerationMethods ?? ['generateContent']).includes('generateContent'),
      )
      .map((m) => String(m.name ?? '').replace(/^models\//, ''));
  }
  const usable = names.filter((n) => n && !NOT_CHAT.test(n));
  for (const re of PREFER[provider]) {
    const hit = usable.find((n) => re.test(n));
    if (hit) return hit;
  }
  return usable[0] ?? null;
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
