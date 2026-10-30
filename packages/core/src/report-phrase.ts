/**
 * Reads a short phrase ("Ragini's FDs maturing in the next 90 days above 5 lakh", "SIPs last FY by month", "realised gains this
 * year compared") into a report query: the template, the period, a person, amounts, plan, option, currency, a bank, a grouping and
 * whether to compare. It never runs anything by itself: the result is shown as filters the person reads and changes before the
 * report runs, with the words it did not understand listed.
 *
 * Rule-based and pure: no AI, no I/O. Unknown words are reported, never guessed at.
 */
import type { CentreQuery, GroupKey, TemplateKey } from './report-centre';
import type { ReportPeriodKey } from './report-period';

export interface PhraseResult {
  query: CentreQuery;
  /** what was understood, in words, in the order found */
  understood: string[];
  /** words that meant nothing to the reader */
  unknown: string[];
}

const TEMPLATE_WORDS: [RegExp, TemplateKey, string][] = [
  [/\bnet\s*worth\b|\bwealth\b/, 'networth', 'Net worth'],
  [/\b(realis|realiz)ed\b|\bbooked\b|\bcapital gains?\b|\bsold\b/, 'realised', 'Booked profit'],
  [
    /\bsips?\b|\bcontributions?\b|\bput in\b|\binvested\b/,
    'contributions',
    'SIPs and contributions',
  ],
  [
    /\btransactions?\b|\bpurchases?\b|\bbuys?\b|\bredemptions?\b|\bsales?\b|\bswitch(es)?\b/,
    'transactions',
    'Investment transactions',
  ],
  [/\bmatur(e|es|ing|ity|ities)\b/, 'maturities', 'Deposit maturities'],
  [/\bf\.?d\.?s?\b|\bfixed deposits?\b|\bdeposits?\b/, 'deposits', 'Fixed deposits'],
  [/\b(mutual )?funds?\b|\bmfs?\b|\bportfolio\b/, 'funds', 'Mutual funds'],
  [
    /\bsgd\b|\busd\b|\bcurrenc(y|ies)\b|\bforex\b|\bfx\b|\bforeign\b/,
    'currency',
    'SGD and other currencies',
  ],
  [/\bcash\b|\bsavings?\b|\bbank balances?\b|\bbalances?\b/, 'cash', 'Cash and bank'],
  [/\blent\b|\bloans? given\b|\breceivables?\b|\bowed\b/, 'receivables', 'Money lent'],
  [/\bgoals?\b/, 'goals', 'Goal funding'],
  [/\bstale\b|\bout of date\b|\bquality\b|\bmissing\b|\bestimated\b/, 'quality', 'Data quality'],
  [/\btax\b|\b112a\b|\b26as\b|\bais\b/, 'tax', 'Tax and capital gains'],
  [/\bperformance\b|\breturns?\b|\bxirr\b|\bbenchmark\b/, 'performance', 'Performance'],
  [/\bretire(ment)?\b/, 'retirement', 'Retirement readiness'],
  [
    /\binsurance\b|\bpolic(y|ies)\b|\bpension\b|\bnps\b|\bproperty\b/,
    'insurance',
    'Insurance, pension and property',
  ],
  [/\bholdings?\b|\beverything\b|\ball assets\b|\bassets\b/, 'holdings', 'All holdings'],
];

