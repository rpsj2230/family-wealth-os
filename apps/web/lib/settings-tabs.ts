/** The sections of Settings, each with its own address (/settings?tab=...), and where the old in-page anchors now live. */

export const SETTINGS_TABS = [
  {
    key: 'setup',
    label: 'Setup',
    purpose: 'What is set up, what is still missing, and the link to finish each item.',
  },
  {
    key: 'people',
    label: 'People',
    purpose:
      'Who is in the household: dates of birth, PAN last four, tax residency, guardians, and the income and spending the plan starts from.',
  },
  {
    key: 'rules',
    label: 'Money rules',
    purpose:
      'The numbers behind deposits, reminders, estimates, rate suggestions, harvesting and the “I need money” planner.',
  },
  {
    key: 'tax',
    label: 'Tax rules',
    purpose:
      'Capital-gains rates, holding period and the tax-free allowance for each financial year.',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    purpose: 'Where the daily summary goes: e-mail, Telegram or WhatsApp, and what was sent.',
  },
  {
    key: 'connections',
    label: 'Connections',
    purpose:
      'The AI key, the Gmail label for forwarded bank e-mails, the bank rate pages and the Google Sheet.',
  },
  {
    key: 'access',
    label: 'Emergency and access',
    purpose:
      'Who can open the family handbook and when, and what the handbook says about where things are.',
  },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['key'];

export const DEFAULT_TAB: SettingsTab = 'setup';

export function settingsTabOf(value: string | string[] | undefined): SettingsTab {
  const v = Array.isArray(value) ? value[0] : value;
  return SETTINGS_TABS.find((t) => t.key === v)?.key ?? DEFAULT_TAB;
}

export const tabHref = (tab: SettingsTab, anchor?: string) =>
  `/settings?tab=${tab}${anchor ? `#${anchor}` : ''}`;

/**
 * The old page was one long page with these anchors. A link such as /settings#tax cannot be seen by the server, so a small
 * script on the page reads the anchor and moves to the section that now holds it.
 */
export const ANCHOR_TAB: Record<string, SettingsTab> = {
  people: 'people',
  money: 'people',
  limits: 'rules',
  reminders: 'rules',
  estimates: 'rules',
  'rate-rules': 'rules',
  'refund-rules': 'rules',
  'harvest-rules': 'rules',
  liquidity: 'rules',
  tax: 'tax',
  digest: 'notifications',
  telegram: 'notifications',
  whatsapp: 'notifications',
  deliveries: 'notifications',
  // "Bank emails and AI" is what the Rates page calls #email: the key and the Gmail label live under Connections
  email: 'connections',
  ai: 'connections',
  rates: 'connections',
  'google-sheet': 'connections',
  emergency: 'access',
  handbook: 'access',
  setup: 'setup',
};

/** The tab that holds an anchor, or null when the anchor is unknown. */
export function tabForAnchor(hash: string): SettingsTab | null {
  const id = hash.replace(/^#/, '');
  return ANCHOR_TAB[id] ?? null;
}

/** How many open Setup items point into each section, for the badge on the section list. */
export function todoByTab(
  items: { href: string; done: boolean }[],
): Partial<Record<SettingsTab, number>> {
  const out: Partial<Record<SettingsTab, number>> = {};
  for (const i of items) {
    const m = /^\/settings\?tab=(\w+)/.exec(i.href);
    const tab = m ? SETTINGS_TABS.find((t) => t.key === m[1])?.key : undefined;
    if (tab && !i.done) out[tab] = (out[tab] ?? 0) + 1;
  }
  return out;
}
