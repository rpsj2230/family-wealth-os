/**
 * The numbers a household can change in Settings > Money rules, described once: the words the person reads, the one-line
 * "what this changes", how the value is typed and where it lives in the saved configuration. The form, the save action and
 * the "still on built-in numbers" marker all read this, so they cannot drift apart. Pure: no database, no React.
 */
import { DEFAULT_CONFIG, type AppConfig } from '@fwos/core';

export type FieldKind =
  'int' | 'money' | 'pct' | 'pct4' | 'list' | 'emails' | 'check' | 'date' | 'decimal';

export interface FieldSpec {
  name: string;
  label: string;
  /** one line: what changes on screen when this number changes */
  hint: string;
  kind: FieldKind;
  /** where the value lives in the saved configuration */
  path: [section: keyof AppConfig, key: string];
  /** a short unit shown after the box: "days", "%", "₹" */
  unit?: string;
  /** allowed range of the typed number (in the units the person types) */
  min?: number;
  max?: number;
}

export type RuleGroup =
  | 'deposits'
  | 'reminders'
  | 'estimates'
  | 'inbox'
  | 'rates'
  | 'refunds'
  | 'harvest'
  | 'funds'
  | 'liquidity';

export interface GroupSpec {
  key: Exclude<RuleGroup, 'liquidity'>;
  /** the address of the card on the page: Settings > Money rules */
  id: string;
  title: string;
  purpose: string;
  fields: FieldSpec[];
}

export const RULE_GROUPS: RuleGroup[] = [
  'deposits',
  'reminders',
  'estimates',
  'inbox',
  'rates',
  'refunds',
  'harvest',
  'funds',
  'liquidity',
];

export const GROUP_TITLE: Record<RuleGroup, string> = {
  deposits: 'Deposits',
  reminders: 'Reminders',
  estimates: 'Estimated balances',
  inbox: 'Bank e-mail forwarding',
  rates: 'Interest-rate suggestions',
  refunds: 'Tax refunds on NRO interest',
  harvest: 'Tax-gain harvesting',
  funds: 'Fund history check',
  liquidity: 'When I need money',
};

