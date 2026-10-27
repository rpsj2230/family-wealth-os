/** A pretend AI service for tests: scripted answers per request, and a record of what was asked. Nothing touches the network. */
import type { AiFetch } from '../src/ai-models';

export interface FakeCall {
  provider: 'anthropic' | 'openrouter' | 'groq' | 'gemini' | 'other';
  url: string;
  /** the key the request carried (from its header or address) */
  key: string | null;
  /** the model named in the request body, when there is one */
  model: string | null;
  body: unknown;
}

export interface FakeReply {
  status?: number;
  json?: unknown;
  text?: string;
  /** the request fails before any answer (network error, timeout) */
  throws?: Error;
}

const providerOf = (url: string): FakeCall['provider'] =>
  url.includes('anthropic.com')
    ? 'anthropic'
    : url.includes('openrouter.ai')
      ? 'openrouter'
      : url.includes('groq.com')
        ? 'groq'
        : url.includes('googleapis.com')
          ? 'gemini'
          : 'other';

/**
 * `route` answers each request; returning undefined for a model-list request means "no list" (404), so the built-in model is used.
 * Chat requests that get undefined are a test mistake and answer 500.
 */
export function fakeAiFetch(route: (call: FakeCall) => FakeReply | undefined) {
  const calls: FakeCall[] = [];
  const fetch: AiFetch = async (url, init) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers.authorization?.replace(/^Bearer /, '');
    const fromUrl = /[?&]key=([^&]+)/.exec(url)?.[1];
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
    const call: FakeCall = {
      provider: providerOf(url),
      url,
      key: auth ?? headers['x-api-key'] ?? headers['x-goog-api-key'] ?? fromUrl ?? null,
      model: (body as { model?: string } | null)?.model ?? null,
      body,
    };
    const isList = init?.method === 'GET' || (!init?.method && !init?.body);
    calls.push(call);
    const r = route(call) ?? (isList ? { status: 404, json: {} } : { status: 500, json: {} });
    if (r.throws) throw r.throws;
    const status = r.status ?? 200;
    const text = r.text ?? JSON.stringify(r.json ?? {});
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text) as unknown,
      text: async () => text,
    };
  };
  return { fetch, calls, chatCalls: () => calls.filter((c) => c.body !== null) };
}

/** An OpenAI-style answer (Groq, OpenRouter) carrying this text. */
export const chatReply = (content: string): FakeReply => ({
  json: { choices: [{ message: { content } }] },
});
/** An Anthropic answer carrying this text. */
export const claudeReply = (text: string): FakeReply => ({
  json: { content: [{ type: 'text', text }] },
});
/** A Gemini answer carrying this text. */
export const geminiReply = (text: string): FakeReply => ({
  json: { candidates: [{ content: { parts: [{ text }] } }] },
});
/** An error answer with a body, as a service sends it. */
export const failure = (status: number, message = 'error'): FakeReply => ({
  status,
  json: { error: { message } },
});
