/**
 * Several AI keys, one answer. A household can save a key for each AI service and put them in order. Every place that asks the AI
 * (inbox reading, statements, bank rate pages, the Settings checks, the self-test) goes through `callAi`: the keys that are switched
 * on are tried in order, and when one fails (refused, out of credit, busy, slow, unreachable, or an answer that cannot be used) the next
 * one is asked. The first usable answer wins. Inside one service the model fallback stays (see `ai-models`).
 *
 * A chain lives for one job run or one button press and remembers what it learned: a service whose key was refused, or that has no
 * credit, is skipped for the rest of the run so that every bank page does not wait for the same failure; a busy or slow service gets
 * another chance on the next item, but is left out too after a few failures in a row.
 *
 * Pure: the network is reached through the injected `fetch`, and what a job wants kept (when a key last worked, why it last failed) is
 * handed to the injected `record`. A key never appears in a result, a message or a log line.
 */
import { aiErrorHint, realFetch, type AiFetch } from './ai-models';
import { PROVIDER_NAME, PROVIDER_SHORT } from './ai-providers';
import { prepareAi, type AiLimits, type AiRuntime } from './ai-runtime';
import type { AiHttp, AiProvider } from './bank-email';

/** One key that may be asked. */
export interface AiKeyEntry {
  provider: AiProvider;
  key: string;
}

/** What one real use of a key did, for the status line in Settings. */
export interface AiUse {
  provider: AiProvider;
  ok: boolean;
  /** HTTP status; 0 when no answer came */
  status: number;
  model: string | null;
  /** a short plain reason when it failed */
  reason: string | null;
}

export interface AiChainDeps {
  fetch?: AiFetch;
  limits?: AiLimits;
  /** called after every real use; a failure here never stops the reading */
  record?: (use: AiUse) => Promise<void> | void;
  /** called with every failed try, for a job's log (the attempt never holds a key) */
  onFailure?: (attempt: AiAttempt) => void;
  /** busy or slow answers in a row after which a service is left out for the rest of the run */
  strikes?: number;
}

export const DEFAULT_STRIKES = 3;

/** A saved key with its place in the order and its switch, as the database holds it. */
export interface StoredAiKey extends AiKeyEntry {
  priority: number;
  enabled: boolean;
}

/** The keys that are switched on, first choice first. A deactivated key is kept but never used. */
export const orderedEnabled = (rows: readonly StoredAiKey[]): AiKeyEntry[] =>
  rows
    .filter((r) => r.enabled)
    .map((r, i) => ({ r, i }))
    .sort((a, b) => a.r.priority - b.r.priority || a.i - b.i)
    .map(({ r }) => ({ provider: r.provider, key: r.key }));

/** One try of one key. */
export interface AiAttempt {
  provider: AiProvider;
  /** the model asked, when known */
  model: string | null;
  /** HTTP status; 0 when no answer came; 200 when it answered but nothing could be used */
  status: number;
  /** the key itself is the problem (refused, no credit, blocked), so it is not asked again in this run */
  keyLevel: boolean;
  /** not asked at all because it failed earlier in this run */
  skipped: boolean;
  /** one short line for logs: "Groq answered 429 (busy or its limit is used up)" */
  brief: string;
  /** the plain-words reason with the way out, for the page */
  reason: string;
  /** a scrubbed excerpt of what the service said, for the job log only */
  detail: string;
}

export interface AiCallSpec<T> {
  /** the request for this service, key and model */
  build(provider: AiProvider, key: string, model: string | undefined): AiHttp;
  /** the usable value in the service's answer, or null when there is none (the next key is then asked) */
  parse(provider: AiProvider, json: unknown): T | null;
}

export type AiCallResult<T> =
  | {
      ok: true;
      value: T;
      provider: AiProvider;
      model: string | null;
      /** the keys that failed before this one answered, in order */
      attempts: AiAttempt[];
    }
  | {
      ok: false;
      /** no key is switched on, so nothing was asked */
      noKeys: boolean;
      attempts: AiAttempt[];
      /** every reason in plain words, with the way out */
      reason: string;
      /** the same on one short line, for logs */
      brief: string;
    };

export const NO_KEYS_REASON =
  'No AI key is switched on. Add one, or switch one on, in Settings > Connections (Bank e-mails and AI).';

/** The keys in the order they are tried, and what this run has learned about them. */
export class AiChain {
  readonly keys: readonly AiKeyEntry[];
  private readonly deps: AiChainDeps;
  private readonly runtimes = new Map<AiProvider, Promise<AiRuntime>>();
  private readonly benched = new Map<AiProvider, string>();
  private readonly strikeCount = new Map<AiProvider, number>();

  constructor(keys: readonly AiKeyEntry[], deps: AiChainDeps = {}) {
    this.keys = keys;
    this.deps = deps;
  }

  /** Whether any key can be asked. */
  get empty(): boolean {
    return this.keys.length === 0;
  }

