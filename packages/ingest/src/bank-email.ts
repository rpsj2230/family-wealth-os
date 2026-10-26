/**
 * Reading bank emails. Pure functions only: nothing here touches the network or the database.
 *
 *  1. `parseBankEmail`   rules for the alert formats we have seen (first: HDFC balance alert).
 *  2. `redactForAi`      strips long account numbers before any text is sent to an AI service.
 *  3. `buildAiRequest` / `parseAiResponse`   Groq or Gemini extraction for statements and unfamiliar formats.
 *  4. `matchAccount`     links a reading to one of your accounts by bank and last four digits; never guesses.
 *
 * Trust rules: a reading is only applied automatically when the sender domain belongs to the bank and exactly one
 * account matches. Everything else goes to the review queue. An AI answer is always a suggestion, never applied alone.
 */

export interface BalanceReading {
  bank: string;
  last4: string | null;
  amount: number;
  currency: string;
  asOf: string; // YYYY-MM-DD
  source: 'rule' | 'ai';
  /** the email's From domain belongs to the bank */
  senderVerified: boolean;
}

export type EmailOutcome =
  | { kind: 'balance'; reading: BalanceReading }
  | { kind: 'statement'; hint: string }
  | { kind: 'unknown' };

export interface EmailInput {
  from: string;
  subject: string;
  text: string;
  /** names of attachments, so a statement PDF can be spotted */
  attachments?: string[];
  /** date the email was received, used when the text has no usable date */
  receivedOn?: string;
}

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

/** "25-OCT-26", "25 Oct 2026", "25/10/2026" → "2026-10-25"; null when it is not a real date. */
export function parseBankDate(s: string): string | null {
  const t = s.trim().replace(/[.,]$/, '');
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3,9})[-\s/](\d{2}|\d{4})$/.exec(t);
  let d: number, mo: number, y: number;
  if (m) {
    d = Number(m[1]);
    mo = MONTHS[m[2]!.slice(0, 3).toLowerCase()] ?? 0;
    y = Number(m[3]);
  } else {
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{2}|\d{4})$/.exec(t);
    if (!m) return null;
    d = Number(m[1]);
    mo = Number(m[2]);
    y = Number(m[3]);
  }
  if (y < 100) y += 2000;
  if (!(mo >= 1 && mo <= 12) || !(d >= 1 && d <= 31)) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d)
    return null;
  return dt.toISOString().slice(0, 10);
}

/** "10,711.96" or "1,23,456" → number; null if it is not a plain amount. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/[₹\s]|Rs\.?|INR|S\$|SGD/gi, '').replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Domains banks send alerts and statements from. A bank missing here is never auto-trusted; its mail goes to review. */
const BANK_DOMAINS: Record<string, string[]> = {
  HDFC: ['hdfcbank.bank.in', 'hdfcbank.net', 'hdfcbank.com'],
  ICICI: ['icicibank.com'],
  SBI: ['sbi.co.in', 'onlinesbi.com'],
  AXIS: ['axisbank.com', 'axis.bank.in'],
  KOTAK: ['kotak.com', 'kotak.bank.in'],
  RBL: ['rblbank.com'],
  YES: ['yesbank.in'],
  IDFC: ['idfcfirstbank.com'],
  INDUSIND: ['indusind.com'],
  DBS: ['dbs.com', 'dbs.com.sg'],
  OCBC: ['ocbc.com'],
  UOB: ['uob.com.sg'],
  SC: ['sc.com'],
};

/** Which bank a sender domain belongs to, or null. */
export function bankForDomain(domain: string): string | null {
  for (const [bank, domains] of Object.entries(BANK_DOMAINS))
    if (domains.some((d) => domain === d || domain.endsWith(`.${d}`))) return bank;
  return null;
}

/** True when the sender domain belongs to the bank named in the reading (loose name match). */
export function senderMatchesBank(domain: string, bankName: string): boolean {
  const b = bankForDomain(domain);
  if (!b) return false;
  const n = bankName.toLowerCase();
  return (
    n.includes(b.toLowerCase()) ||
    (b === 'YES' && n.includes('yes bank')) ||
    (b === 'SC' && n.includes('standard chartered'))
  );
}

export function senderDomain(from: string): string {
  const m = /<([^>]+)>/.exec(from);
  const addr = (m ? m[1]! : from).trim().toLowerCase();
  return addr.split('@')[1] ?? '';
}

const domainBelongs = (domain: string, bank: string) => bankForDomain(domain) === bank;

export function parseBankEmail(e: EmailInput): EmailOutcome {
  const domain = senderDomain(e.from);
  const text = e.text.replace(/\s+/g, ' ');

  // HDFC: "Available balance in your account ending XX7240 is Rs. INR 10,711.96 as on 25-OCT-26."
  const hdfc =
    /available balance in your account ending\s+[Xx*]*(\d{3,4})\s+is\s+(?:Rs\.?\s*)?(?:INR\s*)?([\d,]+(?:\.\d+)?)\s+as on\s+(\d{1,2}-[A-Za-z]{3}-\d{2,4})/i.exec(
      text,
    );
  if (hdfc) {
    const amount = parseAmount(hdfc[2]!);
    const asOf = parseBankDate(hdfc[3]!);
    if (amount !== null && asOf)
      return {
        kind: 'balance',
        reading: {
          bank: 'HDFC',
          last4: hdfc[1]!.slice(-4),
          amount,
          currency: 'INR',
          asOf,
          source: 'rule',
          senderVerified: domainBelongs(domain, 'HDFC'),
        },
      };
  }

  const pdfs = (e.attachments ?? []).filter((a) => /\.pdf$/i.test(a));
  if (pdfs.length > 0 && /statement|e-?statement|account summary/i.test(`${e.subject} ${text}`))
    return { kind: 'statement', hint: pdfs[0]! };
  return { kind: 'unknown' };
}

