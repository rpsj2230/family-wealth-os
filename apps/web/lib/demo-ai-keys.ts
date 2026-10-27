import type { AiProvider } from '@fwos/ingest';
import { PROVIDER_NAME } from '@fwos/ingest/src/ai-providers';
import type { AiTestState } from '@/app/(app)/settings/actions';
import { inOrder, type AiKeyRow } from './ai-key-view';

/** Invented keys for the public sample: nothing real, nothing sent. The first choice has run out of credit, so the second one answers. */
export const DEMO_AI_KEYS: AiKeyRow[] = [
  {
    provider: 'anthropic',
    priority: 1,
    enabled: true,
    label: 'Main',
    lastOkAt: '2026-10-20T01:00:00Z',
    lastModel: 'claude-haiku-5-5',
    lastErrorAt: '2026-10-25T01:30:00Z',
    lastErrorStatus: 402,
    lastError: 'Anthropic answered 402 (no credit left)',
    testedAt: '2026-10-25T01:31:00Z',
    testOk: false,
    testNote: 'The Anthropic account has no credit left',
  },
  {
    provider: 'openrouter',
    priority: 2,
    enabled: true,
    label: null,
    lastOkAt: '2026-10-26T00:30:00Z',
    lastModel: 'meta-llama/llama-3.3-70b-instruct:free',
    lastErrorAt: null,
    lastErrorStatus: null,
    lastError: null,
    testedAt: '2026-10-25T09:30:00Z',
    testOk: true,
    testNote: 'Read a test alert with meta-llama/llama-3.3-70b-instruct:free',
  },
  {
    provider: 'groq',
    priority: 3,
    enabled: false,
    label: 'Spare',
    lastOkAt: null,
    lastModel: null,
    lastErrorAt: null,
    lastErrorStatus: null,
    lastError: null,
    testedAt: null,
    testOk: null,
    testNote: null,
  },
];

/** In the sample, only this service fails its test, so the chain test shows a fail-over. */
const DEMO_FAILING: AiProvider[] = ['anthropic'];

const DEMO_MODEL: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
  groq: 'llama-3.3-70b-versatile',
  gemini: 'gemini-2.5-flash',
};

const NO_CREDIT =
  'The Anthropic account has no credit left. Add a few dollars of credit at console.anthropic.com (Billing); reading a rate page costs a fraction of a cent.';

/** What testing one key of the sample says, with no network. */
export function demoTestKey(provider: AiProvider): AiTestState {
  if (DEMO_FAILING.includes(provider))
    return {
      ran: true,
      ok: false,
      provider,
      ms: 1200,
      steps: [
        { ok: true, text: `A ${PROVIDER_NAME[provider]} key is saved.` },
        { ok: false, text: `The AI service answered 402: ${NO_CREDIT}` },
      ],
    };
  return {
    ran: true,
    ok: true,
    provider,
    ms: 2400,
    steps: [
      { ok: true, text: `A ${PROVIDER_NAME[provider]} key is saved.` },
      { ok: true, text: `The key works; the model is ${DEMO_MODEL[provider]}.` },
      {
        ok: true,
        text: `A made-up bank alert was read back correctly (balance 1,23,456.78, account ending 4321) by ${DEMO_MODEL[provider]}.`,
      },
    ],
  };
}

/** What testing the whole chain of the sample says: the keys switched on are asked in order and the first that works answers. */
export function demoTestChain(keys: readonly AiKeyRow[]): AiTestState {
  const on = inOrder(keys).filter((k) => k.enabled);
  if (on.length === 0)
    return {
      ran: true,
      ok: false,
      ms: 0,
      answeredBy: null,
      steps: [
        {
          ok: false,
          text: 'No AI key is switched on. Add one, or switch one on, in Settings > Connections (Bank e-mails and AI).',
        },
      ],
    };
  const steps: AiTestState['steps'] = [];
  let answeredBy: AiProvider | null = null;
  for (const [i, k] of on.entries()) {
    const line = (text: string) => `${i + 1}. ${PROVIDER_NAME[k.provider]}: ${text}`;
    if (answeredBy)
      steps.push({
        ok: true,
        neutral: true,
        text: line('not asked: an earlier key answered. Use its own Test button to try it.'),
      });
    else if (DEMO_FAILING.includes(k.provider)) steps.push({ ok: false, text: line(NO_CREDIT) });
    else {
      answeredBy = k.provider;
      steps.push({
        ok: true,
        text: line(
          `answered; the made-up alert was read back correctly by ${DEMO_MODEL[k.provider]}.`,
        ),
      });
    }
  }
  return { ran: true, ok: answeredBy !== null, ms: 3100, steps, answeredBy };
}
