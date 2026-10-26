/**
 * Choosing which model to ask. Providers retire models without warning (a retired name answers 404), so the reader asks the provider
 * which models the key can use and picks the best available one, falling back to a built-in name only when the list cannot be read.
 * Pure: the worker supplies `fetch`.
 */
import { buildAiChat, parseJsonLoosely, type AiProvider } from './bank-email';

export interface ModelsHttp {
  url: string;
  init: { method: 'GET'; headers: Record<string, string> };
}

export function modelsRequest(provider: AiProvider, apiKey: string): ModelsHttp {
  if (provider === 'openrouter')
    return {
      url: 'https://openrouter.ai/api/v1/models',
      init: { method: 'GET', headers: { authorization: `Bearer ${apiKey}` } },
    };
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
  // free models only (see modelNames); larger, instruction-tuned and current ones first, reasoning models last
  openrouter: [
    /llama-3\.3-70b/,
    /gpt-oss-120b/,
    /qwen3?-.*(235b|72b|32b|30b)/,
    /deepseek.*v3/,
    /gemma-3-27b/,
    /mistral-(small|nemo|7b)/,
    /llama-4/,
    /gpt-oss-20b/,
    /gemma-3/,
    /llama-3/,
    /deepseek/,
  ],
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

/** OpenRouter: models with no price for text in and text out, the larger context first. */
function openRouterFree(listJson: unknown): string[] {
  type M = {
    id?: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
    architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  };
  const d = (listJson as { data?: M[] } | null)?.data ?? [];
  return d
    .filter((m) => {
      const free =
        String(m.id ?? '').endsWith(':free') ||
        (Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0);
      const textIn = m.architecture?.input_modalities?.includes('text') ?? true;
      const textOut = m.architecture?.output_modalities?.every((x) => x === 'text') ?? true;
      return (
        free &&
        textIn &&
        textOut &&
        !/(embed|guard|moderat|whisper|tts|image|audio|vision|-vl\b)/i.test(String(m.id))
      );
    })
    .sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
    .map((m) => String(m.id));
}

function modelNames(provider: AiProvider, listJson: unknown): string[] {
  if (provider === 'openrouter') return openRouterFree(listJson);
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
  const usable = modelNames(provider, listJson).filter(
    (n) => n && (provider === 'openrouter' || !NOT_CHAT.test(n)),
  );
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
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text?(): Promise<string> }>;

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

/** What each candidate model answered to the one-word question, for the self-test (no key, no personal text). */
export async function probeModels(
  f: Fetch,
  provider: AiProvider,
  apiKey: string,
  tries = 6,
): Promise<{ model: string; status: number; note: string }[]> {
  const out: { model: string; status: number; note: string }[] = [];
  try {
    const req = modelsRequest(provider, apiKey);
    const res = await f(req.url, req.init as unknown as Record<string, unknown>);
    if (!res.ok)
      return [{ model: '(model list)', status: res.status, note: 'the model list was refused' }];
    for (const model of rankModels(provider, await res.json()).slice(0, tries)) {
      const ping = buildAiChat(
        provider,
        apiKey,
        'Answer with the single word OK.',
        'Say OK.',
        model,
      );
      const r = await f(ping.url, ping.init as unknown as Record<string, unknown>);
      const body = r.ok
        ? ''
        : ((await r.text?.().catch(() => '')) ?? '').replace(/\s+/g, ' ').slice(0, 160);
      out.push({ model, status: r.status, note: body });
    }
  } catch (e) {
    out.push({ model: '(error)', status: 0, note: (e as Error).message });
  }
  return out;
}

/** The reason an AI service refused, in plain words and with the way out; null when there is nothing more to add. */
export function aiErrorHint(provider: AiProvider, status: number, body: string): string | null {
  const b = body.toLowerCase();
  // every model failed for its own reason (restricted, busy, slow): that says nothing about the key itself
  if (provider === 'openrouter' && b.includes('every free model tried failed'))
    return 'The free models tried were restricted, busy or too slow. The key itself is fine if another page was read. Try again later, or add a small credit on openrouter.ai, or use a free Groq key.';
  if (provider === 'openrouter' && (status === 401 || status === 403))
    return 'OpenRouter refused the key. Create a key at openrouter.ai/keys and save it in Settings > Bank emails and AI.';
  if (provider === 'openrouter' && (status === 402 || status === 429 || status === 503))
    return 'The free models are busy or the free daily limit is used up. They are tried one after another; try again later, or add a small credit on openrouter.ai to raise the limit.';
  if (status === 403 && /free tier|billing/.test(b))
    return provider === 'gemini'
      ? 'This Gemini key belongs to a Google project that has no free tier. Create a new key in Google AI Studio (aistudio.google.com, "Create API key" in a new project), or use a free Groq key (console.groq.com), and save it in Settings > Bank emails and AI.'
      : 'This key has no free access. Create a new free key and save it in Settings > Bank emails and AI.';
  if (status === 401 || status === 403)
    return 'The key was refused. Check it is current and belongs to the provider chosen in Settings.';
  if (status === 404 && /no longer available|not found/.test(b))
    return 'That model is no longer offered to this key; the job tries the others by itself.';
  if (status === 429)
    return 'The free quota is used up for now; it resets by itself (usually within a minute or a day).';
  return null;
}

export type Answer = {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
  /** the model that gave this answer (OpenRouter fallback) */
  model?: string;
};
type RawFetch = (
  u: string,
  init?: Record<string, unknown>,
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const answer = (ok: boolean, status: number, text: string, model?: string): Answer => ({
  ok,
  status,
  ...(model ? { model } : {}),
  text: async () => text,
  json: async () => JSON.parse(text) as unknown,
});

/** Whether an OpenAI-style reply holds a JSON answer (a free model may answer 200 with an error, nothing, or prose). */
function usableAnswer(text: string): boolean {
  try {
    const j = JSON.parse(text) as {
      error?: unknown;
      choices?: { message?: { content?: unknown } }[];
    };
    if (j.error) return false;
    const c = j.choices?.[0]?.message?.content;
    return typeof c === 'string' && parseJsonLoosely(c) !== null;
  } catch {
    return false;
  }
}

/**
 * For OpenRouter's free models: asks the first model; if it errors, is rate limited, is gone, or answers something that is not
 * JSON, asks the next, and so on, so one flaky free model never stops the reading. Other providers are called as they are.
 * Every attempt is returned in `tried` of the last answer's text on failure, so the reason shows up in the job's log.
 */
export function withModelFallback(
  f: RawFetch,
  provider: AiProvider,
  models: string[],
  opts: { maxTries?: number } = {},
): (u: string, init?: Record<string, unknown>) => Promise<Answer> {
  // what this run has learned: a model that answered goes first next time, one the service refused (403/404) is not asked again
  const worked: string[] = [];
  const refused = new Set<string>();
  return async (u, init) => {
    if (provider !== 'openrouter' || models.length === 0 || typeof init?.body !== 'string') {
      const r = await f(u, init);
      const t = await r.text();
      return answer(r.ok, r.status, t);
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    const notes: string[] = [];
    let last: Answer | null = null;
    const order = [
      ...worked.filter((m) => models.includes(m)),
      ...models.filter((m) => !worked.includes(m) && !refused.has(m)),
    ];
    for (const model of order.slice(0, opts.maxTries ?? 5)) {
      try {
        const r = await f(u, { ...init, body: JSON.stringify({ ...body, model }) });
        const t = await r.text();
        if (r.ok && usableAnswer(t)) {
          if (!worked.includes(model)) worked.unshift(model);
          return answer(true, r.status, t, model);
        }
        if (r.status === 403 || r.status === 404) refused.add(model);
        notes.push(`${model}: ${r.ok ? 'no JSON answer' : r.status}`);
        last = answer(false, r.ok ? 502 : r.status, t);
      } catch (e) {
        notes.push(`${model}: ${(e as Error).message}`);
      }
    }
    const status = last?.status ?? 503;
    return answer(false, status, `Every free model tried failed (${notes.join('; ')}).`);
  };
}