/** Remove anything an AI service does not need: long digit runs (account/card numbers), emails, PAN-like codes. */
export function redactForAi(s: string): string {
  return s
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[PAN]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b\d{9,}\b/g, (m) => `[number …${m.slice(-4)}]`)
    .replace(/\b(?:\d[ -]?){12,}\d\b/g, '[number]');
}

export type AiProvider = 'groq' | 'gemini';

const PROMPT = `You read bank emails and statements. Return ONLY JSON of the form
{"readings":[{"bank":"<bank name>","last4":"<last 4 digits of the account or null>","amount":<closing or available balance as a number>,"currency":"INR|SGD|USD","asOf":"YYYY-MM-DD"}]}.
Use the balance on the statement date (closing balance), not totals of credits or debits. If there is no balance, return {"readings":[]}.
Never invent values. Numbers only, no thousands separators.`;

export type AiHttp = {
  url: string;
  init: { method: 'POST'; headers: Record<string, string>; body: string };
};

export function buildAiRequest(
  provider: AiProvider,
  apiKey: string,
  text: string,
  model?: string,
): AiHttp {
  return buildAiChat(provider, apiKey, PROMPT, redactForAi(text).slice(0, 24_000), model);
}

/** One system instruction and one user text, in the shape each provider expects. Used for every AI reading task. */
export function buildAiChat(
  provider: AiProvider,
  apiKey: string,
  system: string,
  body: string,
  model?: string,
): AiHttp {
  if (provider === 'groq')
    return {
      url: 'https://api.groq.com/openai/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model ?? 'llama-3.3-70b-versatile',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: body },
          ],
        }),
      },
    };
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model ?? 'gemini-2.0-flash'}:generateContent`,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: body }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    },
  };
}

/** Pull the model's text out of either provider's response, then validate every field. Bad rows are dropped. */
/** The JSON the model answered with, from either provider's response shape; null when it is not valid JSON. */
export function aiJson(provider: AiProvider, json: unknown): unknown {
  const j = json as Record<string, unknown>;
  let content: string;
  if (provider === 'groq') {
    const choices = j?.choices as { message?: { content?: string } }[] | undefined;
    content = choices?.[0]?.message?.content ?? '';
  } else {
    const cands = j?.candidates as { content?: { parts?: { text?: string }[] } }[] | undefined;
    content = cands?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
  }
  try {
    return JSON.parse(content.replace(/^```(?:json)?|```$/g, '').trim());
  } catch {
    return null;
  }
}

export function parseAiResponse(
  provider: AiProvider,
  json: unknown,
  opts: { today: string },
): BalanceReading[] {
  const parsed = aiJson(provider, json);
  if (parsed === null) return [];
  const rows = (parsed as { readings?: unknown })?.readings;
  if (!Array.isArray(rows)) return [];
  const out: BalanceReading[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    const amount = typeof r.amount === 'number' ? r.amount : parseAmount(String(r.amount ?? ''));
    const asOf = typeof r.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.asOf) ? r.asOf : null;
    const currency = String(r.currency ?? 'INR').toUpperCase();
    const last4 =
      (r.last4 ?? null) === null ? null : String(r.last4).replace(/\D/g, '').slice(-4) || null;
    if (amount === null || !Number.isFinite(amount) || !asOf || asOf > opts.today) continue;
    if (!/^[A-Z]{3}$/.test(currency) || typeof r.bank !== 'string' || !r.bank.trim()) continue;
    out.push({
      bank: r.bank.trim().slice(0, 60),
      last4,
      amount,
      currency,
      asOf,
      source: 'ai',
      senderVerified: false,
    });
  }
  return out;
}

export interface KnownAccount {
  assetId: string;
  institution: string;
  last4: string | null;
  currency: string;
  type: string;
}

export type AccountMatch =
  | { status: 'matched'; assetId: string; autoApply: boolean }
  | { status: 'ambiguous'; candidates: string[] }
  | { status: 'none' };

/**
 * Link a reading to one account. Needs the bank name AND the last four digits to agree; a reading without last four
 * digits never matches. `autoApply` is true only when the sender domain belongs to the bank (the runner adds more checks for AI readings).
 */
export function matchAccount(r: BalanceReading, accounts: KnownAccount[]): AccountMatch {
  if (!r.last4) return { status: 'none' };
  const bank = r.bank.toLowerCase();
  const hits = accounts.filter(
    (a) =>
      a.last4 === r.last4 &&
      a.currency === r.currency &&
      (a.type === 'bank_account' || a.type === 'third_party_held') &&
      (a.institution.toLowerCase().includes(bank) || bank.includes(a.institution.toLowerCase())),
  );
  if (hits.length === 1)
    return {
      status: 'matched',
      assetId: hits[0]!.assetId,
      autoApply: r.senderVerified,
    };
  if (hits.length > 1) return { status: 'ambiguous', candidates: hits.map((h) => h.assetId) };
  return { status: 'none' };
}
