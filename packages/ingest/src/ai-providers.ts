/** The AI services a household can save a key for, in the order Settings offers them, and how each is named to people. */
import type { AiProvider } from './bank-email';

export const AI_PROVIDERS: readonly AiProvider[] = ['anthropic', 'openrouter', 'groq', 'gemini'];

export const PROVIDER_NAME: Record<AiProvider, string> = {
  anthropic: 'Anthropic (Claude Haiku)',
  openrouter: 'OpenRouter (free models)',
  groq: 'Groq',
  gemini: 'Google Gemini',
};

/** The name on its own, for a sentence that already says what kind of service it is. */
export const PROVIDER_SHORT: Record<AiProvider, string> = {
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  groq: 'Groq',
  gemini: 'Gemini',
};

export const isAiProvider = (v: unknown): v is AiProvider =>
  typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
