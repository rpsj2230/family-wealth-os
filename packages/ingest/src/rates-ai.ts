/**
 * Reading a bank's published rate page into rate offers. Pure: the worker fetches the page and calls the AI service; these
 * functions prepare the text, build the request and check every field of the answer. A row that fails a check is dropped.
 */
import { aiJson, buildAiChat, type AiHttp, type AiProvider } from './bank-email';

export interface ParsedOffer {
  bank: string;
  product: 'savings' | 'fd';
  accountKind: 'NRE' | 'NRO' | 'resident' | 'any';
  tenureFromMonths: number;
  tenureToMonths: number;
  /** yearly rate as a fraction: 0.0725 */
  rate: number;
  conditions: string | null;
  /** savings only: the balance slab this rate applies to, in rupees */
  balanceFrom: number | null;
  balanceTo: number | null;
}

/** Visible text of a page: scripts, styles and tags removed, entities decoded, whitespace collapsed, length capped. */
export function htmlToText(html: string, max = 30_000): string {
  return html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(tr|p|div|li|h[1-6]|table)>/gi, '\n')
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#8377;|&rupee;/g, '₹')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
    .slice(0, max);
}

const PROMPT = (
  bank: string,
) => `You read a bank's public interest-rate page and list ONLY these rates for ${bank}:
 (1) the savings account interest rate, with every balance slab as its own offer;
 (2) fixed deposit rates for NRE deposits (if the page does not separate NRE from domestic rates, give the general fixed deposit rates).
Savings rates may differ for NRE and NRO accounts: give both when the page does. Ignore everything else: NRO or foreign-currency fixed deposits, recurring deposits, tax-saver deposits, senior-citizen-only tables, corporate or bulk deposits.
Return ONLY JSON: {"offers":[{"product":"savings"|"fd","accountKind":"NRE"|"NRO"|"any","tenureFromMonths":<integer>,"tenureToMonths":<integer>,"ratePct":<number>,"balanceFromRupees":<number or null>,"balanceToRupees":<number or null>,"conditions":"<short text or empty>"}]}.
Rules: ratePct is the yearly rate in percent exactly as printed (7.25 means 7.25%). For fixed deposits give the tenure band in whole months
(1 year = 12; "2 years to less than 3 years" = 24 to 35; days: 7-45 days = 0 to 1). For savings use "any", 0 and 0, with balanceFromRupees (above)
and balanceToRupees (up to; null when there is no upper limit), both null when the rate has no slab. Use accountKind "NRE" for a deposit only when the
page says NRE, otherwise "any". Give the rate for regular (not senior-citizen) customers and mention a senior-citizen premium in conditions.
Never invent a rate: if the page has none of these, return {"offers":[]}.`;

/** Corrections you made earlier, as rules the reader must follow for this bank (kept short, newest first). */
export const withHints = (prompt: string, hints: string[]) =>
  hints.length === 0
    ? prompt
    : `${prompt}\nKnown corrections for this bank. Follow them exactly:\n${hints
        .slice(0, 8)
        .map((h) => `- ${h.slice(0, 400)}`)
        .join('\n')}`;

export function buildRatesRequest(
  provider: AiProvider,
  apiKey: string,
  bank: string,
  pageText: string,
  model?: string,
  hints: string[] = [],
): AiHttp {
  return buildAiChat(
    provider,
    apiKey,
    withHints(PROMPT(bank), hints),
    pageText.slice(0, 30_000),
    model,
  );
}

const KINDS = new Set(['NRE', 'NRO', 'resident', 'any']);

/** Validates the AI's answer. Rates between 0.5% and 20%, whole-month tenures, known products; duplicates collapse to the first. */
export function parseRatesResponse(
  provider: AiProvider,
  json: unknown,
  bank: string,
): ParsedOffer[] {
  const parsed = aiJson(provider, json) as { offers?: unknown } | null;
  const rows = parsed?.offers;
  if (!Array.isArray(rows)) return [];
  const out = new Map<string, ParsedOffer>();
  for (const r of rows.slice(0, 80) as Record<string, unknown>[]) {
    const product = r.product === 'savings' || r.product === 'fd' ? r.product : null;
    const kind =
      typeof r.accountKind === 'string' && KINDS.has(r.accountKind)
        ? (r.accountKind as ParsedOffer['accountKind'])
        : 'any';
    const pctNum =
      typeof r.ratePct === 'number' ? r.ratePct : Number(String(r.ratePct ?? '').replace('%', ''));
    const from = Number(r.tenureFromMonths ?? 0);
    const to = Number(r.tenureToMonths ?? from);
    if (!product || !Number.isFinite(pctNum) || pctNum < 0.5 || pctNum > 20) continue;
    if (product === 'fd' && kind === 'NRO') continue; // only NRE deposits are of interest
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 240)
      continue;
    const cond = typeof r.conditions === 'string' ? r.conditions.trim().slice(0, 200) : '';
    const tFrom = product === 'savings' ? 0 : from;
    const tTo = product === 'savings' ? 0 : to;
    const num = (v: unknown) =>
      typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;
    const bFrom = product === 'savings' ? num(r.balanceFromRupees) : null;
    const bTo = product === 'savings' ? num(r.balanceToRupees) : null;
    if (bTo !== null && bTo <= (bFrom ?? 0)) continue;
    const key = `${product}|${kind}|${tFrom}|${tTo}|${bFrom ?? 0}|${bTo ?? -1}`;
    if (out.has(key)) continue;
    out.set(key, {
      bank,
      product,
      accountKind: kind,
      tenureFromMonths: tFrom,
      tenureToMonths: tTo,
      rate: Math.round(pctNum * 100) / 10_000,
      conditions: cond || null,
      balanceFrom: bFrom === 0 ? null : bFrom,
      balanceTo: bTo,
    });
  }
  return [...out.values()];
}
