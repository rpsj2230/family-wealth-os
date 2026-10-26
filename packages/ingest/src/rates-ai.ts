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
) => `You read a bank's public interest-rate page and list the deposit rates for ${bank}.
Return ONLY JSON: {"offers":[{"product":"savings"|"fd","accountKind":"NRE"|"NRO"|"resident"|"any","tenureFromMonths":<integer>,"tenureToMonths":<integer>,"ratePct":<number>,"conditions":"<short text or empty>"}]}.
Rules: ratePct is the yearly rate in percent exactly as printed (7.25 means 7.25%). For fixed deposits give the tenure band in whole months
(1 year = 12; "2 years to less than 3 years" = 24 to 35; days: 7-45 days = 0 to 1). For savings accounts use 0 and 0 and the balance
slab in conditions if there is one. Use accountKind NRE or NRO only when the page says so; otherwise "resident" for domestic rates.
Give the rate for regular (not senior-citizen) customers and mention a senior-citizen premium in conditions. Never invent a rate:
if the page has none, return {"offers":[]}.`;

export function buildRatesRequest(
  provider: AiProvider,
  apiKey: string,
  bank: string,
  pageText: string,
  model?: string,
): AiHttp {
  return buildAiChat(provider, apiKey, PROMPT(bank), pageText.slice(0, 30_000), model);
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
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > 240)
      continue;
    const cond = typeof r.conditions === 'string' ? r.conditions.trim().slice(0, 200) : '';
    const tFrom = product === 'savings' ? 0 : from;
    const tTo = product === 'savings' ? 0 : to;
    const key = `${product}|${kind}|${tFrom}|${tTo}`;
    if (out.has(key)) continue;
    out.set(key, {
      bank,
      product,
      accountKind: kind,
      tenureFromMonths: tFrom,
      tenureToMonths: tTo,
      rate: Math.round(pctNum * 100) / 10_000,
      conditions: cond || null,
    });
  }
  return [...out.values()];
}
