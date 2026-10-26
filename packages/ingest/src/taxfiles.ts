/**
 * Reading Form 26AS (tax credit statement from TRACES) and the Annual Information Statement (AIS).
 *
 * The income-tax department does not publish the exact layout of these files, so the reader does not depend on one: it looks
 * for what every version contains, whether it arrives as the caret-separated text file, a PDF's text or a saved web page:
 *   - a deductor line (name, 10-character TAN, three amounts) followed by its transaction lines (section such as 194A, a booking
 *     date, a status letter, amount paid, tax deducted, tax deposited),
 *   - tax paid by the person (BSR code, date, challan number, amount) and refunds,
 *   - for the AIS, information lines with a description, a source and an amount, in JSON or text.
 * Every total is cross-checked (deductor totals against their lines); a mismatch or an unrecognised file is reported in
 * `warnings`. The PAN is only read to check the file belongs to the right person: it is never kept, only its last four.
 * When the plain reader finds nothing, an AI service can be asked for the same table (`source: 'ai'`), and the answer is
 * checked field by field before use.
 */
import { aiJson, buildAiChat, type AiHttp, type AiProvider } from './bank-email';

export interface TdsTxn {
  section: string;
  txnDate: string | null;
  status: string | null;
  bookingDate: string | null;
  paid: number;
  tax: number;
  deposited: number;
}
export interface Deductor {
  name: string;
  tan: string;
  paid: number;
  tax: number;
  deposited: number;
  txns: TdsTxn[];
}
export interface TaxPaid {
  bsr: string | null;
  date: string | null;
  challan: string | null;
  amount: number;
}
export interface Form26as {
  kind: '26as';
  source: 'rules' | 'ai';
  panLast4: string | null;
  fy: string | null;
  deductors: Deductor[];
  taxPaid: TaxPaid[];
  refunds: { ay: string | null; amount: number; interest: number; date: string | null }[];
  /** tax deducted, summed over the deductors */
  totalTds: number;
  warnings: string[];
}

export type AisCategory =
  | 'interest_savings'
  | 'interest_deposit'
  | 'interest_other'
  | 'dividend'
  | 'mf_purchase'
  | 'mf_redemption'
  | 'securities_purchase'
  | 'securities_sale'
  | 'salary'
  | 'rent'
  | 'tax_paid'
  | 'refund'
  | 'other';