  /** The model to ask and the call for this key, prepared once per run. */
  runtime(entry: AiKeyEntry): Promise<AiRuntime> {
    let rt = this.runtimes.get(entry.provider);
    if (!rt) {
      rt = prepareAi(entry.provider, entry.key, this.deps.limits, this.deps.fetch ?? realFetch);
      this.runtimes.set(entry.provider, rt);
      rt.catch(() => this.runtimes.delete(entry.provider));
    }
    return rt;
  }

  /** Why this service is left out for the rest of the run, or null when it may be asked. */
  benchedBecause(provider: AiProvider): string | null {
    return this.benched.get(provider) ?? null;
  }

  bench(provider: AiProvider, why: string): void {
    this.benched.set(provider, why);
  }

  /** Counts one more busy or slow answer; true when that was one too many and the service is now left out. */
  strike(provider: AiProvider, why: string): boolean {
    const n = (this.strikeCount.get(provider) ?? 0) + 1;
    this.strikeCount.set(provider, n);
    if (n < (this.deps.strikes ?? DEFAULT_STRIKES)) return false;
    this.bench(provider, `${why}; it failed ${n} times in a row`);
    return true;
  }

  forgive(provider: AiProvider): void {
    this.strikeCount.delete(provider);
  }

  fail(attempt: AiAttempt): void {
    try {
      this.deps.onFailure?.(attempt);
    } catch {
      // logging must never stop the reading
    }
  }

  async record(use: AiUse): Promise<void> {
    try {
      await this.deps.record?.(use);
    } catch {
      // remembering what happened must never stop the reading itself
    }
  }
}

export const createAiChain = (keys: readonly AiKeyEntry[], deps: AiChainDeps = {}): AiChain =>
  new AiChain(keys, deps);

/** Words that mean the key (or the account behind it) is the problem, whatever the status code. */
const KEY_LEVEL_TEXT =
  /credit balance|insufficient[ _](credit|fund|balance)|out of credits?|payment required|invalid[ _]api[ _]key|incorrect api key|api key (not valid|expired|invalid|revoked)|key (has been )?(blocked|revoked|disabled|suspended|deactivated)|account (has been )?(blocked|disabled|suspended|deactivated)|permission[ _]denied|unauthenticated/i;
/** OpenRouter's wrapper for "every free model tried failed": it says nothing about the key. */
const EVERY_MODEL_FAILED = /every free model tried failed/i;
const CREDIT_TEXT =
  /credit|insufficient|payment required|billing|out of funds|quota.*(exhausted|exceeded)/i;

export interface Failure {
  keyLevel: boolean;
  /** a phrase that reads after "answered 401 (": "the key was refused" */
  what: string;
}

/** Whether an error answer is about the key itself, and what to call it in plain words. */
export function classifyFailure(status: number, body: string): Failure {
  const modelsOnly = EVERY_MODEL_FAILED.test(body);
  const busy = status === 429 || status >= 500 || status === 0;
  const keyLevel =
    !modelsOnly &&
    (status === 401 || status === 402 || status === 403 || (!busy && KEY_LEVEL_TEXT.test(body)));
  if (keyLevel) {
    const money = status === 402 || (status !== 401 && CREDIT_TEXT.test(body));
    return { keyLevel, what: money ? 'no credit left' : 'the key was refused' };
  }
  if (modelsOnly) return { keyLevel, what: 'the free models tried were busy or restricted' };
  if (status === 429) return { keyLevel, what: 'busy, or its limit is used up for now' };
  if (status >= 500) return { keyLevel, what: 'the service is having trouble' };
  if (status === 404) return { keyLevel, what: 'the model asked for was not found' };
  return { keyLevel, what: 'the request was refused' };
}

