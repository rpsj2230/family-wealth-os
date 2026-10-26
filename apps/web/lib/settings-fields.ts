/**
 * The numbers a household can change in Settings > Money rules, described once: the words the person reads, the one-line
 * "what this changes", how the value is typed and where it lives in the saved configuration. The form, the save action and
 * the "still on built-in numbers" marker all read this, so they cannot drift apart. Pure: no database, no React.
 */
import { DEFAULT_CONFIG, type AppConfig } from '@fwos/core';

export type FieldKind = 'int' | 'money' | 'pct' | 'pct4' | 'list' | 'check';

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
  'deposits' | 'reminders' | 'estimates' | 'rates' | 'refunds' | 'harvest' | 'liquidity';

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
  'rates',
  'refunds',
  'harvest',
  'liquidity',
];

export const GROUP_TITLE: Record<RuleGroup, string> = {
  deposits: 'Deposits',
  reminders: 'Reminders',
  estimates: 'Estimated balances',
  rates: 'Interest-rate suggestions',
  refunds: 'Tax refunds on NRO interest',
  harvest: 'Tax-gain harvesting',
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
      'How far ahead the daily summary looks for policies, tasks and the tax-harvest deadline.',
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
];

const pctOf = (x: number) => Math.round(x * 1e4) / 100;
const pct4Of = (x: number) => Math.round(x * 1e6) / 1e4;

function valueAt(c: AppConfig, f: FieldSpec): string | boolean {
  const v = (c[f.path[0]] as unknown as Record<string, unknown>)[f.path[1]];
  switch (f.kind) {
    case 'check':
      return v === true;
    case 'list':
      return Array.isArray(v) ? v.join(', ') : '';
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
