import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DEFAULT_CONFIG, EMPTY_PROFILE, RULES } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { confirmedGroups } from '@/lib/settings-fields';
import { SETTINGS_TABS, settingsTabOf, todoByTab } from '@/lib/settings-tabs';
import { DEMO_AI_KEYS } from '@/lib/demo-ai-keys';
import { DEMO_SYNC_INFO, DEMO_TEST } from '@/lib/demo-sheet-sync';
import { computeSetupStatus, setupProgress, type SetupFacts } from '@/lib/setup-status';
import { AnchorRedirect, SettingsNav } from '@/app/(app)/settings/SettingsNav';
import type { FlowRow, PersonRow } from '@/app/(app)/settings/PeopleForms';
import {
  AccessSection,
  ConnectionsSection,
  NotificationsSection,
  PeopleSection,
  RulesSection,
  SetupSection,
  TaxSection,
  type TaxYear,
} from '@/app/(app)/settings/sections';
import '@/app/(app)/settings/settings.css';
import { SafetyDemoShell } from '../SafetyDemoShell';

export const metadata: Metadata = {
  title: 'Sample settings',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';

const people: PersonRow[] = [
  {
    id: 'p1',
    name: 'Asha',
    dob: '1982-03-14',
    panLast4: '4321',
    residency: 'NRI (non-resident Indian)',
    guardian: '',
    planRole: 'primary',
    isMinor: false,
    notes: '',
  },
  {
    id: 'p2',
    name: 'Vikram',
    dob: '1980-11-02',
    panLast4: null,
    residency: 'NRI (non-resident Indian)',
    guardian: '',
    planRole: 'spouse',
    isMinor: false,
    notes: 'PAN to be added',
  },
  {
    id: 'p3',
    name: 'Kiran',
    dob: '2013-06-20',
    panLast4: null,
    residency: '',
    guardian: 'p1',
    planRole: '',
    isMinor: true,
    notes: '',
  },
];

const flows: FlowRow[] = [
  {
    id: 'f1',
    ownerId: 'p1',
    kind: 'income',
    label: 'Salary',
    amount: 6200,
    currency: 'SGD',
    frequency: 'monthly',
  },
  {
    id: 'f2',
    ownerId: 'p2',
    kind: 'income',
    label: 'Rent received',
    amount: 24000,
    currency: 'INR',
    frequency: 'monthly',
  },
  {
    id: 'f3',
    ownerId: null,
    kind: 'expense',
    label: 'Household',
    amount: 4100,
    currency: 'SGD',
    frequency: 'monthly',
  },
];

const facts: SetupFacts = {
  today: TODAY,
  people: people.map((p) => ({
    name: p.name,
    dob: p.dob || null,
    panLast4: p.panLast4,
    isMinor: p.isMinor,
  })),
  incomeItems: 2,
  spendingItems: 1,
  unconfirmedRuleGroups: ['deposits', 'reminders', 'estimates', 'rates', 'refunds', 'liquidity'],
  taxRules: [{ fy: '2025-26', verified: true }],
  aiKeysTotal: 3,
  aiKeysOn: 2,
  integrationSaved: true,
  inboxLabel: 'FWOS/Inbox',
  emailsRead: 0,
  telegramSet: false,
  rateSources: 1,
  digestEnabled: true,
  emergencyContacts: 0,
  emergencyMode: 'always',
  casImports: 0,
  has26as: true,
  hasAis: false,
};

const years: TaxYear[] = RULES.map((r) => ({
  custom: r.fy === '2025-26',
  builtin: true,
  current: r.fy === '2026-27',
  sources: r.fy === '2025-26' ? [] : r.sources,
  v: {
    fy: r.fy,
    months: r.equity.holdingMonthsLong,
    stcg: r.equity.stcgRate * 100,
    ltcg: r.equity.ltcgRate * 100,
    exemption: r.equity.ltcgExemption,
    cess: r.cess * 100,
    verified: r.fy === '2025-26',
    note: r.notes[0] ?? '',
  },
}));

/** Public preview of every Settings section with invented data: nothing is read or saved. */
export default async function DemoSettings({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = settingsTabOf((await searchParams).tab);
  const items = computeSetupStatus(facts);
  const { done, total } = setupProgress(items);
  const meta = SETTINGS_TABS.find((t) => t.key === tab)!;
  const raw = { confirmed: ['harvest'] };
  return (
    <SafetyDemoShell>
      <PageHead
        title="Settings"
        subtitle="Everything you can change, one section at a time. Numbers that rules or laws can change live here, never in the code."
        pills={[{ label: `${total - done} setup items open`, tone: 'warn' }]}
      />
      <Suspense fallback={null}>
        <AnchorRedirect base="/demo/settings" />
      </Suspense>
      <div className="setlayout">
        <SettingsNav base="/demo/settings" current={tab} todo={todoByTab(items)} />
        <div className="setmain">
          <h2 className="settitle">{meta.label}</h2>
          {tab === 'setup' && <SetupSection items={items} />}
          {tab === 'people' && (
            <PeopleSection people={people} flows={flows} fxNow={{ INR: 1, SGD: 64.2 }} />
          )}
          {tab === 'rules' && (
            <RulesSection
              config={DEFAULT_CONFIG}
              confirmed={confirmedGroups(raw, DEFAULT_CONFIG)}
            />
          )}
          {tab === 'tax' && <TaxSection years={years} currentFy="2026-27" />}
          {tab === 'notifications' && (
            <NotificationsSection
              digest={{ enabled: true, extra: ['family@example.com'], includeRetirement: true }}
              telegram={{ isSet: false, chatIds: '' }}
              deliveries={[
                {
                  date: '2026-10-26',
                  channel: 'email',
                  status: 'accepted_by_provider',
                  recipients: 3,
                  error: null,
                },
                {
                  date: '2026-10-25',
                  channel: 'email',
                  status: 'accepted_by_provider',
                  recipients: 3,
                  error: null,
                },
                {
                  date: '2026-10-24',
                  channel: 'email',
                  status: 'failed',
                  recipients: 3,
                  error: 'mail server busy',
                },
              ]}
            />
          )}
          {tab === 'connections' && (
            <ConnectionsSection
              ai={{ keys: DEMO_AI_KEYS, label: 'FWOS/Inbox' }}
              demo
              gsheet={DEMO_SYNC_INFO}
              demoTest={DEMO_TEST}
              sources={[
                {
                  id: 'r1',
                  bank: 'Sample Equity Bank',
                  url: 'https://bank.example.com/rates/fixed-deposits-and-savings-account-interest-rates',
                  kind: 'both',
                  lastRunOn: '2026-10-19',
                  lastResult: '12 rates read',
                },
              ]}
            />
          )}
          {tab === 'access' && (
            <AccessSection
              profile={{
                ...EMPTY_PROFILE,
                message: 'We made this so you are never left wondering what to do.',
                contacts: [
                  {
                    name: 'Ravi Menon',
                    relation: 'my brother',
                    phone: '+65 9000 0000',
                    note: 'knows where the papers are',
                  },
                ],
                willLocation: 'Fireproof box in the study; a copy with the lawyer.',
              }}
              access={{ mode: 'inactive', days: 30, released: false }}
            />
          )}
        </div>
      </div>
    </SafetyDemoShell>
  );
}
