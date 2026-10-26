import type { Metadata } from 'next';
import { MoreMenu } from '@/app/(app)/more/MoreMenu';
import { computeSetupStatus } from '@/lib/setup-status';
import { SafetyDemoShell, noSignOut } from '../SafetyDemoShell';

export const metadata: Metadata = {
  title: 'Sample menu',
  robots: { index: false, follow: false },
};

/** Public preview of the More menu, with the compact setup checklist the dashboard can show. */
export default function DemoMore() {
  const items = computeSetupStatus({
    today: '2026-10-26',
    people: [{ name: 'Asha', dob: '1982-03-14', panLast4: '4321', isMinor: false }],
    incomeItems: 1,
    spendingItems: 1,
    unconfirmedRuleGroups: ['deposits', 'rates'],
    taxRules: [],
    aiKeySet: false,
    integrationSaved: false,
    inboxLabel: 'FWOS/Inbox',
    emailsRead: 0,
    telegramSet: false,
    rateSources: 0,
    digestEnabled: true,
    emergencyContacts: 1,
    emergencyMode: 'always',
    casImports: 0,
    has26as: false,
    hasAis: false,
  });
  return (
    <SafetyDemoShell>
      <MoreMenu signOut={noSignOut} setup={items} />
    </SafetyDemoShell>
  );
}
