/**
 * The numbers a household can change in Settings > Money rules, described once: the words the person reads, the one-line
 * "what this changes", how the value is typed and where it lives in the saved configuration. The form, the save action and
 * the "still on built-in numbers" marker all read this, so they cannot drift apart. Pure: no database, no React.
 */
import {
  cleanSender,
  DEFAULT_CONFIG,
  parseBenchmarkRule,
  parsePlatformRule,
  parsePriceLine,
  type AppConfig,
} from '@fwos/core';

export type FieldKind =
  | 'int'
  | 'money'
  | 'pct'
  | 'pct4'
  | 'list'
  | 'emails'
  | 'lines'
  | 'senders'
  | 'platforms'
  | 'benchmarks'
  | 'words'
  | 'check'
  | 'date'
  | 'decimal';

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
  /** may be left empty (a date: "worked out for you") */
  optional?: boolean;
}

export type RuleGroup =
  | 'deposits'
  | 'reminders'
  | 'estimates'
  | 'trail'
  | 'inbox'
  | 'gmail'
  | 'ai'
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
  'trail',
  'inbox',
  'gmail',
  'ai',
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
  trail: 'Clubbing and money trail',
  inbox: 'Bank e-mail forwarding',
  gmail: 'Gmail statements',
  ai: 'AI prices',
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
        name: 'hideMaturedDays',
        label: 'Hide a matured deposit from the lists after (days)',
        hint: 'A deposit whose date passed longer ago than this leaves the Accounts and Monthly update lists (Show matured brings it back); a deposit past its date is never counted in totals.',
        kind: 'int',
        path: ['deposits', 'hideMaturedAfterDays'],
        unit: 'days',
        min: 1,
        max: 3650,
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
        name: 'growthYears',
        label: 'Money at work: project the corpus for this many years',
        hint: 'The table and graph on Money at work show every year from today to this many years ahead.',
        kind: 'int',
        path: ['growth', 'years'],
        unit: 'years',
      },
      {
        name: 'growthMargin',
        label: 'Money at work: “growing well” means beating inflation by at least',
        hint: 'After tax. Below inflation it is slow; between inflation and inflation plus this margin it is growing.',
        kind: 'pct',
        path: ['growth', 'goodMargin'],
        unit: 'points a year',
      },
      {
        name: 'freshness',
        label: 'A balance counts as out of date after',
        hint: 'Balances older than this are marked out of date and listed on the Monthly update.',
        kind: 'int',
        path: ['estimates', 'freshnessDays'],
        unit: 'days',
      },
      {
        name: 'sipMinInstalments',
        label: 'A SIP is recognised after this many instalments in a row',
        hint: 'Read from a fund statement or transactions file: a new, resumed or changed SIP is proposed only when at least this many similar instalments came one after the other, a regular gap apart. Whether a SIP has stopped is not a setting: it is judged from the SIP’s own pattern (its usual gap and how late it has been before). Raise this if one-off purchases are mistaken for a SIP.',
        kind: 'int',
        path: ['estimates', 'sipMinInstalments'],
        unit: 'instalments',
      },
      {
        name: 'historyStarts',
        label: 'A monthly tab is flagged when a deposit on it starts more than',
        hint: 'Import > History from all monthly tabs: a tab whose deposits start this many days after the month it is named for is probably a copy of a later month. It is not selected by default. 62 days by default.',
        kind: 'int',
        path: ['estimates', 'historyStartsAfterDays'],
        unit: 'days after its month',
      },
      {
        name: 'historyJumpFactor',
        label:
          'A line is not matched to an account whose balance next door is far from it: more than',
        hint: 'Import > History from all monthly tabs: when the account a line is taken to be had, in the tabs just before and after, balances very different from the line (this many times higher or lower, and by more than the amount below), the line is held back for you to decide. 50 times by default.',
        kind: 'decimal',
        path: ['estimates', 'historyJumpFactor'],
        unit: 'times',
        min: 2,
        max: 10000,
      },
      {
        name: 'historyJumpFloor',
        label: 'Differences smaller than this are never a jump',
        hint: 'Import > History from all monthly tabs: a balance that is out by less than this is not treated as a wild jump, whatever the ratio.',
        kind: 'money',
        path: ['estimates', 'historyJumpFloor'],
        unit: '₹',
      },
      {
        name: 'historyTieRatio',
        label: 'Of two accounts, the likelier one has a balance this many times closer',
        hint: 'Import > History from all monthly tabs: when order alone cannot tell which of two accounts a line is, the one whose balances in the neighbouring tabs are at least this many times closer is offered as the likely one (you still confirm it). 3 times by default.',
        kind: 'decimal',
        path: ['estimates', 'historyTieRatio'],
        unit: 'times',
        min: 1,
        max: 100,
      },
      {
        name: 'observedRateGap',
        label: 'Flag a savings account whose records grow this far from its rate',
        hint: 'Where an account has two balances recorded a month or more apart, the app works out the rate they imply. When it differs from the rate the account is valued at by more than this, Accounts says “earning about X% a year (from your records)”. It is only a pointer: money you added or took out is in those balances, so it never changes a figure.',
        kind: 'pct',
        path: ['estimates', 'observedRateGap'],
        unit: 'points a year',
        min: 0,
        max: 50,
      },
      {
        name: 'assumedGrowthProperty',
        label: 'Yearly growth assumed for property',
        hint: 'Property, pension accounts and other holdings kept by hand are held at the value last recorded (no growth is invented). Type a rate here to move them on between records; every figure built on it says “assumed”. 0 by default.',
        kind: 'pct',
        path: ['estimates', 'assumedGrowthProperty'],
        unit: '% a year',
        min: -20,
        max: 50,
      },
      {
        name: 'assumedGrowthRetirement',
        label: 'Yearly growth assumed for NPS and pension plans',
        hint: 'Same as above, for NPS and ULIP accounts. 0 by default.',
        kind: 'pct',
        path: ['estimates', 'assumedGrowthRetirement'],
        unit: '% a year',
        min: -20,
        max: 50,
      },
      {
        name: 'assumedGrowthOther',
        label: 'Yearly growth assumed for shares and everything else kept by hand',
        hint: 'Shares, money lent and other holdings with no price list. 0 by default.',
        kind: 'pct',
        path: ['estimates', 'assumedGrowthOther'],
        unit: '% a year',
        min: -20,
        max: 50,
      },
      {
        name: 'reconcileTolerance',
        label: 'Rebuilt history agrees with the workbook within',
        hint: 'Import > History: a month rebuilt by the app is said to agree with the workbook’s Summary tab when the totals are within this share of each other. 1% by default.',
        kind: 'pct',
        path: ['estimates', 'reconcileTolerance'],
        unit: '% of the total',
        min: 0,
        max: 100,
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
        name: 'savingsSlabIncremental',
        label: 'Savings slab rates apply to each part of the balance',
        hint: 'On: with 3% up to ₹5 L and 3.5% above it, a ₹10 L balance earns 3% on the first ₹5 L and 3.5% on the rest (incremental). Off: the whole balance earns the rate of the slab it falls in. A bank set on its own page overrides this.',
        kind: 'check',
        path: ['estimates', 'savingsSlabIncremental'],
      },
      {
        name: 'savingsCreditMonths',
        label: 'Savings interest is credited every',
        hint: '1, 3, 6 or 12 months. Indian banks credit savings interest every quarter (3). Until it is credited it is shown as accrued, and once credited it earns interest too.',
        kind: 'int',
        path: ['estimates', 'savingsCreditMonths'],
        unit: 'months',
        min: 1,
        max: 12,
      },
      {
        name: 'unexplainedTolerance',
        label: 'A new balance is explained when within',
        hint: 'When a new actual balance differs from the estimate by more than this, the difference is shown as “not yet explained” (never as profit or as money you added) until you say what it was.',
        kind: 'money',
        path: ['estimates', 'unexplainedTolerance'],
        unit: '₹',
      },
      {
        name: 'transferPairDays',
        label: 'A fall in one account and a rise in another are one transfer when within',
        hint: 'On Explain movements, when one of your accounts fell and another rose by the same sum within this many days, they are offered as one transfer between your own accounts, already chosen. Answering one clears both.',
        kind: 'int',
        path: ['estimates', 'transferPairDays'],
        unit: 'days',
        min: 0,
        max: 31,
      },
      {
        name: 'openingDate',
        label: 'Measure your own money and profit from',
        hint: 'Own money, lifetime profit and XIRR on own money start from net worth on this day (the opening position). Leave empty to start from the first day the holdings on file have a value.',
        kind: 'date',
        path: ['capital', 'openingDate'],
        optional: true,
      },
      {
        name: 'countProperty',
        label: 'Count property in net worth',
        hint: 'Off (the usual): property is shown on its own page but left out of net worth, own money, lifetime profit and every yearly return. Money you lent stays in. After changing this, rebuild the history (Import > History) so past months match.',
        kind: 'check',
        path: ['capital', 'countProperty'],
      },
      {
        name: 'reviewMinimum',
        label: 'Earlier months are listed for review when their unexplained money is over',
        hint: 'Explain movements > Earlier months lists the months whose money moved in or out with nothing to say what it was, largest first. Smaller months are left out of the list (they still count as your own money).',
        kind: 'money',
        path: ['capital', 'reviewMinimum'],
        unit: '₹',
      },
      {
        name: 'reviewMinimumPct',
        label: '…and over this share of net worth at the month’s start',
        hint: 'The larger of the two limits applies. A month below it is still counted as your own money (never as profit); it is only not asked about. 0 asks about every month over the rupee limit.',
        kind: 'pct',
        path: ['capital', 'reviewMinimumPct'],
        unit: '% of net worth',
        min: 0,
        max: 20,
      },
      {
        name: 'reviewPairMonths',
        label: 'Two months that cancel out are one transfer when within',
        hint: 'Money the monthly tabs show leaving in one month and arriving in the next (or within this many months) is a transfer between your own accounts recorded in two months: such a pair is shown apart, with nothing to answer.',
        kind: 'int',
        path: ['capital', 'reviewPairMonths'],
        unit: 'months',
        min: 0,
        max: 12,
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
    key: 'trail',
    id: 'trail',
    title: 'Clubbing and money trail',
    purpose:
      'The day money moved between you starts to count for clubbing, and the words the bank statements are read by.',
    fields: [
      {
        name: 'ownershipFrom',
        label: 'Count money moved between you for clubbing from',
        hint: 'Money trail: what each person held before this day is theirs. From this day, money moved from one person’s account to another’s is listed for clubbing, with the income it earns. Leave empty to count nothing yet.',
        kind: 'date',
        path: ['capital', 'ownershipFrom'],
        optional: true,
      },
      {
        name: 'stmtRentWords',
        label: 'Bank statements: words that mark rent from your tenant',
        hint: 'One per line: the tenant’s name as the bank writes it, or a reference the rent always carries. A credit with any of these is counted as rent, which is earnings (lifetime profit), not your own money.',
        kind: 'words',
        path: ['statements', 'rentWords'],
        unit: 'one per line',
        optional: true,
      },
      {
        name: 'stmtRemittanceWords',
        label: 'Bank statements: words that mark money sent from abroad',
        hint: 'One per line, a whole word or phrase. A credit with any of these (an inward remittance from Singapore, for example) is counted as your own money coming in.',
        kind: 'words',
        path: ['statements', 'remittanceWords'],
        unit: 'one per line',
        optional: true,
      },
      {
        name: 'trailRecentFirst',
        label: 'Money trail: money leaving an account is the latest money that came in',
        hint: 'Ticked: a payment out of an account is made of the money that arrived last (a transfer in on Monday and a deposit booked on Tuesday are the same money). Unticked: it is a share of everything in the account.',
        kind: 'check',
        path: ['statements', 'trailRecentFirst'],
      },
      {
        name: 'trailSmallest',
        label: 'Money trail: fold parts smaller than',
        hint: 'A trail lists every step down to this amount; smaller parts are added up into one “smaller parts” line. The summary of where the money started and where it is now always counts everything.',
        kind: 'money',
        path: ['statements', 'trailSmallest'],
        unit: '₹',
      },
      {
        name: 'trailDepth',
        label: 'Money trail: steps shown back or forward',
        hint: 'How far a trail follows the money from a line before it says “goes on”. Each step opens its own page, so the trail can always be followed further.',
        kind: 'int',
        path: ['statements', 'trailDepth'],
        unit: 'steps',
        min: 1,
        max: 200,
      },
      {
        name: 'trailSteps',
        label: 'Money trail: most steps on one page',
        hint: 'A trail that splits often stops listing new steps after this many; the summary still counts everything.',
        kind: 'int',
        path: ['statements', 'trailSteps'],
        unit: 'steps',
        min: 10,
        max: 2000,
      },
      {
        name: 'stmtReviewAbove',
        label: 'Bank statements: ask about a line no rule places when it is at least',
        hint: 'Smaller lines are counted without asking: a debit as spending, a credit as a small amount coming in (a refund, cashback). Larger ones wait on Transactions > Bank statements.',
        kind: 'money',
        path: ['statements', 'reviewAbove'],
        unit: '₹',
      },
      {
        name: 'stmtAutoTagUpTo',
        label: 'Bank statements: place a line from a known merchant without asking, up to',
        hint: 'A line naming a known merchant or kind of payment (Swiggy, IndiGo, MakeMyTrip, Amazon, a card bill, TDS, a refund, salary) is tagged and counted by its kind without asking, up to this amount. Larger ones are still asked, with the tag suggested.',
        kind: 'money',
        path: ['statements', 'autoTagUpTo'],
        unit: '₹',
      },
      {
        name: 'stmtAutoTagWordUpTo',
        label: 'Bank statements: the same for a line known only by a general word, up to',
        hint: 'A general word (hotel, pharmacy, school, restaurant) is less certain than a merchant’s own name, so it is trusted up to a lower amount.',
        kind: 'money',
        path: ['statements', 'autoTagWordUpTo'],
        unit: '₹',
      },
      {
        name: 'stmtAskLarge',
        label: 'Bank statements: ask me about large lines nothing explains',
        hint: 'Off (the default): such a line is placed by the best explanation and nothing waits for you: money to a person is money out, money back from someone you paid before is money back, money from a person is your own money coming in (never profit). Each line says it is a best guess, and can still be changed. On: such lines wait on Explain movements and in the daily e-mail.',
        kind: 'check',
        path: ['statements', 'askLarge'],
      },
      {
        name: 'stmtFundMatchDays',
        label: 'Bank statements: a debit matches a fund purchase in the CAS within',
        hint: 'A SIP or a purchase is debited a day or more before the units are allotted. A debit of the same amount within this many days of a purchase in the CAS is that purchase: money moved between your own holdings.',
        kind: 'int',
        path: ['statements', 'fundMatchDays'],
        unit: 'days',
        min: 0,
        max: 31,
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
      {
        name: 'forwardUtcOffsetHours',
        label: 'Your Gmail shows times in',
        hint: 'A forwarded alert carries the bank’s original time in your Gmail’s time zone. It decides which of two alerts on the same day is the later one, so the later balance is kept. Hours from UTC: Singapore 8, India 5.5.',
        kind: 'decimal',
        path: ['inbox', 'forwardUtcOffsetHours'],
        unit: 'hours from UTC',
        min: -12,
        max: 14,
      },
    ],
  },
  {
    key: 'gmail',
    id: 'gmail-statements',
    title: 'Gmail statements',
    purpose:
      'The daily scan of your Gmail for fund statements from CAMS, KFintech, NSDL and CDSL: read only, no AI.',
    fields: [
      {
        name: 'gmailEnabled',
        label: 'Read my fund statements from Gmail',
        hint: 'Switches the daily scan on or off. Off, the app does not open your Gmail for this at all.',
        kind: 'check',
        path: ['statementMail', 'enabled'],
      },
      {
        name: 'gmailSenders',
        label: 'Senders a statement may come from',
        hint: 'One per line: a domain such as camsonline.com (it covers its sub-domains) or one full address. Only the address in the From line counts, never the name shown. Add a domain when a statement arrives from one that is not listed; a message from any other address is never opened.',
        kind: 'senders',
        path: ['statementMail', 'senders'],
        unit: 'one domain or address per line',
      },
      {
        name: 'gmailFirstDays',
        label: 'First scan looks back',
        hint: 'How far back the very first scan reads, so last year’s statements are picked up. Statements already read are skipped.',
        kind: 'int',
        path: ['statementMail', 'firstDays'],
        unit: 'days',
        min: 1,
        max: 1500,
      },
      {
        name: 'gmailRegularDays',
        label: 'Every later scan looks back',
        hint: 'A short window is enough once the first scan is done; a statement that arrives late is still caught.',
        kind: 'int',
        path: ['statementMail', 'regularDays'],
        unit: 'days',
        min: 1,
        max: 400,
      },
      {
        name: 'gmailMaxMb',
        label: 'Largest PDF to download',
        hint: 'A PDF bigger than this is not downloaded and is listed as not read.',
        kind: 'int',
        path: ['statementMail', 'maxMb'],
        unit: 'MB',
        min: 1,
        max: 40,
      },
      {
        name: 'gmailMaxPerRun',
        label: 'Most statements read in one scan',
        hint: 'The oldest are read first; the rest wait for the next scan.',
        kind: 'int',
        path: ['statementMail', 'maxPerRun'],
        min: 1,
        max: 200,
      },
      {
        name: 'gmailGapHours',
        label: 'Do not scan more often than every',
        hint: 'The job starts several times a day; this keeps it to one scan a day. Pressing Scan now ignores it.',
        kind: 'int',
        path: ['statementMail', 'minGapHours'],
        unit: 'hours',
        min: 1,
        max: 168,
      },
      {
        name: 'gmailRequestDays',
        label: 'A requested statement is late after',
        hint: 'On Import > Fund statement, a statement you asked for that has not arrived after this many days is flagged and leaves a task.',
        kind: 'int',
        path: ['statementMail', 'requestWaitDays'],
        unit: 'days',
        min: 1,
        max: 60,
      },
      {
        name: 'feedSilentDays',
        label: 'Flag an account that has been silent for',
        hint: 'An account in use that has sent no alert, no e-mailed statement and no balance for this long is listed under Needed from you, with how to switch its alerts and e-statements on.',
        kind: 'int',
        path: ['statementMail', 'silentDays'],
        unit: 'days',
        min: 7,
        max: 400,
      },
      {
        name: 'feedGapDays',
        label: 'Check for movements no alert reported over the last',
        hint: 'Where a balance the bank reports does not follow from the alerts before it, the money that moved unreported is listed. The month’s e-statement then fills it in by itself.',
        kind: 'int',
        path: ['statementMail', 'gapDays'],
        unit: 'days',
        min: 7,
        max: 400,
      },
    ],
  },
  {
    key: 'ai',
    id: 'ai-prices',
    title: 'AI prices',
    purpose: 'What the AI is charged at, to show its cost on the AI cost page.',
    fields: [
      {
        name: 'aiUsdInr',
        label: 'Rupees per US dollar',
        hint: 'AI services bill in dollars; this turns the cost into rupees on the AI cost page.',
        kind: 'money',
        path: ['ai', 'usdInr'],
        unit: '₹ per $1',
      },
      {
        name: 'aiPrices',
        label: 'Price of each model, dollars per million tokens',
        hint: 'One line per model: model = input / output / cache read / cache write. A model id can end with * to cover a family (claude-haiku*), or start with * (*:free). Cache prices may be left out: they default to a tenth and a quarter more than the input price. Check the provider’s price page and change a line here when it changes; a model with no line is counted in tokens but not in money.',
        kind: 'lines',
        path: ['ai', 'prices'],
        unit: 'one line per model',
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
        name: 'buyBackDays',
        label: 'Buy the fund back this many working days after selling',
        hint: 'The sale money reaches your bank first (usually one to two working days). The harvest plan dates the buy-back this many working days after the sale.',
        kind: 'int',
        path: ['harvest', 'buyBackDays'],
        unit: 'days',
      },
      {
        name: 'reinvestDays',
        label: 'A buy-back within this many days of a sale is a reinvestment',
        hint: 'A purchase of the same fund this soon after a sale puts the sale money back: your own money and the yearly return on Home are not changed by it, even when the sale and the purchase fall in different months.',
        kind: 'int',
        path: ['harvest', 'reinvestDays'],
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
        name: 'navStaleDays',
        label: 'A fund price is stale after',
        hint: 'A fund whose latest official NAV is older than this is flagged “price of <date>, stale” wherever its value is shown. NAVs are published on business days, so 4 covers a long weekend.',
        kind: 'int',
        path: ['funds', 'navStaleDays'],
        unit: 'days',
        min: 1,
        max: 60,
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
      {
        name: 'valuationPeriods',
        label: 'Value by period: how many periods “recent” shows',
        hint: 'Investments > Value by period shows this many weeks, months, quarters or years by default; the longer choice is twice as many, and “All” shows everything on record.',
        kind: 'int',
        path: ['funds', 'valuationPeriods'],
        unit: 'periods',
        min: 2,
        max: 60,
      },
      {
        name: 'financialQuarters',
        label: 'Quarters follow the financial year (April to June is Q1)',
        hint: 'Used by Value by period on Investments. Switch off to count calendar quarters instead (January to March is Q1).',
        kind: 'check',
        path: ['funds', 'financialQuarters'],
      },
      {
        name: 'noLedgerNoteAbove',
        label: 'Warn about approximate fund profit while this many funds lack a transaction ledger',
        hint: 'Home shows a note that fund profit is approximate until you import your fund statements, while MORE funds than this have only monthly values and no transactions. 0 shows it while any fund lacks them.',
        kind: 'int',
        path: ['funds', 'noLedgerNoteAbove'],
        unit: 'funds',
        min: 0,
        max: 1000,
      },
      {
        name: 'matchPriceTolerance',
        label: 'Matching a fund: its recorded price a unit equals a scheme’s official price within',
        hint: 'When a fund’s name fits several schemes, the value you recorded divided by its units is compared with each scheme’s official price in the days before. Exactly one scheme this close is suggested for one click.',
        kind: 'pct',
        path: ['funds', 'matchPriceTolerance'],
        unit: '%',
        min: 0,
        max: 5,
      },
      {
        name: 'matchPriceDays',
        label: 'Matching a fund: official prices compared, days before the recorded value',
        hint: 'The recorded value may use the price of a few days earlier (a weekend, a holiday, the day an app last updated).',
        kind: 'int',
        path: ['funds', 'matchPriceDays'],
        unit: 'days',
        min: 1,
        max: 31,
      },
      {
        name: 'platformRules',
        label: 'Where each fund is held (the Platform grouping on Investments)',
        hint: 'One rule a line: words in the fund’s name = the platform. The first rule whose words are in the fund’s statement name or the name you gave it wins; “* = platform” covers every other fund. Example: “in hdfc = HDFC Securities” then “* = Kuvera”.',
        kind: 'platforms',
        path: ['funds', 'platformRules'],
        unit: 'one rule per line',
      },
      {
        name: 'benchmarks',
        label: 'Each fund’s benchmark (on its page, Returns)',
        hint: 'One rule a line: words in the fund’s name = the index = the scheme code of an index fund or ETF that follows it (code*0.5 + code*0.5 for a mix of two). “kind:small = …” covers a kind of fund (small, mid, large, flexi, elss, hybrid…) that no name rule fits, and “* = …” every other fund. The built-in list has each of your funds’ official benchmarks from their scheme documents.',
        kind: 'benchmarks',
        path: ['funds', 'benchmarks'],
        unit: 'one rule per line',
      },
      {
        name: 'planTolerance',
        label: 'A fund’s SIP plan may differ from the amount invested by',
        hint: 'A fund with no transactions has its units rebuilt from its start date and SIP plan. When the money the plan puts in differs from the amount invested you recorded by more than this share, the plan is adjusted to agree: an opening purchase is added, or the instalments are scaled down.',
        kind: 'pct',
        path: ['funds', 'planTolerance'],
        unit: '% of the amount invested',
        min: 0,
        max: 50,
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
    case 'lines':
    case 'senders':
    case 'platforms':
    case 'benchmarks':
    case 'words':
      return Array.isArray(v) ? v.join('\n') : '';
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
    if (f.kind === 'lines') {
      const rows = (get(f.name) ?? '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const row of rows) {
        const p = parsePriceLine(row);
        if ('error' in p) return { ok: false, message: `${f.label}: ${p.error}.` };
      }
      if (rows.length === 0 || rows.length > 40)
        return { ok: false, message: `${f.label}: between 1 and 40 lines.` };
      bucket[key] = rows;
      continue;
    }
    if (f.kind === 'benchmarks') {
      const rows = (get(f.name) ?? '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const row of rows) {
        const p = parseBenchmarkRule(row);
        if ('error' in p) return { ok: false, message: `${f.label}: ${p.error}.` };
      }
      if (rows.length > 80) return { ok: false, message: `${f.label}: at most 80 rules.` };
      bucket[key] = rows;
      continue;
    }
    if (f.kind === 'platforms') {
      const rows = (get(f.name) ?? '')
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean);
      for (const row of rows) {
        const p = parsePlatformRule(row);
        if ('error' in p) return { ok: false, message: `${f.label}: ${p.error}.` };
      }
      if (rows.length > 40) return { ok: false, message: `${f.label}: at most 40 rules.` };
      bucket[key] = rows;
      continue;
    }
    if (f.kind === 'words') {
      const rows = (get(f.name) ?? '')
        .split(/[\r\n]+/)
        .map((x) => x.trim().toLowerCase().replace(/\s+/g, ' '))
        .filter(Boolean);
      const bad = rows.find((x) => x.length < 2 || x.length > 60);
      if (bad) return { ok: false, message: `${f.label}: “${bad}” should be 2 to 60 characters.` };
      if (rows.length > 60) return { ok: false, message: `${f.label}: at most 60 lines.` };
      bucket[key] = [...new Set(rows)];
      continue;
    }
    if (f.kind === 'senders') {
      const rows = (get(f.name) ?? '')
        .split(/[\r\n,;]+/)
        .map((x) => x.trim())
        .filter(Boolean);
      const bad = rows.find((x) => !cleanSender(x));
      if (bad)
        return { ok: false, message: `${f.label}: “${bad}” is not a domain or an e-mail address.` };
      const list = [...new Set(rows.map((x) => cleanSender(x)!))];
      if (list.length === 0 || list.length > 40)
        return { ok: false, message: `${f.label}: between 1 and 40 entries.` };
      bucket[key] = list;
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
      if (f.optional && text === '') {
        bucket[key] = '';
        continue;
      }
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