export const CONFIG_GROUPS: GroupSpec[] = [
  {
    key: 'deposits',
    id: 'limits',
    title: 'Deposits',
    purpose: 'Insurance cover and when a maturing deposit starts to ask for attention.',
    fields: [
      {
        name: 'limit',
        label: 'Deposit insurance cover per ownership name, per bank',
        hint: 'Sets the insured and uninsured split on Accounts, Deposits and Home. Each name as written is insured separately: “Rupash”, “Ragini”, “Rupash & Ragini” and “Ragini & Rupash” are four names.',
        kind: 'money',
        path: ['deposits', 'insuranceLimit'],
        unit: '₹',
      },
      {
        name: 'alertDays',
        label: 'Maturity alerts, days before the date',
        hint: 'A deposit gets a reminder in the daily summary at each of these steps, for example 7, 15, 30.',
        kind: 'list',
        path: ['deposits', 'maturityAlertDays'],
        unit: 'days, separated by commas',
      },
      {
        name: 'soonDays',
        label: 'Call a deposit “maturing soon” within',
        hint: 'Decides which deposits are marked “soon” on Accounts, Deposits and the daily summary.',
        kind: 'int',
        path: ['reminders', 'maturitySoonDays'],
        unit: 'days',
      },
    ],
  },
  {
    key: 'reminders',
    id: 'reminders',
    title: 'Reminders',
    purpose:
      'How far ahead the daily summary and Home look for policies, tasks and dated events, what “this month” means on Home, and when Home flags a bank.',
    fields: [
      {
        name: 'policyDays',
        label: 'Policy renewals and end dates, days ahead',
        hint: 'Policies renewing or ending inside this window appear in the daily summary.',
        kind: 'int',
        path: ['reminders', 'policyDays'],
        unit: 'days',
      },
      {
        name: 'taskDays',
        label: 'Tasks due within',
        hint: 'Tasks due inside this window appear in the daily summary and on Home.',
        kind: 'int',
        path: ['reminders', 'taskDays'],
        unit: 'days',
      },
      {
        name: 'harvestMonth',
        label: 'Tax-harvest reminder: month (1 to 12)',
        hint: 'With the day below, the date from which the summary reminds you to use the tax-free gain before 31 March.',
        kind: 'int',
        path: ['reminders', 'harvestMonth'],
        min: 1,
        max: 12,
      },
      {
        name: 'harvestDay',
        label: 'Tax-harvest reminder: day (1 to 28)',
        hint: 'The day of that month.',
        kind: 'int',
        path: ['reminders', 'harvestDay'],
        min: 1,
        max: 28,
      },
      {
        name: 'changeDays',
        label: 'Home: “this month” compares with this many days ago',
        hint: 'Sets the month change in the headline of Home, the “What changed” list and the “Last N days” column of the profit table.',
        kind: 'int',
        path: ['home', 'changeDays'],
        unit: 'days',
        min: 7,
        max: 365,
      },
      {
        name: 'upcomingDays',
        label: 'Home: “Coming up” looks ahead',
        hint: 'Deposit maturities, policy dates, tasks, repayments and the end of the financial year inside this window are listed on Home.',
        kind: 'int',
        path: ['home', 'upcomingDays'],
        unit: 'days',
        min: 7,
        max: 730,
      },
      {
        name: 'bankShareWatch',
        label: 'Home: flag a bank holding more than',
        hint: 'When one bank holds more than this share of the money kept in banks, the risk list on Home marks it “watch”.',
        kind: 'pct',
        path: ['home', 'bankShareWatch'],
        unit: '% of bank money',
        min: 5,
        max: 100,
      },
    ],
  },
  {
    key: 'estimates',
    id: 'estimates',
    title: 'Estimated balances',
    purpose: 'How the app fills the gap between two bank updates.',
    fields: [
      {
        name: 'freshness',
        label: 'A balance counts as out of date after',
        hint: 'Balances older than this are marked out of date and listed on the Monthly update.',
        kind: 'int',
        path: ['estimates', 'freshnessDays'],
        unit: 'days',
      },
      {
        name: 'sipStopped',
        label: 'A SIP is shown as stopped when no instalment has come for',
        hint: 'Read from a fund statement: when the last instalment on it is older than this at the date the statement ends, the SIP is marked stopped, dated from that last instalment. Monthly SIPs: a little over a month, 45 by default.',
        kind: 'int',
        path: ['estimates', 'sipStoppedAfterDays'],
        unit: 'days',
      },
      {
        name: 'savingsRate',
        label: 'Savings interest assumed when no rate is known',
        hint: 'Estimating today’s balance of a savings account uses, in this order: the rate set on the account, then the Rates list for its bank (NRE or NRO, and the slab its balance falls in), then this figure.',
        kind: 'pct',
        path: ['estimates', 'savingsRate'],
        unit: '% a year',
      },
      {
        name: 'tdsRate',
        label: 'Tax deducted at source on interest, assumed',
        hint: 'Taken off the interest in the same estimate. Leave 0 for NRE accounts.',
        kind: 'pct',
        path: ['estimates', 'interestTdsRate'],
        unit: '%',
      },
      {
        name: 'includeSip',
        label: 'Add active monthly fund investments (SIPs) to fund estimates',
        hint: 'Includes instalments made since the last recorded value in a fund’s estimated worth.',
        kind: 'check',
        path: ['estimates', 'includeSip'],
      },
    ],
  },
  {
    key: 'inbox',
    id: 'inbox-forwarding',
    title: 'Bank e-mail forwarding',
    purpose: 'Your own mailboxes that forward the banks’ e-mails to the app.',
    fields: [
      {
        name: 'trustedForwarders',
        label: 'Addresses you forward from',
        hint: 'The bank writes to your mailbox and a filter forwards it here. A message from one of these addresses is read as a forward: the bank is recognised by the original sender inside it, so a balance is recorded by itself instead of waiting for you. Up to 10 addresses, separated by commas, for example yours and Ragini’s.',
        kind: 'emails',
        path: ['inbox', 'trustedForwarders'],
        unit: 'e-mail addresses, separated by commas',
      },
    ],
  },
  {
    key: 'rates',
    id: 'rate-rules',
    title: 'Interest-rate suggestions',
    purpose: 'When the Rates page should suggest moving money, and what it assumes.',
    fields: [
      {
        name: 'rateGap',
        label: 'Suggest a move only if the after-tax rate is better by',
        hint: 'Smaller differences are not worth the effort and are not suggested.',
        kind: 'pct',
        path: ['rates', 'minRateGap'],
        unit: 'percentage points',
      },
      {
        name: 'rateGain',
        label: '…and it earns at least this much more a year',
        hint: 'A suggestion needs both the rate gap and this amount.',
        kind: 'money',
        path: ['rates', 'minAnnualGain'],
        unit: '₹',
      },
      {
        name: 'nroTax',
        label: 'Tax on NRO interest',
        hint: 'Compares NRO and NRE deposits after tax. NRE interest is not taxed in India.',
        kind: 'pct',
        path: ['rates', 'nroTaxRate'],
        unit: '%',
      },
      {
        name: 'nmMaxTerm',
        label: 'New money: longest deposit term',
        hint: 'No option on New money uses a deposit longer than this.',
        kind: 'int',
        path: ['rates', 'maxTermMonths'],
        unit: 'months',
      },
      {
        name: 'nmBalancedTerm',
        label: 'New money: longest term for the balanced and safest options',
        hint: 'A shorter limit keeps more money free sooner.',
        kind: 'int',
        path: ['rates', 'balancedTermMonths'],
        unit: 'months',
      },
      {
        name: 'nmFlexibleTerm',
        label: 'New money: longest term for the flexible option',
        hint: 'The flexible option keeps most money in savings and short deposits.',
        kind: 'int',
        path: ['rates', 'flexibleTermMonths'],
        unit: 'months',
      },
      {
        name: 'nmLadder',
        label: 'New money: terms of the ladder',
        hint: 'The money for deposits is split equally over these terms, so part comes free at each step. Example: 6, 12, 24, 36.',
        kind: 'list',
        path: ['rates', 'ladderTermsMonths'],
        unit: 'months, separated by commas',
      },
      {
        name: 'nmBankShare',
        label: 'New money: most in one bank (balanced)',
        hint: 'Keeps one bank from holding more than this share of the new money.',
        kind: 'pct',
        path: ['rates', 'maxBankShare'],
        unit: '%',
      },
      {
        name: 'nmSafeShare',
        label: 'New money: most in one bank (safest)',
        hint: 'The safest option spreads wider than the balanced one.',
        kind: 'pct',
        path: ['rates', 'safeBankShare'],
        unit: '%',
      },
      {
        name: 'nmLiquid',
        label: 'New money: kept in savings (balanced, ladder, safest)',
        hint: 'The share you can withdraw any time.',
        kind: 'pct',
        path: ['rates', 'liquidShare'],
        unit: '%',
      },
      {
        name: 'nmFlexLiquid',
        label: 'New money: kept in savings (flexible)',
        hint: 'The flexible option keeps this share in savings.',
        kind: 'pct',
        path: ['rates', 'flexibleLiquidShare'],
        unit: '%',
      },
      {
        name: 'nmBuffer',
        label: 'New money: insurance room left free at each bank',
        hint: 'Interest is added to deposits, so part of the insurance limit is left unused. 10% means a bank gets at most 90% of the limit.',
        kind: 'pct',
        path: ['rates', 'insuranceBuffer'],
        unit: '%',
      },
      {
        name: 'nmMinPiece',
        label: 'New money: smallest deposit worth opening',
        hint: 'Pieces smaller than this are not suggested.',
        kind: 'money',
        path: ['rates', 'minPiece'],
        unit: '₹',
      },
      {
        name: 'rateMaxAmount',
        label: 'The most I will put with one bank',
        hint: 'Rates that apply only to amounts above this (for example a savings slab above ₹1 crore) are not read from bank pages and are not shown, so a rate you could never use does not become “the best rate”.',
        kind: 'money',
        path: ['rates', 'maxAmount'],
        unit: '₹',
      },
      {
        name: 'rateStale',
        label: 'A bank rate counts as old after',
        hint: 'Older rates are shown as old and not used for a suggestion without a warning.',
        kind: 'int',
        path: ['rates', 'staleDays'],
        unit: 'days',
      },
      {
        name: 'rateTenure',
        label: 'Usual term of a new deposit',
        hint: 'Used when renewing a deposit that has no obvious term.',
        kind: 'int',
        path: ['rates', 'defaultTenureMonths'],
        unit: 'months',
      },
      {
        name: 'rateLook',
        label: 'Look ahead for maturing deposits',
        hint: 'Deposits maturing inside this window get a “where to renew” suggestion.',
        kind: 'int',
        path: ['rates', 'fdLookaheadDays'],
        unit: 'days',
      },
      {
        name: 'rateBuffer',
        label: 'Keep this much in a savings account before suggesting a move',
        hint: 'Savings above this amount in a low-rate account are suggested for a better rate.',
        kind: 'money',
        path: ['rates', 'savingsBuffer'],
        unit: '₹',
      },
    ],
  },
  {
    key: 'refunds',
    id: 'refund-rules',
    title: 'Tax refunds on NRO interest',
    purpose: 'Decides whether tax withheld on NRO deposit interest is expected back when you file.',
    fields: [
      {
        name: 'incomeLimit',
        label: 'Income per person up to which no Indian tax is due',
        hint: 'While a person’s total stays below this, tax withheld on NRO interest is shown as a refund to claim.',
        kind: 'money',
        path: ['refunds', 'incomeLimit'],
        unit: '₹ a year',
      },
      {
        name: 'otherIncome',
        label: 'Other taxable Indian income per person (rent, dividends)',
        hint: 'Counted with the NRO interest against the limit above.',
        kind: 'money',
        path: ['refunds', 'otherIncome'],
        unit: '₹ a year',
      },
    ],
  },
  {
    key: 'harvest',
    id: 'harvest-rules',
    title: 'Tax-gain harvesting',
    purpose: 'What the automatic plan on the Tax page counts and leaves out.',
    fields: [
      {
        name: 'minSell',
        label: 'Smallest sale worth suggesting',
        hint: 'Smaller sales are left out of the harvest plan.',
        kind: 'money',
        path: ['harvest', 'minSellAmount'],
        unit: '₹',
      },
      {
        name: 'margin',
        label: 'Extra months of holding before a fund counts as long-term',
        hint: 'A safety margin on top of the holding period in Tax rules.',
        kind: 'int',
        path: ['harvest', 'holdingMarginMonths'],
        unit: 'months',
      },
      {
        name: 'exitLoadPct',
        label: 'Usual exit load on units sold early',
        hint: 'Charged against units sold inside the period below.',
        kind: 'pct',
        path: ['harvest', 'exitLoadPct'],
        unit: '%',
      },
      {
        name: 'exitLoadDays',
        label: '…for this many days from each purchase',
        hint: 'Use 0 if your funds charge no exit load.',
        kind: 'int',
        path: ['harvest', 'exitLoadDays'],
        unit: 'days',
      },
      {
        name: 'sttPct',
        label: 'Transaction tax on selling equity-fund units',
        hint: 'Deducted from the gain in the plan’s cost estimate.',
        kind: 'pct4',
        path: ['harvest', 'sttPct'],
        unit: '%',
      },
      {
        name: 'stampPct',
        label: 'Stamp duty on buying fund units',
        hint: 'Counted when a harvest sells and buys back.',
        kind: 'pct4',
        path: ['harvest', 'stampDutyPct'],
        unit: '%',
      },
      {
        name: 'orderBuffer',
        label: 'Place orders this many days before 31 March',
        hint: 'An order after the cut-off time, or on a holiday, is priced on the next working day, which can fall in the next year.',
        kind: 'int',
        path: ['harvest', 'orderBufferDays'],
        unit: 'days',
      },
      {
        name: 'otherLong',
        label: 'Months before international, gold and fund-of-funds units are long-term',
        hint: 'Sets the short-term and long-term split on those funds’ pages. These funds have no yearly tax-free allowance.',
        kind: 'int',
        path: ['harvest', 'otherLongMonths'],
        unit: 'months',
        min: 1,
        max: 120,
      },
      {
        name: 'skipSip',
        label: 'Leave out funds with an active monthly investment',
        hint: 'Their newest units may still be short-term, so they are skipped.',
        kind: 'check',
        path: ['harvest', 'skipActiveSip'],
      },
      {
        name: 'nri',
        label: 'Non-resident: tax is withheld when units are redeemed',
        hint: 'Shows the withheld tax and the refund to claim, instead of assuming no tax is taken.',
        kind: 'check',
        path: ['harvest', 'nri'],
      },
    ],
  },
  {
    key: 'funds',
    id: 'fund-history',
    title: 'Fund history check',
    purpose:
      'How far back every fund’s transactions should go, and how exactly they must add up to the units held.',
    fields: [
      {
        name: 'historyFrom',
        label: 'Transactions should be on file from',
        hint: 'On Investments, a person whose earliest transaction is later than this, while funds started earlier, is asked for an earlier statement.',
        kind: 'date',
        path: ['funds', 'historyFrom'],
      },
      {
        name: 'unitTolerance',
        label: 'Units a history may be out by',
        hint: 'A fund whose transactions lead to a unit count further away than this from the recorded count is flagged “Doesn’t match”. Statements round units to three decimals.',
        kind: 'decimal',
        path: ['funds', 'unitTolerance'],
        unit: 'units',
        min: 0,
        max: 1,
      },
      {
        name: 'moneyTolerance',
        label: 'Rupees the invested amount may be out by',
        hint: 'The invested amount worked out from the transactions is compared with the recorded one; a larger difference is shown on the fund’s page.',
        kind: 'money',
        path: ['funds', 'moneyTolerance'],
        unit: '₹',
        max: 1000,
      },
    ],
  },
];

