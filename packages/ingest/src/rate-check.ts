/**
 * Can a bank's rate page be synced? Reads the saved page (and the bank's own published sheets), asks the AI to read the rates from it,
 * and says what happened step by step. Nothing is saved. Used by the "Check" button in Settings and, for reading one document, by the
 * weekly refresh job, so both see a page the same way.
 */
import { briefOf, callAi, type AiChain } from './ai-chain';
import { PROVIDER_NAME, PROVIDER_SHORT } from './ai-providers';
import { casPdfText } from './cas-pdf';
import { isPdf, rateDocsFor } from './rate-docs';
import { buildRatesRequest, htmlToText, parseRatesResponse } from './rates-ai';

const AGENT = 'family-wealth-os/1.0 (personal use)';

export const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return 'bank page';
  }
};

/** One openly published page or PDF as text. A page that answers with an error or has no readable text is reported, not worked around. */
export async function readRateDoc(url: string, max = 30_000, timeoutMs = 30_000): Promise<string> {
  const r = await fetch(url, {
    headers: { 'user-agent': AGENT },
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`answered ${r.status}`);
  if (isPdf(r.headers.get('content-type'), url)) {
    const text = (await casPdfText(new Uint8Array(await r.arrayBuffer()))).trim();
    if (text.length < 200) throw new Error('the PDF had almost no readable text');
    return text.slice(0, max);
  }
  const text = htmlToText(await r.text(), max);
  if (text.length < 200)
    throw new Error('the page had almost no readable text (it may need a browser to load)');
  return text;
}

export interface RateCheckStep {
  ok: boolean;
  text: string;
}

export interface RateCheck {
  /** the page can be read and the AI finds rates in it: the weekly refresh will work */
  ok: boolean;
  /** one line for the row */
  verdict: string;
  steps: RateCheckStep[];
  /** rates the AI found (0 when it could not be asked) */
  found: number;
  ms: number;
}

export async function checkRateSource(args: {
  bank: string;
  url: string;
  /** the AI keys in their order; null or empty: no key is switched on */
  ai: AiChain | null;
  /** milliseconds allowed for each page */
  pageMs?: number;
}): Promise<RateCheck> {
  const t0 = Date.now();
  const steps: RateCheckStep[] = [];
  const parts: string[] = [];
  const add = async (url: string, label: string, max?: number): Promise<boolean> => {
    try {
      const text = await readRateDoc(url, max, args.pageMs ?? 15_000);
      parts.push(`### ${label}\n${text}`);
      steps.push({
        ok: true,
        text: `${hostOf(url)}: read ${text.length.toLocaleString('en-IN')} characters.`,
      });
      return true;
    } catch (e) {
      steps.push({ ok: false, text: `${hostOf(url)}: ${(e as Error).message}.` });
      return false;
    }
  };
  const done = (ok: boolean, verdict: string, found = 0): RateCheck => ({
    ok,
    verdict,
    steps,
    found,
    ms: Date.now() - t0,
  });

  const docs = rateDocsFor(args.bank);
  let fromBank = await add(args.url, `${args.bank}: page saved in Settings`);
  for (const d of docs.official) fromBank = (await add(d.url, d.label, 14_000)) || fromBank;
  let thirdParty = false;
  if (!fromBank)
    for (const d of docs.reference) thirdParty = (await add(d.url, d.label, 15_000)) || thirdParty;
  if (parts.length === 0) {
    const blocked = steps.some((x) => /answered (401|403|406|429|503)\b/.test(x.text));
    return done(
      false,
      blocked
        ? 'Cannot sync by itself: this bank’s site does not let a program open its page (it refuses automated visits). That is not worked around. Use “Paste the page instead” below: open the page in your own browser, copy all the text and paste it.'
        : 'Cannot sync: the page cannot be read. Use “Paste the page instead” below, paste the rates on the Rates page, or save another address for this bank.',
    );
  }
  if (thirdParty)
    steps.push({
      ok: true,
      text: 'The bank’s own page could not be read, so a public comparison page is used. Its rates are labelled as third-party and never remove a rate already on file.',
    });
  const ai = args.ai;
  if (!ai || ai.empty)
    return done(
      false,
      'Cannot sync yet: the page can be read, but no AI key is switched on to read the rates from it.',
    );

  const text = parts.join('\n\n');
  const res = await callAi(ai, {
    build: (provider, key, model) => buildRatesRequest(provider, key, args.bank, text, model, []),
    parse: (provider, json) => {
      const offers = parseRatesResponse(provider, json, args.bank);
      return offers.length > 0 ? offers : null;
    },
  });
  for (const a of res.attempts)
    steps.push({ ok: false, text: `${PROVIDER_NAME[a.provider]}: ${a.reason}` });
  if (!res.ok) {
    // every key answered but found nothing: the page, not the AI, is the problem
    if (res.attempts.length > 0 && res.attempts.every((a) => a.status === 200)) {
      steps.push({ ok: false, text: 'The AI found no rates in the text.' });
      return done(false, 'Cannot sync: no rates could be found on the page.');
    }
    return done(false, `Cannot sync: ${res.reason}`);
  }
  const read = res.value;
  const fd = read.filter((o) => o.product === 'fd').length;
  const sv = read.filter((o) => o.product === 'savings').length;
  steps.push({
    ok: true,
    text: `${PROVIDER_SHORT[res.provider]} found ${read.length} rates (${fd} fixed deposit, ${sv} savings)${res.model ? ` with ${res.model}` : ''}${res.attempts.length > 0 ? ` after ${briefOf(res.attempts)}` : ''}.`,
  });
  return done(
    true,
    `Can sync: ${read.length} rates found (${fd} fixed deposit, ${sv} savings).`,
    read.length,
  );
}
