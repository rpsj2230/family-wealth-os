import {
  buildAutomationCards,
  type AccountChoice,
  type AutomationCard,
  type InboxEntry,
} from '@fwos/core';

/** Invented data for the public /demo pages of Monthly update, Inbox and Import. No real names, banks' customers or amounts. */
export const DEMO_DAY = '2026-10-26';

export function demoAutomation(): AutomationCard[] {
  return buildAutomationCards({
    today: DEMO_DAY,
    inbox: {
      lastLoggedAt: '2026-10-25T14:20:00Z',
      week: { applied: 3, needs_review: 3, ignored: 4, error: 1 },
      waiting: 3,
      aiReady: false,
      label: 'FWOS/Inbox',
    },
    market: { navLatest: '2026-10-23', fxLatest: '2026-10-26' },
    digest: {
      enabled: true,
      last: {
        date: '2026-10-26',
        status: 'accepted_by_provider',
        channel: 'email',
        recipients: 2,
        error: null,
      },
    },
    rates: { sources: 4, lastRunOn: '2026-10-25' },
  });
}

const reading = (
  bank: string,
  last4: string | null,
  amount: number,
  asOf: string,
  source: 'rule' | 'ai' = 'rule',
) => ({ bank, last4, amount, currency: 'INR', asOf, source });

export function demoInbox(): InboxEntry[] {
  const m = (o: Partial<InboxEntry> & { id: string }): InboxEntry => ({
    receivedOn: '2026-10-25',
    fromDomain: 'samplebank.example',
    subject: 'Account alert',
    outcome: 'needs_review',
    reason: null,
    reading: null,
    assetId: null,
    resolvedAt: null,
    recordedByYou: false,
    ...o,
  });
  return [
    m({
      id: 'r1',
      subject: 'Balance alert for your account ending 1117',
      reason: 'sender is not confirmed as the bank',
      reading: reading('Sample Jan Bank', '1117', 131_250, '2026-10-25'),
      assetId: 's-ja-p1',
    }),
    m({
      id: 'r2',
      subject: 'Your account ending 4455',
      reason: 'no single account matches this bank and last four digits',
      reading: reading('Sample Equity Bank', '4455', 12_000, '2026-10-24'),
    }),
    m({
      id: 'r3',
      receivedOn: '2026-10-23',
      subject: 'Statement for September',
      reason: 'statement found; add an AI key in Settings to read it',
    }),
    m({
      id: 'a1',
      receivedOn: '2026-10-22',
      outcome: 'applied',
      subject: 'Balance alert for your account ending 1134',
      reading: reading('Sample Esaf Bank', '1134', 222_400, '2026-10-22'),
      assetId: 's-es-p1',
      bodyText:
        'Dear Customer,\n\nThe available balance in your account ending ••••1134 is Rs. 2,22,400.00 as on 22-OCT-26.\n\nThank you for banking with us.',
    }),
    m({
      id: 'a2',
      receivedOn: '2026-10-20',
      outcome: 'applied',
      fromDomain: 'registrar.example',
      subject: 'Consolidated account statement',
      reason: '6 funds updated, 41 new transactions',
    }),
    m({
      id: 'a3',
      receivedOn: '2026-10-18',
      resolvedAt: '2026-10-19T04:00:00Z',
      recordedByYou: true,
      subject: 'Balance alert for your account ending 1101',
      reason: 'amount is far from the current value; please confirm',
      reading: reading('Sample Equity Bank', '1101', 80_100, '2026-10-18'),
      assetId: 's-eq-p2',
    }),
    m({
      id: 's1',
      receivedOn: '2026-10-24',
      outcome: 'ignored',
      subject: 'Balance alert for your account ending 1117',
      reason: 'not newer than the value on record (2026-10-25)',
      reading: reading('Sample Jan Bank', '1117', 129_000, '2026-10-24'),
      assetId: 's-ja-p1',
    }),
    m({
      id: 's2',
      receivedOn: '2026-10-21',
      outcome: 'ignored',
      fromDomain: 'news.example',
      subject: 'Our new savings rates are here',
      bodyText: 'Festive offers: savings rates up to 7.5%. Open an account today.',
    }),
    m({
      id: 'd1',
      receivedOn: '2026-10-17',
      resolvedAt: '2026-10-17T10:00:00Z',
      subject: 'Balance alert',
      reason: 'sender is not confirmed as the bank',
      reading: reading('Sample Yes Bank', '9090', 5_000, '2026-10-17'),
    }),
    m({
      id: 'e1',
      receivedOn: '2026-10-19',
      outcome: 'error',
      subject: 'Statement',
      reason: 'No SGD exchange rate on record yet; run the market-data job first',
    }),
  ];
}

export const DEMO_ACCOUNTS: AccountChoice[] = [
  {
    id: 's-ja-p1',
    label: 'Cash-NRE-1117',
    currency: 'INR',
    last4: '1117',
    bank: 'Sample Jan Bank',
  },
  {
    id: 's-eq-p1',
    label: 'Cash-NRE-1100',
    currency: 'INR',
    last4: '1100',
    bank: 'Sample Equity Bank',
  },
  {
    id: 's-eq-p2',
    label: 'Cash-NRO-1101',
    currency: 'INR',
    last4: '1101',
    bank: 'Sample Equity Bank',
  },
  {
    id: 's-es-p1',
    label: 'Cash-NRE-1134',
    currency: 'INR',
    last4: '1134',
    bank: 'Sample Esaf Bank',
  },
];