const PERIOD_WORDS: [RegExp, ReportPeriodKey, string][] = [
  [/\bnext (12 months|year)\b/, 'next-12m', 'Next 12 months'],
  [/\bnext (90 days|3 months|quarter)\b/, 'next-90', 'Next 90 days'],
  [/\bnext (30 days|month)\b/, 'next-30', 'Next 30 days'],
  [/\bnext (7 days|week)\b/, 'next-7', 'Next 7 days'],
  [/\b(this|current) (fy|financial year)\b/, 'this-fy', 'This financial year'],
  [/\b(last|previous|prior) (fy|financial year)\b/, 'last-fy', 'Last financial year'],
  [/\bfy ?to date\b|\bfytd\b/, 'fytd', 'Financial year to date'],
  [/\byear to date\b|\bytd\b/, 'ytd', 'Year to date'],
  [/\b(this|current) quarter\b/, 'this-quarter', 'This quarter'],
  [/\b(last|previous) quarter\b/, 'last-quarter', 'Last quarter'],
  [/\b(this|current) month\b/, 'this-month', 'This month'],
  [/\b(last|previous) month\b/, 'last-month', 'Last month'],
  [/\b(this|current) week\b/, 'this-week', 'This week'],
  [/\b(last|previous) week\b/, 'last-week', 'Last week'],
  [/\b(this|current) (calendar )?year\b/, 'this-year', 'This calendar year'],
  [/\b(last|previous) (calendar )?year\b/, 'last-year', 'Last calendar year'],
  [/\blast (12 months|twelve months)\b/, 'last-12m', 'Last 12 months'],
  [/\blast 90 days\b|\blast 3 months\b/, 'last-90', 'Last 90 days'],
  [/\blast 30 days\b/, 'last-30', 'Last 30 days'],
  [/\blast 7 days\b/, 'last-7', 'Last 7 days'],
  [
    /\b(since (inception|the start|the beginning)|all time|ever)\b/,
    'inception',
    'Since the first record',
  ],
  [/\byesterday\b/, 'yesterday', 'Yesterday'],
  [/\btoday\b/, 'today', 'Today'],
];

