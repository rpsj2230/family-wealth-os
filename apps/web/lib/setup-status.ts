/**
 * What is set up and what is not. `computeSetupStatus` is a pure function over plain facts; `loadSetupStatus` reads those facts
 * with ordinary (row-level-security) selects, so it only ever sees the signed-in household. Used by Settings > Setup and by the
 * compact checklist on the dashboard (components/SetupChecklist.tsx).
 *
 * Secrets are never read: the AI key and the Telegram token are only known to exist (`ai_key_set`, `telegram_set`).
 */
import { configFromJson, fyOf } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { confirmedGroups, GROUP_TITLE, RULE_GROUPS, type RuleGroup } from './settings-fields';

export interface SetupItem {
  key: string;
  label: string;
  done: boolean;
  href: string;
  /** one short sentence: what is missing, or what is set */
  hint?: string;
}

export interface SetupFacts {
  /** today as 2026-10-26 */
  today: string;
  people: { name: string; dob: string | null; panLast4: string | null; isMinor: boolean }[];
  incomeItems: number;
  spendingItems: number;
  /** the Money rules cards the household has not saved yet: they still run on the built-in numbers */
  unconfirmedRuleGroups: RuleGroup[];
  taxRules: { fy: string; verified: boolean }[];
  aiKeySet: boolean;
  /** a row of integration settings exists, so the Gmail label was saved at least once */
  integrationSaved: boolean;
  inboxLabel: string;
  emailsRead: number;
  telegramSet: boolean;
  rateSources: number;
  digestEnabled: boolean;
  emergencyContacts: number;
  emergencyMode: 'always' | 'inactive' | 'manual' | null;
  casImports: number;
  has26as: boolean;
  hasAis: boolean;
}

const list = (xs: string[]) =>
  xs.length <= 2 ? xs.join(' and ') : `${xs.slice(0, 2).join(', ')} and ${xs.length - 2} more`;
const MODE_WORDS: Record<'always' | 'inactive' | 'manual', string> = {
  always: 'the read-only family login can always open the handbook',
  inactive: 'the family login opens the handbook after a long absence',
  manual: 'the family login opens the handbook only when you release it',
};