const pctOf = (x: number) => Math.round(x * 1e4) / 100;
const pct4Of = (x: number) => Math.round(x * 1e6) / 1e4;

function valueAt(c: AppConfig, f: FieldSpec): string | boolean {
  const v = (c[f.path[0]] as unknown as Record<string, unknown>)[f.path[1]];
  switch (f.kind) {
    case 'check':
      return v === true;
    case 'list':
    case 'emails':
      return Array.isArray(v) ? v.join(', ') : '';
    case 'date':
    case 'decimal':
      return String(v);
    case 'pct':
      return String(pctOf(Number(v)));
    case 'pct4':
      return String(pct4Of(Number(v)));
    default:
      return String(v);
  }
}

/** The text each box starts with, for one group, taken from the saved (or built-in) configuration. */
export function groupValues(group: GroupSpec, c: AppConfig): Record<string, string | boolean> {
  return Object.fromEntries(group.fields.map((f) => [f.name, valueAt(c, f)]));
}

/** True when every number of the group is still the built-in one. */
export function groupIsDefault(group: GroupSpec, c: AppConfig): boolean {
  const mine = groupValues(group, c);
  const base = groupValues(group, DEFAULT_CONFIG);
  return group.fields.every((f) => mine[f.name] === base[f.name]);
}