const GROUP_WORDS: [RegExp, GroupKey][] = [
  [/\b(by|per|each) month\b|\bmonthly\b|\bmonth.?wise\b/, 'month'],
  [/\b(by|per|each) quarter\b|\bquarterly\b/, 'quarter'],
  [/\b(by|per|each) (fy|financial year)\b/, 'fy'],
  [/\b(by|per|each) (calendar )?year\b|\byearly\b|\bannual\b/, 'year'],
  [/\b(by|per|each) bank\b|\bbank.?wise\b/, 'bank'],
  [/\b(by|per|each) (person|owner|member)\b/, 'owner'],
  [/\b(by|per|each) (fund house|amc)\b/, 'amc'],
  [/\b(by|per|each) (scheme|fund)\b|\bfund.?wise\b/, 'fund'],
  [/\b(by|per|each) (category|type of fund)\b/, 'category'],
  [/\b(by|per|each) (type|kind of transaction)\b/, 'kind'],
  [/\b(by|per|each) currency\b/, 'currency'],
  [/\b(by|per|each) plan\b/, 'plan'],
  [/\b(by|per|each) option\b/, 'option'],
  [/\b(by|per|each) (kind|class|asset class)\b/, 'cls'],
];

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** "5 lakh", "2.5L", "1 cr", "50k", "75,000" → rupees. */
export function readAmount(s: string): number | null {
  const m = /^(\d[\d,]*(?:\.\d+)?)\s*(lakhs?|lacs?|l|crores?|cr|k|thousand)?$/.exec(
    s.trim().toLowerCase(),
  );
  if (!m) return null;
  const n = Number(m[1]!.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const unit = m[2] ?? '';
  const mult = /^(lakh|lac|l)/.test(unit)
    ? 100_000
    : /^(crore|cr)/.test(unit)
      ? 10_000_000
      : /^(k|thousand)/.test(unit)
        ? 1_000
        : 1;
  return Math.round(n * mult);
}

const AMOUNT = String.raw`(\d[\d,]*(?:\.\d+)?\s*(?:lakhs?|lacs?|l|crores?|cr|k|thousand)?)`;
const inr = (n: number) => `₹${n.toLocaleString('en-IN')}`;

const STOP = new Set(
  'a an the of in on for to from and or me my our show give list what is are was were all with how much many over under below above between than more less at least most by per each whose who s please report reports'.split(
    ' ',
  ),
);

export function readPhrase(
  text: string,
  ctx: { today: string; people: Record<string, string>; banks?: string[]; amcs?: string[] },
): PhraseResult {
  let s = ` ${text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9₹.,'\s-]/g, ' ')
    .replace(/\s+/g, ' ')} `;
  const understood: string[] = [];
  const used: string[] = [];
  const take = (re: RegExp) => {
    const m = re.exec(s);
    if (!m) return null;
    used.push(m[0]);
    s = s.replace(m[0], ' ');
    return m;
  };
  const query: CentreQuery = { template: 'holdings', period: 'today' };

  // amounts first, so "5 lakh" is not read as anything else
  const between = take(new RegExp(String.raw`\bbetween ₹?${AMOUNT} and ₹?${AMOUNT}`));
  if (between) {
    const a = readAmount(between[1]!);
    const b = readAmount(between[2]!);
    if (a !== null && b !== null) {
      query.min = Math.min(a, b);
      query.max = Math.max(a, b);
      understood.push(`Amount ${inr(query.min)} to ${inr(query.max)}`);
    }
  }
  const above = take(
    new RegExp(String.raw`\b(above|over|more than|at least|greater than|>)\s*₹?${AMOUNT}`),
  );
  if (above) {
    const a = readAmount(above[2]!);
    if (a !== null) {
      query.min = a;
      understood.push(`Amount at least ${inr(a)}`);
    }
  }
  const below = take(new RegExp(String.raw`\b(below|under|less than|at most|<)\s*₹?${AMOUNT}`));
  if (below) {
    const a = readAmount(below[2]!);
    if (a !== null) {
      query.max = a;
      understood.push(`Amount at most ${inr(a)}`);
    }
  }

  // a named financial year ("fy 2025-26", "fy25", "fy 2025") or month ("march 2026")
  const fy = take(/\bfy ?(\d{2,4})(?:[-/](\d{2,4}))?\b/);
  if (fy) {
    let y = Number(fy[1]);
    if (y < 100) y += 2000;
    // "fy25" and "fy 2025" are read as the year that starts in April 2025 only when a second year follows; alone, as the year ending then
    const start = fy[2] ? y : fy[1]!.length === 4 ? y : y - 1;
    query.period = 'custom';
    query.from = `${start}-04-01`;
    query.to = `${start + 1}-03-31`;
    understood.push(`FY ${start}-${String((start + 1) % 100).padStart(2, '0')}`);
  } else {
    const month = take(new RegExp(String.raw`\b(${MONTHS.join('|')})[a-z]* (\d{4})\b`));
    if (month) {
      const m = MONTHS.indexOf(month[1]!.slice(0, 3)) + 1;
      const y = Number(month[2]);
      const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
      query.period = 'custom';
      query.from = `${y}-${String(m).padStart(2, '0')}-01`;
      query.to = last;
      understood.push(`${month[1]!.charAt(0).toUpperCase()}${month[1]!.slice(1, 3)} ${y}`);
    } else {
      const lastN = take(/\b(last|past|next) (\d{1,4}) days\b/);
      if (lastN && !['7', '30', '90'].includes(lastN[2]!)) {
        const n = Number(lastN[2]);
        const d = new Date(`${ctx.today}T00:00:00Z`);
        const shift = (k: number) => {
          const x = new Date(d);
          x.setUTCDate(x.getUTCDate() + k);
          return x.toISOString().slice(0, 10);
        };
        query.period = 'custom';
        if (lastN[1] === 'next') {
          query.from = ctx.today;
          query.to = shift(n);
        } else {
          query.from = shift(-(n - 1));
          query.to = ctx.today;
        }
        understood.push(`${lastN[1] === 'next' ? 'Next' : 'Last'} ${n} days`);
      } else {
        if (lastN) s = ` ${lastN[0].replace('past', 'last')} ${s}`;
        for (const [re, key, label] of PERIOD_WORDS) {
          if (take(re)) {
            query.period = key;
            understood.push(label);
            break;
          }
        }
      }
    }
  }

  for (const [re, key] of GROUP_WORDS)
    if (take(re)) {
      query.group = key;
      understood.push(
        `Grouped by ${key === 'cls' ? 'kind' : key === 'fy' ? 'financial year' : key === 'amc' ? 'fund house' : key === 'owner' ? 'person' : key}`,
      );
      break;
    }

  if (take(/\b(compare[ds]?|comparison|vs\.?|versus|against (the )?(previous|last|prior))\b/)) {
    query.compare = true;
    understood.push('Compared with the period before');
  }

  // a person, by first name (possessive allowed)
  for (const [id, name] of Object.entries(ctx.people)) {
    const first = name.toLowerCase().split(/\s+/)[0]!;
    if (
      first &&
      take(new RegExp(String.raw`\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}('s)?\b`))
    ) {
      query.owner = id;
      understood.push(`Person: ${name}`);
      break;
    }
  }
  for (const b of ctx.banks ?? []) {
    const key = b.toLowerCase().replace(/\s+bank$/, '');
    if (
      key.length >= 2 &&
      take(new RegExp(String.raw`\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( bank)?\b`))
    ) {
      query.bank = b;
      understood.push(`Bank: ${b}`);
      break;
    }
  }
  for (const a of ctx.amcs ?? []) {
    const key = a.toLowerCase().replace(/\s+(mutual fund|amc|asset management.*)$/, '');
    if (
      key.length >= 3 &&
      take(new RegExp(String.raw`\b${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\b`))
    ) {
      query.amc = a;
      understood.push(`Fund house: ${a}`);
      break;
    }
  }
  if (take(/\bdirect\b/)) {
    query.plan = 'direct';
    understood.push('Plan: Direct');
  } else if (take(/\bregular\b/)) {
    query.plan = 'regular';
    understood.push('Plan: Regular');
  }
  if (take(/\b(idcw|dividend)\b/)) {
    query.option = 'idcw';
    understood.push('Option: IDCW');
  } else if (take(/\bgrowth\b/)) {
    query.option = 'growth';
    understood.push('Option: Growth');
  }
  // a currency also chooses the currency report unless another one is named
  const cur = /\b(sgd|usd|inr|gbp|eur|aed)\b/.exec(s);
  if (cur) query.currency = cur[1]!.toUpperCase();

  // the template last: what is left names it ("FDs maturing" is maturities, not deposits)
  let picked: (typeof TEMPLATE_WORDS)[number] | null = null;
  for (const t of TEMPLATE_WORDS) {
    if (t[0].test(s)) {
      picked = t;
      break;
    }
  }
  if (picked) {
    query.template = picked[1];
    understood.unshift(`Report: ${picked[2]}`);
    // take every template word, so none is left as unknown
    for (const [re] of TEMPLATE_WORDS) while (take(re));
    if (picked[1] === 'cash' && query.currency && query.currency !== 'INR')
      understood.push(`Currency: ${query.currency}`);
  }
  if (query.currency) {
    take(new RegExp(String.raw`\b${query.currency.toLowerCase()}\b`));
    if (!picked) {
      query.template = 'currency';
      understood.unshift('Report: SGD and other currencies');
    }
  }
  // a period word on a report that does not use one is dropped, so the report is what it says
  if (
    ['holdings', 'cash', 'funds', 'currency', 'receivables', 'goals', 'quality'].includes(
      query.template,
    ) &&
    query.period !== 'today'
  ) {
    const i = understood.findIndex(
      (u) => u === labelOf(query.period) || /^(FY|Last|Next|[A-Z][a-z]{2} \d{4})/.test(u),
    );
    if (i >= 0) understood.splice(i, 1, `${understood[i]} (not used: this report is for today)`);
  }
  if (query.template === 'maturities' && query.period === 'today') query.period = 'next-90';
  if (
    query.template !== 'maturities' &&
    query.period === 'today' &&
    !['holdings', 'cash', 'funds', 'currency', 'receivables', 'goals', 'quality'].includes(
      query.template,
    )
  )
    query.period = 'this-fy';

  const unknown = s
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9₹]+|[^a-z0-9]+$/g, ''))
    .filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
  return { query, understood, unknown: [...new Set(unknown)] };
}

const labelOf = (k: ReportPeriodKey) => PERIOD_WORDS.find((p) => p[1] === k)?.[2] ?? '';