export function computeSetupStatus(f: SetupFacts): SetupItem[] {
  const fy = fyOf(f.today);
  const adults = f.people.filter((p) => !p.isMinor);
  const noDob = f.people.filter((p) => !p.dob).map((p) => p.name);
  const noPan = adults.filter((p) => !p.panLast4).map((p) => p.name);
  const peopleDone = f.people.length > 0 && noDob.length === 0 && noPan.length === 0;
  const peopleHint =
    f.people.length === 0
      ? 'No one is in the household yet.'
      : peopleDone
        ? `${f.people.length} ${f.people.length === 1 ? 'person' : 'people'} with date of birth and PAN last four.`
        : [
            noDob.length ? `Date of birth missing: ${list(noDob)}.` : '',
            noPan.length ? `PAN missing: ${list(noPan)}.` : '',
          ]
            .filter(Boolean)
            .join(' ');

  const rule = f.taxRules.find((r) => r.fy === fy);
  const taxHint = !rule
    ? `Nothing entered for FY ${fy}: the Tax page uses the built-in numbers, which come from secondary sources.`
    : rule.verified
      ? `FY ${fy} entered and checked against the official site.`
      : `FY ${fy} is entered but not yet marked as checked on the official site.`;

  const statementHint =
    (f.has26as ? '26AS read' : '26AS not yet') + ', ' + (f.hasAis ? 'AIS read.' : 'AIS not yet.');
  const unconfirmed = f.unconfirmedRuleGroups.length;

  return [
    {
      key: 'people',
      label: 'People: date of birth and PAN last four',
      done: peopleDone,
      href: '/settings?tab=people',
      hint: peopleHint,
    },
    {
      key: 'income',
      label: 'Income and spending entered',
      done: f.incomeItems > 0 && f.spendingItems > 0,
      href: '/settings?tab=people#money',
      hint:
        f.incomeItems > 0 && f.spendingItems > 0
          ? `${f.incomeItems} income and ${f.spendingItems} spending lines.`
          : 'Needed for the monthly saving and for “Can I retire now?”.',
    },
    {
      key: 'rules',
      label: 'Money rules looked at and confirmed',
      done: unconfirmed === 0,
      href: '/settings?tab=rules',
      hint:
        unconfirmed === 0
          ? 'All seven groups are saved by you.'
          : `${unconfirmed} of ${RULE_GROUPS.length} groups still use the built-in numbers: ${list(
              f.unconfirmedRuleGroups.map((g) => GROUP_TITLE[g]),
            )}.`,
    },
    {
      key: 'tax-rules',
      label: `Tax rules for FY ${fy} entered and checked`,
      done: !!rule?.verified,
      href: '/settings?tab=tax',
      hint: taxHint,
    },
    {
      key: 'ai-key',
      label: 'AI key saved',
      done: f.aiKeySet,
      href: '/settings?tab=connections#email',
      hint: f.aiKeySet
        ? 'Saved on the server; it cannot be shown again.'
        : 'Lets the app read PDF statements and unfamiliar e-mails. A free OpenRouter, Groq or Gemini key is enough.',
    },
    {
      key: 'gmail',
      label: 'Gmail label for forwarded bank e-mails',
      done: f.integrationSaved || f.emailsRead > 0,
      href: '/settings?tab=connections#email',
      hint:
        f.emailsRead > 0
          ? `${f.emailsRead} e-mails read from “${f.inboxLabel}”.`
          : f.integrationSaved
            ? `Label “${f.inboxLabel}” saved; no e-mail has been read yet.`
            : 'Forward bank e-mails to a Gmail label and name it here.',
    },
    {
      key: 'rate-pages',
      label: 'Bank rate pages added',
      done: f.rateSources > 0,
      href: '/settings?tab=connections#rates',
      hint:
        f.rateSources > 0
          ? `${f.rateSources} ${f.rateSources === 1 ? 'page is' : 'pages are'} read every Monday.`
          : 'Without them the Rates page only has rates you type.',
    },
    {
      key: 'telegram',
      label: 'Telegram daily summary on',
      done: f.telegramSet,
      href: '/settings?tab=notifications#telegram',
      hint: f.telegramSet
        ? 'The summary arrives on Telegram every day.'
        : 'Free and automatic; takes about two minutes.',
    },
    {
      key: 'digest',
      label: 'Daily summary e-mail on',
      done: f.digestEnabled,
      href: '/settings?tab=notifications#digest',
      hint: f.digestEnabled ? 'Sent at 08:30 Singapore time.' : 'Switched off.',
    },
    {
      key: 'emergency',
      label: 'Emergency contacts and who can open the handbook',
      done: f.emergencyContacts > 0,
      href: '/settings?tab=access',
      hint:
        f.emergencyContacts > 0
          ? `${f.emergencyContacts} contacts; ${MODE_WORDS[f.emergencyMode ?? 'always']}.`
          : 'No one to call is listed in the handbook yet.',
    },
    {
      key: 'cas',
      label: 'First fund statement imported',
      done: f.casImports > 0,
      href: '/import',
      hint:
        f.casImports > 0
          ? `${f.casImports} statements imported.`
          : 'A detailed statement from CAMS or KFintech gives real purchase dates for the tax plan.',
    },
    {
      key: 'statements',
      label: '26AS and AIS imported',
      done: f.has26as && f.hasAis,
      href: '/tax/filing',
      hint: statementHint,
    },
  ];
}

/** Today in Singapore, as 2026-10-26. */
export const sgToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(now);

type Rows<T> = { data: T[] | null };
const rows = <T>(r: Rows<T> | null | undefined): T[] => r?.data ?? [];