export const liquidityIsDefault = (c: AppConfig) =>
  JSON.stringify(c.liquidity) === JSON.stringify(DEFAULT_CONFIG.liquidity);

/**
 * Which groups the household has looked at and saved. The saved document carries a `confirmed` list. A document saved before
 * that list existed has none: a group counts as confirmed there when it differs from the built-in numbers.
 */
export function confirmedGroups(raw: unknown, c: AppConfig): RuleGroup[] {
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o) return [];
  if (Array.isArray(o.confirmed))
    return RULE_GROUPS.filter((g) => (o.confirmed as unknown[]).includes(g));
  return RULE_GROUPS.filter((g) =>
    g === 'liquidity'
      ? !liquidityIsDefault(c)
      : !groupIsDefault(
          CONFIG_GROUPS.find((x) => x.key === g)!,
          c,
        ),
  );
}

/** A real calendar date written 2021-01-01. */
const isIsoDate = (text: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const t = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === text;
};

/** Reads a typed number: "₹ 5,00,000" and "5 00 000" are accepted; anything else is not a number. */
export function parseNumber(text: string): number | null {
  const v = text.replace(/[₹,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
}

export type GroupParse =
  { ok: true; raw: Record<string, Record<string, unknown>> } | { ok: false; message: string };

/**
 * Turns what was typed in one group into the part of the configuration it owns. A box that is not a number is an error that
 * names the box, never a quiet fall-back to the built-in value.
 */
export function parseGroup(group: GroupSpec, get: (name: string) => string | null): GroupParse {
  const raw: Record<string, Record<string, unknown>> = {};
  for (const f of group.fields) {
    const [section, key] = f.path;
    const bucket = (raw[section] ??= {});
    const text = (get(f.name) ?? '').trim();
    if (f.kind === 'check') {
      bucket[key] = get(f.name) === 'on';
      continue;
    }
    if (f.kind === 'emails') {
      const list = text
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map((x) => x.toLowerCase());
      const bad = list.find((x) => !/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(x));
      if (bad || list.length > 10)
        return {
          ok: false,
          message: bad
            ? `${f.label}: “${bad}” is not an e-mail address.`
            : `${f.label}: at most 10 addresses.`,
        };
      bucket[key] = [...new Set(list)];
      continue;
    }
    if (f.kind === 'list') {
      const days = text
        .split(/[\s,;]+/)
        .filter(Boolean)
        .map(Number);
      if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 365))
        return {
          ok: false,
          message: `${f.label}: whole numbers between 1 and 365, separated by commas.`,
        };
      bucket[key] = days;
      continue;
    }
    if (f.kind === 'date') {
      if (!isIsoDate(text))
        return { ok: false, message: `${f.label}: a date written like 2021-01-01.` };
      bucket[key] = text;
      continue;
    }
    const n = parseNumber(text);
    const lo = f.min ?? 0;
    if (n === null || n < lo || (f.max !== undefined && n > f.max))
      return {
        ok: false,
        message: `${f.label}: enter a number${f.max !== undefined ? ` from ${lo} to ${f.max}` : `, ${lo} or more`}.`,
      };
    bucket[key] = f.kind === 'pct' || f.kind === 'pct4' ? n / 100 : n;
  }
  return { ok: true, raw };
}

/** Puts the group's part over the saved document, keeping everything else (and the other groups) as it was. */
export function mergeGroup(
  prior: unknown,
  part: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const base =
    prior && typeof prior === 'object' && !Array.isArray(prior)
      ? { ...(prior as Record<string, unknown>) }
      : {};
  for (const [section, values] of Object.entries(part)) {
    const old = base[section];
    base[section] = {
      ...(old && typeof old === 'object' && !Array.isArray(old) ? (old as object) : {}),
      ...values,
    };
  }
  return base;
}

/** The stored document gets the list of confirmed groups written beside the numbers. */
export function withConfirmed(
  clean: AppConfig,
  prior: unknown,
  priorConfig: AppConfig,
  group: RuleGroup,
): AppConfig & { confirmed: RuleGroup[] } {
  const now = new Set<RuleGroup>(confirmedGroups(prior, priorConfig));
  now.add(group);
  return { ...clean, confirmed: RULE_GROUPS.filter((g) => now.has(g)) };
}
