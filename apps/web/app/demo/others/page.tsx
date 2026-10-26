import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CONFIG, personStyles } from '@fwos/core';
import {
  HoldingsTab,
  LOAN_COLS,
  LoansTab,
  OthersKpis,
  POLICY_COLS,
  PoliciesTab,
  type OthersActions,
  type PolicyLine,
} from '@/app/(app)/others/Parts';
import { DemoShell } from '@/components/DemoShell';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { loanLines, loanTotals, policyDue, type HoldingLine } from '@/lib/others-summary';
import { sampleSave } from '../sample-actions';

export const metadata: Metadata = {
  title: 'Sample lent, policies, property',
  robots: { index: false, follow: false },
};

const TODAY = '2026-10-26';
const PEOPLE = [
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
  { id: 'p3', name: 'Chaya' },
];
const TABS = ['lent', 'policies', 'property'] as const;

const actions: OthersActions = {
  addLoan: sampleSave,
  recordRepayment: sampleSave,
  setExpectedDate: sampleSave,
  setLoanKind: sampleSave,
  addPolicy: sampleSave,
  updatePolicy: sampleSave,
  addHolding: sampleSave,
  recordHoldingValue: sampleSave,
};

const LOANS = loanLines(
  [
    {
      assetId: 'l9',
      counterparty: 'Sample Nephew (wedding gift)',
      ownerId: 'p1',
      gift: true,
      lent: 100_000,
      lentOn: '2025-02-10',
      expectedOn: null,
      repayments: [],
    },
    {
      assetId: 'l1',
      counterparty: 'Sample Cousin',
      ownerId: 'p1',
      lent: 500_000,
      lentOn: '2025-12-01',
      expectedOn: '2026-09-30',
      repayments: [{ amount: 100_000, on: '2026-03-15' }],
    },
    {
      assetId: 'l2',
      counterparty: 'Sample Friend',
      ownerId: 'p2',
      lent: 200_000,
      lentOn: '2026-06-10',
      expectedOn: '2027-03-31',
      repayments: [],
    },
    {
      assetId: 'l3',
      counterparty: 'Sample Neighbour',
      ownerId: 'p1',
      lent: 75_000,
      lentOn: '2025-02-01',
      expectedOn: null,
      repayments: [
        { amount: 50_000, on: '2025-08-01' },
        { amount: 25_000, on: '2026-01-10' },
      ],
    },
  ],
  TODAY,
);

const POLICIES: PolicyLine[] = [
  {
    id: 'pol1',
    kind: 'term',
    insurer: 'Sample Life Insurance',
    coverage: '₹1 crore term cover to age 65',
    paidBy: 'Anil',
    renewalOn: '2026-11-20',
    expiresOn: '2048-11-20',
    nominee: 'Beena (spouse)',
    documents: 'Fireproof box, folder 2',
    insured: ['Anil'],
  },
  {
    id: 'pol2',
    kind: 'health_sg',
    insurer: 'Sample Health Singapore',
    coverage: 'Hospital plan, private ward',
    paidBy: 'Beena',
    renewalOn: '2027-03-01',
    expiresOn: null,
    nominee: null,
    documents: 'Email folder "Insurance"',
    insured: ['Anil', 'Beena', 'Chaya'],
  },
  {
    id: 'pol3',
    kind: 'health_in',
    insurer: 'Sample Health India',
    coverage: '₹10 lakh family floater',
    paidBy: 'Anil',
    renewalOn: '2026-09-01',
    expiresOn: null,
    nominee: null,
    documents: null,
    insured: ['Anil', 'Beena'],
  },
  {
    id: 'pol4',
    kind: 'other',
    insurer: 'Sample Travel Cover',
    coverage: null,
    paidBy: null,
    renewalOn: null,
    expiresOn: null,
    nominee: null,
    documents: null,
    insured: [],
  },
];

const HOLDINGS: HoldingLine[] = [
  {
    assetId: 'h1',
    ownerId: 'p1',
    name: 'Sample Flat',
    type: 'property',
    kind: 'Property',
    value: 8_500_000,
    asOf: '2026-09-30',
    source: { label: 'You, 30 Sep', kind: 'manual' },
    notes: 'Rented out; value from a broker estimate',
  },
  {
    assetId: 'h2',
    ownerId: 'p2',
    name: 'Sample NPS account',
    type: 'nps',
    kind: 'NPS',
    value: 1_240_000,
    asOf: '2026-10-05',
    source: { label: 'Imported sheet, 5 Oct', kind: 'import' },
    notes: null,
  },
  {
    assetId: 'h3',
    ownerId: 'p1',
    name: 'Sample ULIP',
    type: 'ulip',
    kind: 'ULIP and pension plans',
    value: null,
    asOf: null,
    source: { label: 'No value yet', kind: 'none' },
    notes: null,
  },
];

/** Public preview of the Lent, policies, property page with invented people and amounts: no private data is read. */
export default async function DemoOthers({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'lent';
  const styles = personStyles(PEOPLE);
  const policyDays = DEFAULT_CONFIG.reminders.policyDays;
  const t = loanTotals(LOANS);
  const dueNow = POLICIES.filter((p) => {
    const s = policyDue(p, TODAY, policyDays).state;
    return s === 'soon' || s === 'lapsed';
  }).length;
  return (
    <DemoShell>
      <PageHead
        title="Lent, policies, property"
        subtitle="Money others owe you, your insurance policies, and property and retirement holdings that are not bank or fund accounts."
        pills={[
          t.overdueCount > 0
            ? { label: `${t.overdueCount} loan overdue`, tone: 'bad' }
            : { label: 'No loan overdue', tone: 'ok' },
          ...(dueNow > 0
            ? [{ label: `${dueNow} policy dates to look at`, tone: 'warn' as const }]
            : []),
        ]}
        actions={
          <Link className="btn" href="/demo/accounts">
            Accounts
          </Link>
        }
      />
      <OthersKpis
        loans={LOANS}
        policies={POLICIES}
        holdings={HOLDINGS}
        today={TODAY}
        policyDays={policyDays}
      />
      <Tabs
        base="/demo/others"
        current={tab}
        tabs={[
          { key: 'lent', label: 'Money lent', badge: t.overdueCount },
          { key: 'policies', label: 'Policies', badge: dueNow },
          { key: 'property', label: 'Property and other', badge: null },
        ]}
      />
      {tab === 'lent' && (
        <ListingTools name="loans" listCols={LOAN_COLS}>
          <LoansTab loans={LOANS} people={PEOPLE} styles={styles} today={TODAY} actions={actions} />
        </ListingTools>
      )}
      {tab === 'policies' && (
        <ListingTools name="policies" listCols={POLICY_COLS}>
          <PoliciesTab
            policies={POLICIES}
            people={PEOPLE}
            today={TODAY}
            policyDays={policyDays}
            actions={actions}
          />
        </ListingTools>
      )}
      {tab === 'property' && (
        <ListingTools name="holdings">
          <HoldingsTab
            holdings={HOLDINGS}
            people={PEOPLE}
            styles={styles}
            today={TODAY}
            actions={actions}
          />
        </ListingTools>
      )}
    </DemoShell>
  );
}