export interface AisLine {
  category: AisCategory;
  description: string;
  source: string;
  amount: number;
  tax: number | null;
}
export interface Ais {
  kind: 'ais';
  source: 'rules' | 'ai';
  panLast4: string | null;
  fy: string | null;
  lines: AisLine[];
  byCategory: Partial<Record<AisCategory, number>>;
  warnings: string[];
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
export function taxDate(s: string): string | null {
  const m = /^(\d{1,2})[-/ ]([A-Za-z]{3})[a-z]*[-/ ](\d{4})$/.exec(s.trim());
  if (m) {
    const mo = MONTHS.indexOf(m[2]!.toLowerCase()) + 1;
    if (mo === 0) return null;
    return `${m[3]}-${String(mo).padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  const n = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s.trim());
  if (n) return `${n[3]}-${n[2]!.padStart(2, '0')}-${n[1]!.padStart(2, '0')}`;
  return null;
}
const amt = (s: string) => Number(s.replace(/[,\s₹]/g, ''));

const normalise = (t: string) =>
  t
    .replace(/\^/g, ' ')
    .replace(/\|/g, ' ')
    .replace(/\r/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

/** The financial year named in the statement: "Financial Year 2025-26", or the assessment year less one. */
export function findFy(t: string): string | null {
  const fy = /Financial Year[\s\S]{0,200}?(20\d{2})\s*-\s*(\d{2,4})/i.exec(t);
  if (fy) return `${fy[1]}-${fy[2]!.slice(-2)}`;
  const ay = /Assessment Year[^0-9]{0,30}(\d{4})\s*-\s*(\d{2,4})/i.exec(t);
  if (ay) {
    const y = Number(ay[1]) - 1;
    return `${y}-${String(Number(ay[1])).slice(-2)}`;
  }
  return null;
}
const findPan = (t: string) => /\b([A-Z]{5}[0-9]{4}[A-Z])\b/.exec(t)?.[1] ?? null;

const A = String.raw`[\d,]+\.\d{2}`;
const D = String.raw`\d{1,2}[-/][A-Za-z]{3}[-/]\d{4}`;
const TAN = String.raw`[A-Z]{4}\d{5}[A-Z]`;
const DEDUCTOR = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+((?:(?!${TAN}|${D}|${A}).){2,120}?)\s+(${TAN})\s+(${A})\s+(${A})\s+(${A})(?=\s|$)`,
  'g',
);
const TXN = new RegExp(
  String.raw`(?:^|\s)(\d{1,4})\s+(19[0-9][A-Z0-9()]{0,5}|20[0-9][A-Z0-9()]{0,5}|206C[A-Z0-9()]{0,5}|[0-9]{3}[A-Z]{1,3})\s+(${D})\s+([A-Z])\s+(${D})\s+(?:[A-Za-z-]{1,3}\s+|[A-Za-z][A-Za-z ./-]{0,30}?\s+)?(${A})\s+(${A})\s+(${A})(?=\s|$)`,
  'g',
);
const PAID = new RegExp(
  String.raw`(?:^|\s)(\d{1,3})\s+(\d{7})\s+(${D})\s+(\d{5})\s+(?:[\d.]+\s+)?(${A})(?=\s|$)`,
  'g',
);
const REFUND = new RegExp(
  String.raw`(\d{4}-\d{2,4})\s+(?:[A-Za-z0-9 /-]{2,40}?\s+)?(${A})\s+(${A})\s+(${D})`,
  'g',
);

export function parse26as(raw: string): Form26as {
  const t = normalise(raw);
  const warnings: string[] = [];
  const marks = [...t.matchAll(DEDUCTOR)].map((m) => ({
    at: m.index!,
    d: {
      name: m[2]!.replace(/\s+/g, ' ').trim(),
      tan: m[3]!,
      paid: amt(m[4]!),
      tax: amt(m[5]!),
      deposited: amt(m[6]!),
      txns: [] as TdsTxn[],
    } satisfies Deductor,
  }));
  for (const m of t.matchAll(TXN)) {
    const owner = [...marks].reverse().find((x) => x.at <= m.index!);
    if (!owner) continue;
    owner.d.txns.push({
      section: m[2]!,
      txnDate: taxDate(m[3]!),
      status: m[4]!,
      bookingDate: taxDate(m[5]!),
      paid: amt(m[6]!),
      tax: amt(m[7]!),
      deposited: amt(m[8]!),
    });
  }
  const deductors = marks.map((x) => x.d);
  for (const d of deductors) {
    if (d.txns.length === 0) continue;
    const sum = d.txns.reduce((a, x) => a + x.tax, 0);
    if (Math.abs(sum - d.tax) > 1)
      warnings.push(
        `${d.name}: the lines add up to ₹${Math.round(sum)} of tax but the total says ₹${Math.round(d.tax)}.`,
      );
  }
  const taxPaid: TaxPaid[] = [...t.matchAll(PAID)].map((m) => ({
    bsr: m[2]!,
    date: taxDate(m[3]!),
    challan: m[4]!,
    amount: amt(m[5]!),
  }));
  const refunds = [...t.matchAll(REFUND)]
    .map((m) => ({ ay: m[1]!, amount: amt(m[2]!), interest: amt(m[3]!), date: taxDate(m[4]!) }))
    .filter((r) => r.date !== null && /refund/i.test(t));
  if (deductors.length === 0 && taxPaid.length === 0)
    warnings.push('No deductor lines were recognised in this file.');
  const pan = findPan(t);
  return {
    kind: '26as',
    source: 'rules',
    panLast4: pan ? pan.slice(-4) : null,
    fy: findFy(t),
    deductors,
    taxPaid,
    refunds,
    totalTds: Math.round(deductors.reduce((a, d) => a + d.tax, 0) * 100) / 100,
    warnings,
  };
}

// ------------------------------------------------------------------------------------------------
// AIS
// ------------------------------------------------------------------------------------------------
export function aisCategory(description: string): AisCategory {
  const d = description.toLowerCase();
  if (/refund/.test(d)) return 'refund';
  if (/advance tax|self.?assessment|tax paid|challan/.test(d)) return 'tax_paid';
  if (/salary|192/.test(d) && !/interest/.test(d)) return 'salary';
  if (/rent|194i/.test(d) && !/interest/.test(d)) return 'rent';
  if (/dividend/.test(d)) return 'dividend';
  if (/interest/.test(d)) {
    if (/saving/.test(d)) return 'interest_savings';
    if (/deposit|fd|term|194a/.test(d)) return 'interest_deposit';
    return 'interest_other';
  }
  if (/mutual fund|units? of/.test(d)) {
    if (/purchase|subscription|buy/.test(d)) return 'mf_purchase';
    if (/redemption|repurchase|sale|sell/.test(d)) return 'mf_redemption';
  }
  if (/securit|shares?|equity|listed/.test(d)) {
    if (/purchase|buy/.test(d)) return 'securities_purchase';
    if (/sale|sell|redemption/.test(d)) return 'securities_sale';
  }
  return 'other';
}

const AMOUNT_KEY =
  /^(amount|value|amountreported|amountafterderivation|amountpaid|reportedamount|infovalue|information ?value)$/i;
const TAX_KEY = /^(tax(deducted)?|tds|tdsamount|taxdeducted|taxdeductedamount)$/i;
const DESC_KEY =
  /^(description|informationdescription|infodescription|info|category|nature|sftdescription|informationcode)$/i;
const SRC_KEY = /^(source|informationsource|deductor|deductorname|reportedby|sourcename|name)$/i;

function numeric(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^[\s₹-]*[\d,]+(\.\d+)?\s*$/.test(v)) return amt(v.replace('-', ''));
  return null;
}

/** Walks any JSON and collects objects that look like an information line: a description and an amount. */
export function parseAisJson(json: unknown): Ais {
  const lines: AisLine[] = [];
  let pan: string | null = null;
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (depth > 12 || node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const x of node.slice(0, 5000)) walk(x, depth + 1);
      return;
    }
    const o = node as Record<string, unknown>;
    const keys = Object.keys(o);
    for (const k of keys)
      if (
        /^pan$/i.test(k) &&
        typeof o[k] === 'string' &&
        /^[A-Z]{5}\d{4}[A-Z]$/.test(o[k] as string)
      )
        pan ??= o[k] as string;
    const ak = keys.find(
      (k) => AMOUNT_KEY.test(k.replace(/[\s_-]/g, '')) && numeric(o[k]) !== null,
    );
    const dk = keys.filter(
      (k) => DESC_KEY.test(k.replace(/[\s_-]/g, '')) && typeof o[k] === 'string',
    );
    if (ak && dk.length > 0) {
      const description = dk
        .map((k) => String(o[k]))
        .join(' ')
        .slice(0, 200);
      const sk = keys.find(
        (k) => SRC_KEY.test(k.replace(/[\s_-]/g, '')) && typeof o[k] === 'string',
      );
      const tk = keys.find((k) => TAX_KEY.test(k.replace(/[\s_-]/g, '')) && numeric(o[k]) !== null);
      lines.push({
        category: aisCategory(description),
        description,
        source: sk ? String(o[sk]).slice(0, 120) : '',
        amount: numeric(o[ak])!,
        tax: tk ? numeric(o[tk]) : null,
      });
    }
    for (const k of keys) walk(o[k], depth + 1);
  };
  walk(json, 0);
  return finishAis(lines, pan, JSON.stringify(json).slice(0, 4000), 'rules');
}

