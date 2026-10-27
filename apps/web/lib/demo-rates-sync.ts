import type { SyncOfferRow, SyncSourceRow } from './rates-sync-view';
import { DEMO_RATES_TODAY } from './demo-rates';

/**
 * Invented banks for the public /demo/rates/sync page. Nothing here is real: the names are made up and the addresses end in
 * .example.test. The buttons on that page act the sync out (see DemoSync) and save nothing.
 */
export const DEMO_SYNC_TODAY = DEMO_RATES_TODAY;

const doc = (
  url: string,
  kind: 'savings' | 'fd' | 'both',
  ok: boolean,
  note: string,
  extra: Record<string, unknown> = {},
) => ({ url, kind, ok, chars: ok ? 6200 : 0, note, via: null, effectiveOn: null, ...extra });

export const DEMO_SYNC_SOURCES: SyncSourceRow[] = [
  {
    id: 's1',
    bank: 'Sample North Bank',
    url: 'https://north.example.test/personal/interest-rates',
    kind: 'both',
    lastRunOn: DEMO_SYNC_TODAY,
    lastResult: '14 rates saved: 2 new, 3 changed, 9 unchanged',
    lastDocs: [
      doc(
        'https://north.example.test/personal/interest-rates',
        'both',
        true,
        'read 9,420 characters',
      ),
    ],
  },
  {
    id: 's2',
    bank: 'Sample Lake Bank',
    url: 'https://www.lake.example.test/deposits',
    kind: 'fd',
    lastRunOn: '2026-10-20',
    lastResult:
      'Unchanged since 2026-10-20: not read again (no AI cost); 11 rates confirmed as checked today.',
    lastDocs: [
      doc('https://www.lake.example.test/deposits', 'fd', true, 'read 5,310 characters'),
      doc(
        'https://www.lake.example.test/assets/rates/savings-2026-10.pdf',
        'savings',
        true,
        'read 3,870 characters',
        {
          via: 'https://www.lake.example.test/interest-rates',
          effectiveOn: '2026-10-04',
        },
      ),
    ],
  },
  {
    id: 's3',
    bank: 'Sample Hill Bank',
    url: 'https://www.hill.example.test/interest-rates/',
    kind: 'both',
    lastRunOn: '2026-10-19',
    lastResult:
      'Cannot read: Sample Hill Bank’s site refused the automated visit (403 Access Denied). Rates are only read from the bank’s own pages and a refusal is not worked around. Paste the page text instead.',
    lastDocs: [
      doc(
        'https://www.hill.example.test/interest-rates/',
        'both',
        false,
        'Cannot read: answered 403',
      ),
    ],
  },
  {
    id: 's4',
    bank: 'Sample Coast Bank',
    url: 'https://coast.example.test/rates',
    kind: 'both',
    lastRunOn: null,
    lastResult: null,
    lastDocs: null,
  },
  {
    id: 's5',
    bank: 'Sample Coast Bank',
    url: 'https://coast.example.test/savings-rates.pdf',
    kind: 'savings',
    lastRunOn: null,
    lastResult: null,
    lastDocs: null,
  },
];

const offer = (
  bank: string,
  checkedOn: string,
  note: string | null,
  kind: 'ai' | 'manual' = 'ai',
): SyncOfferRow => ({
  bank,
  checkedOn,
  sourceKind: kind,
  sourceNote: note,
});

export const DEMO_SYNC_OFFERS: SyncOfferRow[] = [
  ...Array.from({ length: 14 }, () =>
    offer('Sample North Bank', DEMO_SYNC_TODAY, 'Read from north.example.test'),
  ),
  ...Array.from({ length: 11 }, () =>
    offer('Sample Lake Bank', DEMO_SYNC_TODAY, 'Read from www.lake.example.test'),
  ),
  ...Array.from({ length: 6 }, () =>
    offer('Sample Hill Bank', '2026-10-05', 'Read from www.hill.example.test'),
  ),
  ...Array.from({ length: 3 }, () =>
    offer(
      'Sample Hill Bank',
      '2026-10-12',
      'Reference only, from comparison.example.test (third party)',
    ),
  ),
];

/** Who the sample's buttons act out, by bank: what the pretend sync says. */
export const DEMO_SYNC_SCRIPT: Record<
  string,
  {
    status: 'synced' | 'unchanged' | 'cannot' | 'no_key';
    message: string;
    docs: {
      url: string;
      kind: 'savings' | 'fd' | 'both';
      ok: boolean;
      chars: number;
      note: string;
      via?: string | null;
      effectiveOn?: string | null;
    }[];
  }
> = {
  'Sample North Bank': {
    status: 'unchanged',
    message:
      'Unchanged since 2026-10-26: not read again (no AI cost); 14 rates confirmed as checked today.',
    docs: [
      {
        url: 'https://north.example.test/personal/interest-rates',
        kind: 'both',
        ok: true,
        chars: 9420,
        note: 'read 9,420 characters',
      },
    ],
  },
  'Sample Lake Bank': {
    status: 'synced',
    message: '11 rates saved: 0 new, 2 changed, 9 unchanged',
    docs: [
      {
        url: 'https://www.lake.example.test/deposits',
        kind: 'fd',
        ok: true,
        chars: 5310,
        note: 'read 5,310 characters',
      },
      {
        url: 'https://www.lake.example.test/assets/rates/savings-2026-10.pdf',
        kind: 'savings',
        ok: true,
        chars: 3870,
        note: 'read 3,870 characters',
        via: 'https://www.lake.example.test/interest-rates',
        effectiveOn: '2026-10-04',
      },
    ],
  },
  'Sample Hill Bank': {
    status: 'cannot',
    message:
      'Cannot read: Sample Hill Bank’s site refused the automated visit (403 Access Denied). Rates are only read from the bank’s own pages and a refusal is not worked around. Paste the page text instead.',
    docs: [
      {
        url: 'https://www.hill.example.test/interest-rates/',
        kind: 'both',
        ok: false,
        chars: 0,
        note: 'Cannot read: answered 403',
      },
    ],
  },
  'Sample Coast Bank': {
    status: 'synced',
    message: '9 rates saved: 9 new, 0 changed, 0 unchanged',
    docs: [
      {
        url: 'https://coast.example.test/rates',
        kind: 'both',
        ok: true,
        chars: 4100,
        note: 'read 4,100 characters',
      },
      {
        url: 'https://coast.example.test/savings-rates.pdf',
        kind: 'savings',
        ok: true,
        chars: 2600,
        note: 'read 2,600 characters',
      },
    ],
  },
};
