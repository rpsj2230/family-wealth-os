/**
 * Can a bank's rate pages be synced? Reads the pages saved for the bank (and the bank's own published pages and PDFs), asks the AI to
 * read the rates from them, and says what happened step by step. Nothing is saved. Used by the "Check" button in Settings; the
 * reading of the documents (`gatherRateDocs`) is shared with the sync itself, so both see a bank the same way.
 *
 * Rates are read only from the bank's own pages. When none can be read the answer says so plainly ("Cannot read: ...") and nothing
 * else is tried: no comparison site, no browser disguise, no workaround of a refusal.
 */
import { briefOf, callAi, type AiChain } from './ai-chain';
import { PROVIDER_NAME, PROVIDER_SHORT } from './ai-providers';
import { casPdfText } from './cas-pdf';
import { isLinkDoc, isOfficialHost, isPdf, rateDocsFor, type RateLinkDoc } from './rate-docs';
import { DOC_KIND_FOR_READER, effectiveDateIn, findRateLink, type DocKind } from './rate-links';
import { buildRatesRequest, htmlToText, parseRatesResponse } from './rates-ai';

const AGENT = 'family-wealth-os/1.0 (personal use)';

export const hostOf = (u: string): string => {
  try {
    return new URL(u).host;
  } catch {
    return 'bank page';
  }
};

/** "equitas.bank.in/nri-banking/save/rates.pdf": where a document is, in a few words. */
export const hostPathOf = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
};