const AIS_LINE = new RegExp(
  String.raw`((?:interest|dividend|salary|rent|purchase|sale|redemption|securities|mutual fund|units?|tax|refund)[A-Za-z0-9 .,()/&:-]{0,140}?)\s+(${A})(?:\s+(${A}))?(?=\s|$)`,
  'gi',
);

/** AIS as text (a PDF's text or a CSV export): description followed by an amount. Rough, so it says so. */
export function parseAisText(raw: string): Ais {
  const t = normalise(raw);
  const lines: AisLine[] = [];
  for (const m of t.matchAll(AIS_LINE)) {
    const description = m[1]!.replace(/\s+/g, ' ').trim();
    const amount = amt(m[2]!);
    if (!(amount > 0)) continue;
    lines.push({ category: aisCategory(description), description, source: '', amount, tax: null });
  }
  const pan = findPan(t);
  const res = finishAis(lines, pan, t, 'rules');
  if (lines.length > 0)
    res.warnings.push('Read from the text of a PDF: check the figures against the statement.');
  return res;
}

function finishAis(
  lines: AisLine[],
  pan: string | null,
  textForFy: string,
  source: Ais['source'],
): Ais {
  const byCategory: Ais['byCategory'] = {};
  for (const l of lines)
    byCategory[l.category] = Math.round(((byCategory[l.category] ?? 0) + l.amount) * 100) / 100;
  const warnings: string[] = [];
  if (lines.length === 0) warnings.push('No information lines were recognised in this file.');
  return {
    kind: 'ais',
    source,
    panLast4: pan ? pan.slice(-4) : null,
    fy: findFy(textForFy),
    lines: lines.slice(0, 3000),
    byCategory,
    warnings,
  };
}

