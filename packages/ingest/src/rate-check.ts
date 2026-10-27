/**
 * Can a bank's rate page be synced? Reads the saved page (and the bank's own published sheets), asks the AI to read the rates from it,
 * and says what happened step by step. Nothing is saved. Used by the "Check" button in Settings and, for reading one document, by the
 * weekly refresh job, so both see a page the same way.
 */
import { aiErrorHint } from './ai-models';
import { prepareAi, type AiLimits } from './ai-runtime';
import type { AiProvider } from './bank-email';
import { casPdfText } from './cas-pdf';
import { isPdf, rateDocsFor } from './rate-docs';
import { buildRatesRequest, htmlToText, parseRatesResponse, type ParsedOffer } from './rates-ai';

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
  /** null: no key is saved */
  ai: { provider: AiProvider; key: string } | null;
  limits?: AiLimits;
  /** milliseconds allowed for each page */
  pageMs?: number;
  /** the most you would put with one bank: rates above it are left out */
  maxAmount?: number;
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
  if (!args.ai)
    return done(
      false,
      'Cannot sync yet: the page can be read, but no AI key is saved to read the rates from it.',
    );

  const rt = await prepareAi(args.ai.provider, args.ai.key, args.limits);
  const ask = async (): Promise<{ read: ParsedOffer[] } | { stop: RateCheck }> => {
    const req = buildRatesRequest(
      args.ai!.provider,
      args.ai!.key,
      args.bank,
      parts.join('\n\n'),
      rt.model || undefined,
      [],
      args.maxAmount,
    );
    let res;
    try {
      res = await rt.call(req.url, req.init as unknown as Record<string, unknown>);
    } catch (e) {
      steps.push({ ok: false, text: `The AI service did not answer (${(e as Error).message}).` });
      return {
        stop: done(false, 'Cannot sync: the AI service did not answer. Try again in a minute.'),
      };
    }
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
      const hint = aiErrorHint(args.ai!.provider, res.status, body);
      steps.push({
        ok: false,
        text: `The AI service answered ${res.status}: ${body}${hint ? ` ${hint}` : ''}`,
      });
      return {
        stop: done(
          false,
          `Cannot sync: the AI service answered ${res.status}.${hint ? ` ${hint}` : ''}`,
        ),
      };
    }
    try {
      return {
        read: parseRatesResponse(args.ai!.provider, await res.json(), args.bank, {
          maxAmount: args.maxAmount,
        }),
      };
    } catch (e) {
      steps.push({
        ok: false,
        text: `The AI answer could not be understood (${(e as Error).message}).`,
      });
      return { stop: done(false, 'Cannot sync: the AI answer could not be understood.') };
    }
  };
  let first = await ask();
  if ('stop' in first) return first.stop;
  let read = first.read;
  // a bank page that loads but builds its table with a script has text and no rates: try the public comparison pages
  if (read.length === 0 && !thirdParty && docs.reference.length > 0) {
    steps.push({
      ok: false,
      text: 'The bank’s own page had no rates in its text (its table is probably built by a script). Trying the public comparison pages.',
    });
    parts.length = 0;
    for (const d of docs.reference) thirdParty = (await add(d.url, d.label, 15_000)) || thirdParty;
    if (parts.length > 0) {
      first = await ask();
      if ('stop' in first) return first.stop;
      read = first.read;
    }
  }
  if (read.length === 0) {
    steps.push({ ok: false, text: 'The AI found no rates in the text.' });
    return done(false, 'Cannot sync: no rates could be found on the page.');
  }
  const fd = read.filter((o) => o.product === 'fd').length;
  const sv = read.filter((o) => o.product === 'savings').length;
  steps.push({
    ok: true,
    text: `The AI found ${read.length} rates (${fd} fixed deposit, ${sv} savings) with ${rt.model ?? args.ai.provider}.`,
  });
  return done(
    true,
    `Can sync: ${read.length} rates found (${fd} fixed deposit, ${sv} savings).`,
    read.length,
  );
}