/** Why a page could not be read: the bank refused the automated visit, answered an error, had no text, or could not be reached. */
export class RateReadError extends Error {
  readonly kind: 'refused' | 'http' | 'empty' | 'network';
  readonly status: number;
  constructor(kind: RateReadError['kind'], message: string, status = 0) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** Statuses a site answers when it will not let a program in. */
const REFUSED = new Set([401, 403, 406, 429, 503]);
const STATUS_WORDS: Record<number, string> = {
  401: 'Unauthorized',
  403: 'Access Denied',
  406: 'Not Acceptable',
  429: 'Too Many Requests',
  503: 'Service Unavailable',
};

async function get(url: string, timeoutMs: number): Promise<Response> {
  let r: Response;
  try {
    r = await fetch(url, {
      headers: { 'user-agent': AGENT },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new RateReadError('network', `could not be reached (${(e as Error).message})`);
  }
  if (!r.ok)
    throw new RateReadError(
      REFUSED.has(r.status) ? 'refused' : 'http',
      `answered ${r.status}`,
      r.status,
    );
  return r;
}

/** One openly published page's HTML (for finding a link on it) and the address it ended at after any redirect. */
export async function readRateHtml(
  url: string,
  timeoutMs = 30_000,
): Promise<{ html: string; url: string }> {
  const r = await get(url, timeoutMs);
  return { html: await r.text(), url: r.url || url };
}

/**
 * One openly published page or PDF as text. A page that answers with an error or has no readable text is reported, not worked around.
 * `from`: the text is taken from the first place that matches it (a long page with its rate table far down).
 */
export async function readRateDoc(
  url: string,
  max = 30_000,
  timeoutMs = 30_000,
  from?: RegExp,
): Promise<string> {
  const r = await get(url, timeoutMs);
  if (isPdf(r.headers.get('content-type'), url)) {
    const text = (await casPdfText(new Uint8Array(await r.arrayBuffer()))).trim();
    if (text.length < 200) throw new RateReadError('empty', 'the PDF had almost no readable text');
    return text.slice(0, max);
  }
  const html = await r.text();
  let text: string;
  if (from) {
    const whole = htmlToText(html, Number.MAX_SAFE_INTEGER);
    const at = whole.search(from);
    text = at >= 0 ? whole.slice(at, at + max) : htmlToText(html, max);
  } else text = htmlToText(html, max);
  if (text.length < 200)
    throw new RateReadError(
      'empty',
      'the page had almost no readable text (it may need a browser to load)',
    );
  return text;
}

export interface RateCheckStep {
  ok: boolean;
  text: string;
}

/** One document the bank's rates were read from, or tried to be read from. */
export interface DocLine {
  /** where it was read (the document found by a link, not the page that links to it) */
  url: string;
  kind: DocKind;
  ok: boolean;
  chars: number;
  /** "read 8,123 characters" or why not */
  note: string;
  /** the page whose link led to this document */
  via: string | null;
  /** the date the bank gives for the rates, when its row says so */
  effectiveOn: string | null;
}

interface Failure {
  kind: 'refused' | 'http' | 'empty' | 'network' | 'link';
  status: number;
  host: string;
  /** the words of the reason, without a host */
  reason: string;
  linkName?: string;
}

export interface Gathered {
  lines: DocLine[];
  /** the text of every document that could be read, each with its heading */
  parts: string[];
  steps: RateCheckStep[];
  failures: Failure[];
  /** the documents that were read, for the "where from" note */
  used: DocLine[];
}

const nf = (n: number) => n.toLocaleString('en-IN');

/**
 * Reads, together, the pages saved for the bank and the bank's own published documents. Each document's heading says which rates it
 * carries, so the reader takes only savings slabs from a savings document and only deposit terms from a deposit document. The
 * documents are read at the same time and kept in order.
 */
export async function gatherRateDocs(args: {
  bank: string;
  saved: { url: string; kind: DocKind }[];
  pageMs?: number;
}): Promise<Gathered> {
  const { bank } = args;
  const ms = args.pageMs ?? 15_000;
  const docs = rateDocsFor(bank);
  type Out = { line: DocLine; part: string | null; step: RateCheckStep; failure: Failure | null };
  const fail = (
    line: Omit<DocLine, 'ok' | 'chars' | 'note'>,
    e: unknown,
    text: string,
    extra: Partial<Failure> = {},
  ): Out => {
    const err = e as Partial<RateReadError> & Error;
    const reason = err.message;
    return {
      line: { ...line, ok: false, chars: 0, note: `Cannot read: ${reason}` },
      part: null,
      step: { ok: false, text: text.replace('{reason}', reason) },
      failure: {
        kind: err.kind ?? 'network',
        status: err.status ?? 0,
        host: hostOf(line.url),
        reason,
        ...extra,
      },
    };
  };
  const direct = async (
    url: string,
    kind: DocKind,
    label: string,
    max: number | undefined,
    from: RegExp | undefined,
  ): Promise<Out> => {
    const base = { url, kind, via: null, effectiveOn: null };
    try {
      const text = await readRateDoc(url, max, ms, from);
      return {
        line: { ...base, ok: true, chars: text.length, note: `read ${nf(text.length)} characters` },
        part: `### ${label} [${DOC_KIND_FOR_READER[kind]}]\n${text}`,
        step: { ok: true, text: `${hostPathOf(url)}: read ${nf(text.length)} characters.` },
        failure: null,
      };
    } catch (e) {
      return fail(base, e, `${hostPathOf(url)}: {reason}.`);
    }
  };
  const followed = async (d: RateLinkDoc): Promise<Out> => {
    const kind = d.kind ?? 'both';
    const from = hostPathOf(d.page);
    const base = { url: d.page, kind, via: null, effectiveOn: null };
    let page: { html: string; url: string };
    try {
      page = await readRateHtml(d.page, ms);
    } catch (e) {
      return fail(base, e, `${from}: {reason}.`);
    }
    const found = findRateLink(page.html, page.url, d.link, (h) => isOfficialHost(bank, h));
    if (!found) {
      const reason = `the “${d.linkName}” link was not found in the page’s text (the button may be built by a script)`;
      return {
        line: { ...base, ok: false, chars: 0, note: `Cannot read: ${reason}` },
        part: null,
        step: { ok: false, text: `Cannot read: ${reason}. (${from})` },
        failure: {
          kind: 'link' as const,
          status: 0,
          host: hostOf(d.page),
          reason,
          linkName: d.linkName,
        },
      } satisfies Out;
    }
    const lineBase = {
      url: found.url,
      kind,
      via: d.page,
      effectiveOn: found.effectiveOn ?? effectiveDateIn(found.text),
    };
    try {
      const text = await readRateDoc(found.url, d.max ?? 14_000, ms, d.from);
      const eff = lineBase.effectiveOn
        ? ` (the bank lists it as effective from ${lineBase.effectiveOn})`
        : '';
      return {
        line: {
          ...lineBase,
          ok: true,
          chars: text.length,
          note: `read ${nf(text.length)} characters`,
        },
        part: `### ${d.label}${eff} [${DOC_KIND_FOR_READER[kind]}]\n${text}`,
        step: {
          ok: true,
          text: `Found the “${d.linkName}” link on ${from} → ${hostPathOf(found.url)}, read ${nf(text.length)} characters.`,
        },
        failure: null,
      } satisfies Out;
    } catch (e) {
      return fail(
        lineBase,
        e,
        `Found the “${d.linkName}” link on ${from} → ${hostPathOf(found.url)}, but it could not be read: {reason}.`,
      );
    }
  };

  const tasks: Promise<Out>[] = [
    ...args.saved.map((s) =>
      direct(s.url, s.kind, `${bank}: page saved in Settings`, undefined, undefined),
    ),
    ...docs.official.map((d) =>
      isLinkDoc(d)
        ? followed(d)
        : direct(d.url, d.kind ?? 'both', d.label, d.max ?? 14_000, d.from),
    ),
  ];
  const outs = await Promise.all(tasks);
  // two entries can lead to the same document: it is read once
  const seen = new Set<string>();
  const g: Gathered = { lines: [], parts: [], steps: [], failures: [], used: [] };
  for (const o of outs) {
    if (!o.part && g.lines.some((x) => !x.ok && x.url === o.line.url && x.note === o.line.note))
      continue;
    if (o.part && seen.has(o.line.url)) {
      g.lines.push({ ...o.line, note: `${o.line.note} (the same document as above)` });
      continue;
    }
    if (o.part) seen.add(o.line.url);
    g.lines.push(o.line);
    g.steps.push(o.step);
    if (o.part) {
      g.parts.push(o.part);
      g.used.push(o.line);
    }
    if (o.failure) g.failures.push(o.failure);
  }
  return g;
}

export const PASTE_ADVICE =
  'Paste the page text instead: open the page in your own browser, expand every section, select all, copy, and paste it into “Paste the page”.';

/** The plain sentence for a bank none of whose pages could be read. */
export function cannotReadVerdict(bank: string, g: Pick<Gathered, 'failures'>): string {
  const f = g.failures;
  const refused = f.find((x) => x.kind === 'refused');
  if (refused)
    return `Cannot read: ${bank}’s site refused the automated visit (${refused.status}${STATUS_WORDS[refused.status] ? ` ${STATUS_WORDS[refused.status]}` : ''}). Rates are only read from the bank’s own pages and a refusal is not worked around. ${PASTE_ADVICE}`;
  const link = f.find((x) => x.kind === 'link');
  if (link) return `Cannot read: ${link.reason}. ${PASTE_ADVICE}`;
  const empty = f.find((x) => x.kind === 'empty');
  if (empty)
    return `Cannot read: ${bank}’s page ${empty.reason.replace(/^the (page|PDF) had /, 'has ')}. ${PASTE_ADVICE}`;
  const first = f[0];
  return `Cannot read: ${bank}’s own page did not load${first ? ` (${first.reason})` : ''}. ${PASTE_ADVICE}`;
}

export const NO_RATES_VERDICT = `Cannot read: the bank’s page has no rates in its text (its table is built by a script). ${PASTE_ADVICE}`;

export interface RateCheck {
  /** the pages can be read and the AI finds rates in them: the sync will work */
  ok: boolean;
  /** one line for the row */
  verdict: string;
  steps: RateCheckStep[];
  /** rates the AI found (0 when it could not be asked) */
  found: number;
  ms: number;
  /** each document read or tried */
  docs: DocLine[];
}

export async function checkRateSource(args: {
  bank: string;
  url: string;
  /** which rates the saved page carries (default both) */
  kind?: DocKind;
  /** the AI keys in their order; null or empty: no key is switched on */
  ai: AiChain | null;
  /** milliseconds allowed for each page */
  pageMs?: number;
  /** the most you would put with one bank: rates above it are left out */
  maxAmount?: number | undefined;
}): Promise<RateCheck> {
  const t0 = Date.now();
  const g = await gatherRateDocs({
    bank: args.bank,
    saved: [{ url: args.url, kind: args.kind ?? 'both' }],
    ...(args.pageMs ? { pageMs: args.pageMs } : {}),
  });
  const steps = g.steps;
  const done = (ok: boolean, verdict: string, found = 0): RateCheck => ({
    ok,
    verdict,
    steps,
    found,
    ms: Date.now() - t0,
    docs: g.lines,
  });
  if (g.parts.length === 0) return done(false, cannotReadVerdict(args.bank, g));
  const ai = args.ai;
  if (!ai || ai.empty)
    return done(
      false,
      'Cannot sync yet: the page can be read, but no AI key is switched on to read the rates from it.',
    );

  const text = g.parts.join('\n\n');
  const res = await callAi(ai, {
    purpose: 'rates_check',
    build: (provider, key, model) =>
      buildRatesRequest(provider, key, args.bank, text, model, [], args.maxAmount),
    parse: (provider, json) => {
      const offers = parseRatesResponse(provider, json, args.bank, { maxAmount: args.maxAmount });
      return offers.length > 0 ? offers : null;
    },
  });
  for (const a of res.attempts)
    steps.push({ ok: false, text: `${PROVIDER_NAME[a.provider]}: ${a.reason}` });
  if (!res.ok) {
    // every key answered but found nothing: the page, not the AI, is the problem
    if (res.attempts.length > 0 && res.attempts.every((a) => a.status === 200)) {
      steps.push({ ok: false, text: 'The AI found no rates in the text.' });
      return done(false, NO_RATES_VERDICT);
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