// ------------------------------------------------------------------------------------------------
// AI fallback: the same tables, asked for as JSON and checked field by field
// ------------------------------------------------------------------------------------------------
const AI_26AS = `You read the text of an Indian Form 26AS (tax credit statement). Return ONLY JSON:
{"fy":"2025-26","deductors":[{"name":"","tan":"ABCD12345E","paid":0,"tax":0,"deposited":0,"txns":[{"section":"194A","txnDate":"YYYY-MM-DD","status":"F","bookingDate":"YYYY-MM-DD","paid":0,"tax":0,"deposited":0}]}],"taxPaid":[{"bsr":"0000000","date":"YYYY-MM-DD","challan":"00000","amount":0}]}
Rules: amounts are plain numbers in rupees. Copy exactly what is printed; never infer or invent a row. Leave out anything that is not a deductor (TDS/TCS) row or a tax payment. Do not include the PAN or the taxpayer's name.`;

export function build26asRequest(
  provider: AiProvider,
  key: string,
  text: string,
  model?: string,
): AiHttp {
  return buildAiChat(provider, key, AI_26AS, text.slice(0, 40_000), model);
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const str = (v: unknown, n: number) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const iso = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

export function parse26asAi(provider: AiProvider, json: unknown): Form26as {
  const p = aiJson(provider, json) as {
    fy?: unknown;
    deductors?: unknown;
    taxPaid?: unknown;
  } | null;
  const deductors: Deductor[] = [];
  for (const r of (Array.isArray(p?.deductors) ? p!.deductors : []).slice(0, 300) as Record<
    string,
    unknown
  >[]) {
    const tan = str(r.tan, 10).toUpperCase();
    const paid = num(r.paid);
    const tax = num(r.tax);
    if (!new RegExp(`^${TAN}$`).test(tan) || paid === null || tax === null) continue;
    const txns: TdsTxn[] = [];
    for (const x of (Array.isArray(r.txns) ? r.txns : []).slice(0, 500) as Record<
      string,
      unknown
    >[]) {
      const tp = num(x.paid);
      const tt = num(x.tax);
      const section = str(x.section, 10).toUpperCase();
      if (tp === null || tt === null || !/^[0-9]{3}[A-Z0-9()]{0,6}$/.test(section)) continue;
      txns.push({
        section,
        txnDate: iso(x.txnDate),
        status: str(x.status, 2) || null,
        bookingDate: iso(x.bookingDate),
        paid: tp,
        tax: tt,
        deposited: num(x.deposited) ?? tt,
      });
    }
    deductors.push({
      name: str(r.name, 120) || tan,
      tan,
      paid,
      tax,
      deposited: num(r.deposited) ?? tax,
      txns,
    });
  }
  const taxPaid: TaxPaid[] = [];
  for (const r of (Array.isArray(p?.taxPaid) ? p!.taxPaid : []).slice(0, 200) as Record<
    string,
    unknown
  >[]) {
    const a = num(r.amount);
    if (a === null || a <= 0) continue;
    taxPaid.push({
      bsr: str(r.bsr, 7) || null,
      date: iso(r.date),
      challan: str(r.challan, 5) || null,
      amount: a,
    });
  }
  const fy = typeof p?.fy === 'string' && /^\d{4}-\d{2}$/.test(p.fy) ? p.fy : null;
  return {
    kind: '26as',
    source: 'ai',
    panLast4: null,
    fy,
    deductors,
    taxPaid,
    refunds: [],
    totalTds: Math.round(deductors.reduce((a, d) => a + d.tax, 0) * 100) / 100,
    warnings: ['Read by an AI service: check every figure against the statement.'],
  };
}

const AI_AIS = `You read the text of an Indian Annual Information Statement (AIS). Return ONLY JSON:
{"fy":"2025-26","lines":[{"description":"","source":"","amount":0,"tax":0}]}
Rules: one line per information entry (interest from savings bank, interest from deposit, dividend, purchase or sale of mutual fund units or securities, salary, rent, tax paid, refund). amount is the figure reported, in rupees, as a plain number; tax is tax deducted if shown, else 0. Copy what is printed; never invent a row; no PAN or name.`;

export function buildAisRequest(
  provider: AiProvider,
  key: string,
  text: string,
  model?: string,
): AiHttp {
  return buildAiChat(provider, key, AI_AIS, text.slice(0, 40_000), model);
}

export function parseAisAi(provider: AiProvider, json: unknown): Ais {
  const p = aiJson(provider, json) as { fy?: unknown; lines?: unknown } | null;
  const lines: AisLine[] = [];
  for (const r of (Array.isArray(p?.lines) ? p!.lines : []).slice(0, 2000) as Record<
    string,
    unknown
  >[]) {
    const a = num(r.amount);
    const description = str(r.description, 200);
    if (a === null || a <= 0 || !description) continue;
    lines.push({
      category: aisCategory(description),
      description,
      source: str(r.source, 120),
      amount: a,
      tax: num(r.tax),
    });
  }
  const res = finishAis(lines, null, '', 'ai');
  res.fy = typeof p?.fy === 'string' && /^\d{4}-\d{2}$/.test(p.fy) ? p.fy : null;
  res.warnings.push('Read by an AI service: check every figure against the statement.');
  return res;
}

/** Which kind of statement a text is: AIS pages say "Annual Information Statement"; 26AS says "Form 26AS" or has deductor lines. */
export function sniffTaxFile(text: string): '26as' | 'ais' | 'unknown' {
  if (/annual information statement|taxpayer information summary/i.test(text)) return 'ais';
  if (/26AS|tax credit statement|TAN of Deductor/i.test(text)) return '26as';
  return 'unknown';
}

/** A message that carries a Form 26AS or an AIS: by its subject or the name of an attachment. */
export function looksLikeTaxFile(m: {
  subject: string;
  attachments: { filename: string }[];
}): boolean {
  if (m.attachments.length === 0) return false;
  const name = /26\s?AS|\bAIS\b|annual.?information|tax.?credit/i;
  return name.test(m.subject) || m.attachments.some((a) => name.test(a.filename));
}