/** Reads the facts with the signed-in user's own (row-level-security) selects and computes the checklist. */
export async function loadSetupStatus(
  supabase: SupabaseClient,
  today: string = sgToday(),
): Promise<SetupItem[]> {
  const safe = async <T>(q: PromiseLike<T>): Promise<T | null> => {
    try {
      return await q;
    } catch {
      return null;
    }
  };
  const count = async (table: string): Promise<number> => {
    const r = await safe(supabase.from(table).select('*', { count: 'exact', head: true }));
    return r?.count ?? 0;
  };
  const [owners, flows, cfg, tax, integ, inbox, sources, digest, profile, access, cas, stmts] =
    await Promise.all([
      safe(
        supabase
          .from('owners')
          .select('display_name, dob, pan_last4, is_minor')
          .order('created_at'),
      ),
      safe(supabase.from('cashflow_items').select('kind')),
      safe(supabase.from('household_config').select('config').maybeSingle()),
      safe(supabase.from('tax_rules').select('fy, verified')),
      safe(
        supabase
          .from('integration_settings')
          .select('ai_key_set, inbox_label, telegram_set')
          .maybeSingle(),
      ),
      count('inbox_messages'),
      count('rate_sources'),
      safe(supabase.from('digest_settings').select('enabled').maybeSingle()),
      safe(supabase.from('emergency_profile').select('content').maybeSingle()),
      safe(supabase.from('emergency_access').select('mode').maybeSingle()),
      safe(
        supabase
          .from('cas_imports')
          .select('id', { count: 'exact', head: true })
          .in('outcome', ['imported', 'partial']),
      ),
      safe(supabase.from('tax_statements').select('kind')),
    ]);
  const raw = (cfg?.data as { config?: unknown } | null)?.config;
  const config = configFromJson(raw);
  const confirmed = confirmedGroups(raw, config);
  const contacts = (profile?.data as { content?: { contacts?: unknown[] } } | null)?.content
    ?.contacts;
  const ic = integ?.data as {
    ai_key_set: boolean;
    inbox_label: string;
    telegram_set: boolean;
  } | null;
  const kinds = new Set(rows(stmts as Rows<{ kind: string }>).map((s) => s.kind));
  const flowRows = rows(flows as Rows<{ kind: string }>);
  const mode = (access?.data as { mode?: string } | null)?.mode;
  return computeSetupStatus({
    today,
    people: rows(
      owners as Rows<{
        display_name: string;
        dob: string | null;
        pan_last4: string | null;
        is_minor: boolean;
      }>,
    ).map((o) => ({
      name: o.display_name,
      dob: o.dob,
      panLast4: o.pan_last4,
      isMinor: !!o.is_minor,
    })),
    incomeItems: flowRows.filter((f) => f.kind === 'income').length,
    spendingItems: flowRows.filter((f) => f.kind === 'expense').length,
    unconfirmedRuleGroups: RULE_GROUPS.filter((g) => !confirmed.includes(g)),
    taxRules: rows(tax as Rows<{ fy: string; verified: boolean }>),
    aiKeySet: !!ic?.ai_key_set,
    integrationSaved: !!ic,
    inboxLabel: ic?.inbox_label ?? 'FWOS/Inbox',
    emailsRead: inbox,
    telegramSet: !!ic?.telegram_set,
    rateSources: sources,
    digestEnabled: !!(digest?.data as { enabled?: boolean } | null)?.enabled,
    emergencyContacts: Array.isArray(contacts) ? contacts.length : 0,
    emergencyMode: mode === 'always' || mode === 'inactive' || mode === 'manual' ? mode : null,
    casImports: cas?.count ?? 0,
    has26as: kinds.has('26as'),
    hasAis: kinds.has('ais'),
  });
}

/** How many items are done, for a progress bar. */
export const setupProgress = (items: SetupItem[]) => ({
  done: items.filter((i) => i.done).length,
  total: items.length,
});
