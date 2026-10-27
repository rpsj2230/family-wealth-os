/**
 * What one call to an AI service used, read from the service's own answer: tokens in, tokens out, and tokens read from or written to
 * the prompt cache. Each service names these differently; all are mapped to the same four numbers so the AI cost page can add them up.
 * `input` is the part of the prompt that was NOT served from the cache (what is billed at the full input rate).
 */
import { AI_PURPOSE_LABEL, type AiPurposeKey } from '@fwos/core';
import type { AiProvider } from './bank-email';

export interface AiTokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** What the AI was asked to do, for the cost page (the words are in core, with the page's own figures). */
export type AiPurpose = AiPurposeKey;
export const PURPOSE_LABEL = AI_PURPOSE_LABEL;

export const isAiPurpose = (v: unknown): v is AiPurpose =>
  typeof v === 'string' && v in AI_PURPOSE_LABEL;

const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** The tokens one answer reports; null when the answer carries no usage figures (nothing is then guessed). */
export function usageFromResponse(provider: AiProvider, json: unknown): AiTokens | null {
  const j = obj(json);
  if (provider === 'anthropic') {
    const u = obj(j.usage);
    if (Object.keys(u).length === 0) return null;
    return {
      input: n(u.input_tokens),
      output: n(u.output_tokens),
      cacheRead: n(u.cache_read_input_tokens),
      cacheWrite: n(u.cache_creation_input_tokens),
    };
  }
  if (provider === 'gemini') {
    const u = obj(j.usageMetadata);
    if (Object.keys(u).length === 0) return null;
    const cached = n(u.cachedContentTokenCount);
    return {
      input: Math.max(0, n(u.promptTokenCount) - cached),
      // thinking tokens are billed as output
      output: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
      cacheRead: cached,
      cacheWrite: 0,
    };
  }
  // OpenAI-style answers (OpenRouter, Groq)
  const u = obj(j.usage);
  if (Object.keys(u).length === 0) return null;
  const cached = n(obj(u.prompt_tokens_details).cached_tokens);
  return {
    input: Math.max(0, n(u.prompt_tokens) - cached),
    output: n(u.completion_tokens),
    cacheRead: cached,
    cacheWrite: 0,
  };
}

/** One real call, as the chain reports it to whoever keeps the log. */
export interface AiUsageEvent {
  provider: AiProvider;
  model: string | null;
  purpose: AiPurpose;
  /** the service answered and the answer was used */
  ok: boolean;
  /** HTTP status; 0 when no answer came */
  status: number;
  /** null when the answer carried no figures or no answer came */
  tokens: AiTokens | null;
  ms: number;
  /** a short plain note when it failed */
  note: string | null;
}