/** Takes the key (and anything shaped like a key in a web address) out of text that came from a service or a network error. */
export function scrubKey(text: string, key: string): string {
  const plain = key.length >= 4 ? text.split(key).join('[key]') : text;
  return plain.replace(/([?&](?:api[_-]?)?key=)[^&\s"']+/gi, '$1[key]');
}

const squash = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max);

function failedAttempt(
  entry: AiKeyEntry,
  model: string | null,
  status: number,
  body: string,
): AiAttempt {
  const { keyLevel, what } = classifyFailure(status, body);
  const short = PROVIDER_SHORT[entry.provider];
  const brief = `${short} answered ${status} (${what})`;
  const hint = aiErrorHint(entry.provider, status, body);
  return {
    provider: entry.provider,
    model,
    status,
    keyLevel,
    skipped: false,
    brief,
    reason: hint ?? `${brief}.`,
    detail: squash(scrubKey(body, entry.key), 160),
  };
}

function silentAttempt(
  entry: AiKeyEntry,
  model: string | null,
  e: unknown,
  stage: 'prepare' | 'ask',
): AiAttempt {
  const err = e as { name?: string; message?: string };
  const slow = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  const short = PROVIDER_SHORT[entry.provider];
  const what = slow ? 'did not answer in time' : 'could not be reached';
  return {
    provider: entry.provider,
    model,
    status: 0,
    keyLevel: false,
    skipped: false,
    brief: `${short} ${what}`,
    reason: `${short} ${what}. It will be asked again next time; if it keeps happening, check your internet connection or the service's status page.`,
    detail: squash(scrubKey(`${stage}: ${err?.message ?? String(e)}`, entry.key), 160),
  };
}

function unusableAttempt(entry: AiKeyEntry, model: string | null, status: number): AiAttempt {
  const short = PROVIDER_SHORT[entry.provider];
  return {
    provider: entry.provider,
    model,
    status,
    keyLevel: false,
    skipped: false,
    brief: `${short} answered, but nothing usable was in the answer`,
    reason: `${short} answered, but nothing usable could be read from the answer (the page or message may simply have nothing to read).`,
    detail: '',
  };
}

function skippedAttempt(entry: AiKeyEntry, why: string): AiAttempt {
  const short = PROVIDER_SHORT[entry.provider];
  return {
    provider: entry.provider,
    model: null,
    status: 0,
    keyLevel: false,
    skipped: true,
    brief: `${short} was skipped (${why})`,
    reason: `${short} was skipped: it failed earlier in this run (${why}).`,
    detail: '',
  };
}

type Tried<T> = { ok: true; value: T; model: string | null } | { ok: false; attempt: AiAttempt };

async function tryKey<T>(
  chain: AiChain,
  entry: AiKeyEntry,
  spec: AiCallSpec<T>,
): Promise<Tried<T>> {
  let rt: AiRuntime;
  try {
    rt = await chain.runtime(entry);
  } catch (e) {
    return { ok: false, attempt: silentAttempt(entry, null, e, 'prepare') };
  }
  const req = spec.build(entry.provider, entry.key, rt.model ?? undefined);
  let res;
  try {
    res = await rt.call(req.url, req.init as unknown as Record<string, unknown>);
  } catch (e) {
    return { ok: false, attempt: silentAttempt(entry, rt.model, e, 'ask') };
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return { ok: false, attempt: failedAttempt(entry, rt.model, res.status, body) };
  }
  const model = res.model ?? rt.model;
  let value: T | null = null;
  try {
    value = spec.parse(entry.provider, await res.json());
  } catch {
    // an answer that is not JSON counts as an answer with nothing usable in it
  }
  if (value === null || value === undefined)
    return { ok: false, attempt: unusableAttempt(entry, model, res.status) };
  return { ok: true, value, model };
}

/** Every failed try on one line, for a job log. */
export const briefOf = (attempts: readonly AiAttempt[]): string =>
  attempts.map((a) => a.brief).join('; ');

/** Every failed try in plain words with the way out, for the page. */
export function explainFailure(attempts: readonly AiAttempt[]): string {
  const lead =
    attempts.length === 1
      ? 'The AI key could not answer.'
      : `None of the ${attempts.length} AI keys could answer.`;
  const lines = attempts.map((a, i) =>
    attempts.length === 1
      ? `${PROVIDER_NAME[a.provider]}: ${a.reason}`
      : `${i + 1}. ${PROVIDER_NAME[a.provider]}: ${a.reason}`,
  );
  return `${lead} ${lines.join(' ')} Open Settings > Connections to fix a key or add another.`;
}

/** "Groq answered" or "Groq answered after Anthropic answered 401 (the key was refused)": who gave the answer, for logs and the page. */
export function answeredBy(r: Extract<AiCallResult<unknown>, { ok: true }>): string {
  const who = `${PROVIDER_SHORT[r.provider]}${r.model ? ` (${r.model})` : ''} answered`;
  return r.attempts.length > 0 ? `${who} after ${briefOf(r.attempts)}` : who;
}

/**
 * Asks the keys in order until one gives a usable answer. Stops at the first. A key refused earlier in the run (or left out after
 * repeated trouble) is not asked, but is listed as skipped so the result explains the whole order.
 */
export async function callAi<T>(chain: AiChain, spec: AiCallSpec<T>): Promise<AiCallResult<T>> {
  const attempts: AiAttempt[] = [];
  if (chain.empty)
    return { ok: false, noKeys: true, attempts, reason: NO_KEYS_REASON, brief: NO_KEYS_REASON };
  for (const entry of chain.keys) {
    const why = chain.benchedBecause(entry.provider);
    if (why !== null) {
      attempts.push(skippedAttempt(entry, why));
      continue;
    }
    const tried = await tryKey(chain, entry, spec);
    if (tried.ok) {
      chain.forgive(entry.provider);
      await chain.record({
        provider: entry.provider,
        ok: true,
        status: 200,
        model: tried.model,
        reason: null,
      });
      return {
        ok: true,
        value: tried.value,
        provider: entry.provider,
        model: tried.model,
        attempts,
      };
    }
    const a = tried.attempt;
    attempts.push(a);
    chain.fail(a);
    if (a.keyLevel) chain.bench(a.provider, a.brief);
    else if (a.status === 0 || a.status === 429 || a.status >= 500)
      chain.strike(a.provider, a.brief);
    await chain.record({
      provider: a.provider,
      ok: false,
      status: a.status,
      model: a.model,
      reason: a.brief,
    });
  }
  return {
    ok: false,
    noKeys: false,
    attempts,
    reason: explainFailure(attempts),
    brief: briefOf(attempts),
  };
}
