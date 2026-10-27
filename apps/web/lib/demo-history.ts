/**
 * Invented results for the public sample of Import > History from all monthly tabs, and an invented coverage grid. The sample page
 * shows the preview, the conflict choices, the progress and the coverage panel without any file being read or anything saved.
 */
import { buildCoverage, type Coverage } from '@fwos/core';
import type { AccountChoice, HistoryConflict, IdentityLine } from '@fwos/ingest';
import {
  applyPins,
  type HistoryView,
  type Pins,
  type ViewHistorical,
  type ViewMonth,
} from './history-view';

type Base = Pick<ViewMonth, 'tab' | 'month' | 'asOf' | 'asOfSource'>;

function month(
  b: Base,
  rows: number,
  matched: number,
  created: number,
  unmatched: number,
  extra: Partial<ViewMonth> = {},
): ViewMonth {
  const verdict = extra.verdict ?? 'ok';
  return {
    ...b,
    copyOf: null,
    asOfNote: null,
    layout: {
      headerRow: 2,
      standard: false,
      found: ['Rate', 'Start Date', 'Amount'],
      totalRef: 'F40',
    },
    rowsRead: rows,
    matched,
    created,
    unmatched,
    unmatchedRows: [],
    identities: [],
    assumed: { agree: 0, differ: 0, unchecked: 0 },
    checks: [
      {
        label: "The lines read add up to the tab's own total (F40)",
        expected: 1_000_000,
        actual: verdict === 'ok' ? 1_000_000 : 999_000,
        ok: verdict === 'ok',
      },
    ],
    verdict,
    difference: verdict === 'ok' ? 0 : -1000,
    summaryTotal: null,
    warnings: [],
    doubt: null,
    likeTab: null,
    overridden: false,
    counts: { new: matched, identical: 0, conflicts: 0, copyDropped: 0, checks: 1 },
    selectable: true,
    defaultSelected: verdict === 'ok',
    ...extra,
  };
}

const CONFLICT: HistoryConflict = {
  id: 'Mar 2022|F9',
  tab: 'Mar 2022',
  cell: 'F9',
  assetId: 'a-cash-1',
  assetLabel: 'Sample Bank Cash-NRE-1100',
  asOf: '2022-03-31',
  currency: 'INR',
  sheetAmount: 18_000,
  existing: { id: 'o-1', amount: 18_500, source: 'manual', confidence: 'manual_confirmed' },
};

const HISTORICAL: ViewHistorical[] = [
  {
    key: 'fd1',
    kind: 'fd',
    label: 'FD',
    ownerName: 'Anil',
    bank: 'Sample Bank',
    firstSeen: '2021-06',
    lastSeen: '2022-03',
    endedOn: '2022-09-01',
    status: 'matured',
    principal: 500_000,
    rate: 0.0725,
    maturityOn: '2022-09-01',
    startEstimated: false,
    gaps: 0,
    skipReason: null,
  },
  {
    key: 'fd2',
    kind: 'fd',
    label: 'FD',
    ownerName: 'Beena',
    bank: 'Second Bank',
    firstSeen: '2021-06',
    lastSeen: '2021-12',
    endedOn: '2022-03-31',
    status: 'closed',
    principal: 80_000,
    rate: 0.06,
    maturityOn: '2023-01-15',
    startEstimated: true,
    gaps: 0,
    skipReason: null,
  },
  {
    key: 'c1',
    kind: 'cash',
    label: 'Cash- NRE',
    ownerName: 'Beena',
    bank: 'Second Bank',
    firstSeen: '2021-06',
    lastSeen: '2021-12',
    endedOn: '2022-03-31',
    status: 'closed',
    principal: null,
    rate: null,
    maturityOn: null,
    startEstimated: false,
    gaps: 0,
    skipReason: null,
  },
];

const acct = (id: string, label: string, detail: string): AccountChoice => ({ id, label, detail });
const NRE_1100 = acct('a-nre-1100', 'Cash-NRE-1100', 'NRE, ending 1100');
const NRO_2200 = acct('a-nro-2200', 'Cash-NRO-2200', 'NRO, ending 2200');
const NRE_3300 = acct('a-nre-3300', 'Cash-NRE-3300', 'NRE, ending 3300');
const NRE_4400 = acct('a-nre-4400', 'Cash-NRE-4400', 'NRE, ending 4400');
const NRO_4500 = acct('a-nro-4500', 'Cash-NRO-4500', 'NRO, ending 4500');
const JOINT_0278 = acct('a-nre-0278', 'Cash-NRE JO-0278', 'NRE, joint, ending 0278');

/** Invented lines the tabs do not identify: one of each kind of answer the real page gives. */
const line = (
  l: Partial<IdentityLine> & Pick<IdentityLine, 'id' | 'tab' | 'cell' | 'state'>,
): IdentityLine => ({
  label: 'Cash',
  bank: 'Sample Bank',
  owner: 'Anil',
  amount: 700,
  currency: 'INR',
  position: 1,
  of: 2,
  accepted: l.state === 'certain',
  account: null,
  candidates: [],
  others: [],
  why: '',
  fromTabs: [],
  contradiction: null,
  sameAs: [],
  ...l,
});

const SEP_2021_LINES: IdentityLine[] = [
  line({
    id: 'Sep 2021|F10',
    tab: 'Sep 2021',
    cell: 'F10',
    state: 'certain',
    amount: 1_200,
    account: NRE_1100,
    candidates: [NRE_1100, NRO_2200],
    why: 'Same position (1st of 2) in Sample Bank - Anil as in the June 2021 and Dec 2021 tabs, where it is the NRE account Cash-NRE-1100.',
    fromTabs: ['June 2021', 'Dec 2021'],
  }),
  line({
    id: 'Sep 2021|F11',
    tab: 'Sep 2021',
    cell: 'F11',
    state: 'certain',
    amount: 3_400,
    position: 2,
    account: NRO_2200,
    candidates: [NRO_2200, NRE_1100],
    why: 'Same position (2nd of 2) in Sample Bank - Anil as in the June 2021 and Dec 2021 tabs, where it is the NRO account Cash-NRO-2200.',
    fromTabs: ['June 2021', 'Dec 2021'],
  }),
];
const DEC_2021_LINES: IdentityLine[] = [
  line({
    id: 'Dec 2021|F12',
    tab: 'Dec 2021',
    cell: 'F12',
    state: 'ambiguous',
    amount: 650,
    candidates: [NRE_1100, NRO_2200],
    others: [JOINT_0278],
    why: 'Could be the NRE account Cash-NRE-1100 or the NRO account Cash-NRO-2200. The order of the accounts in the Sep 2021 and Mar 2022 tabs does not settle it, and neither do the balances next door. Choose the account yourself.',
    fromTabs: ['Sep 2021', 'Mar 2022'],
    sameAs: ['Mar 2022|F12'],
  }),
  line({
    id: 'Dec 2021|F14',
    tab: 'Dec 2021',
    cell: 'F14',
    state: 'likely',
    bank: 'Second Bank',
    owner: 'Beena',
    amount: 500,
    position: 1,
    of: 1,
    account: NRE_3300,
    candidates: [NRE_3300],
    why: 'Second Bank - Beena has 1 line here against 1 in Sep 2021 and 2 in Mar 2022. Keeping the listed order and leaving out the account opened in between (the NRO account Cash-NRO-3400), this 1st line is the NRE account Cash-NRE-3300. Confirm it to use it.',
    fromTabs: ['Sep 2021', 'Mar 2022'],
  }),
];
const MAR_2022_LINES: IdentityLine[] = [
  line({
    id: 'Mar 2022|F12',
    tab: 'Mar 2022',
    cell: 'F12',
    state: 'ambiguous',
    amount: 700,
    candidates: [NRE_1100, NRO_2200],
    others: [JOINT_0278],
    why: 'Could be the NRE account Cash-NRE-1100 or the NRO account Cash-NRO-2200. The order of the accounts in the Dec 2021 and Jan 2024 tabs does not settle it, and neither do the balances next door. Choose the account yourself.',
    fromTabs: ['Dec 2021', 'Jan 2024'],
    sameAs: ['Dec 2021|F12'],
  }),
  line({
    id: 'Mar 2022|F20',
    tab: 'Mar 2022',
    cell: 'F20',
    state: 'blocked',
    bank: 'Third Bank',
    amount: 4_200_000,
    position: 1,
    of: 2,
    account: NRE_4400,
    candidates: [NRE_4400, NRO_4500],
    why: 'Not inferred. It would be the NRE account Cash-NRE-4400 (its place in the Dec 2021 and Jan 2024 tabs), but its balance of ₹42,00,000 is far from what the NRE account Cash-NRE-4400 held next door (₹800 in Dec 2021 and ₹900 in Jan 2024). Choose the account yourself.',
    fromTabs: ['Dec 2021', 'Jan 2024'],
    contradiction:
      'Its balance of ₹42,00,000 is far from what the NRE account Cash-NRE-4400 held next door (₹800 in Dec 2021 and ₹900 in Jan 2024).',
  }),
];

const BASE: HistoryView = {
  months: [
    month(
      { tab: 'June 2021', month: '2021-06', asOf: '2021-06-20', asOfSource: 'summary' },
      26,
      14,
      9,
      3,
    ),
    month(
      { tab: 'Sep 2021', month: '2021-09', asOf: '2021-09-12', asOfSource: 'summary' },
      28,
      15,
      10,
      3,
      { identities: SEP_2021_LINES },
    ),
    month(
      { tab: 'Dec 2021', month: '2021-12', asOf: '2021-12-31', asOfSource: 'month_end' },
      30,
      16,
      11,
      3,
      { verdict: 'mismatch', defaultSelected: false, identities: DEC_2021_LINES },
    ),
    month(
      { tab: 'Mar 2022', month: '2022-03', asOf: '2022-03-31', asOfSource: 'month_end' },
      31,
      17,
      11,
      3,
      {
        identities: MAR_2022_LINES,
        counts: { new: 16, identical: 0, conflicts: 1, copyDropped: 0, checks: 2 },
        unmatchedRows: [
          {
            cell: 'F12',
            label: 'Cash',
            owner: 'Anil',
            bank: 'Sample Bank',
            amount: 700,
            reason:
              '2 accounts fit this line (Cash-NRE-1100; Cash-NRO-2200), so it was not guessed.',
            why: 'ambiguous',
          },
          {
            cell: 'F31',
            label: 'Omega Value Fund',
            owner: 'Anil',
            bank: null,
            amount: 40_000,
            reason:
              'No fund on file has this name. A fund is never created from a monthly line; add it from a fund statement.',
            why: 'not_on_file',
          },
        ],
      },
    ),
    month(
      { tab: 'Jan 2023', month: '2023-01', asOf: '2023-01-31', asOfSource: 'month_end' },
      32,
      19,
      11,
      2,
      {
        defaultSelected: false,
        doubt: {
          kinds: ['newer_contents', 'out_of_order'],
          text: 'Its contents are newer than its date: a deposit starts on 2023-07-30, long after 2023-01-31. It is probably a copy of a later month. Its title looks wrong: it sits between 2024-03 and 2023-12 in the tab bar.',
          suggested: '2024-01',
        },
        likeTab: 'Dec 2023 (96% of its deposits are the same)',
      },
    ),
    month(
      { tab: 'Oct 2026', month: '2026-10', asOf: '2026-10-26', asOfSource: 'today' },
      40,
      40,
      0,
      0,
      {
        counts: { new: 0, identical: 34, conflicts: 0, copyDropped: 0, checks: 6 },
        warnings: ['The month is not over; dated today.'],
      },
    ),
    month(
      { tab: 'Copy of Oct 2026', month: '2026-10', asOf: '2026-10-26', asOfSource: 'today' },
      40,
      40,
      0,
      0,
      {
        copyOf: 'Oct 2026',
        defaultSelected: false,
        counts: { new: 0, identical: 0, conflicts: 0, copyDropped: 34, checks: 0 },
        warnings: [
          'A copy of "Oct 2026". Values the original already has are never replaced by this copy.',
        ],
      },
    ),
  ],
  skipped: [
    {
      tab: 'Summary',
      reason:
        'Not a month. Its 5 monthly totals and check dates are used to double-check the months.',
    },
    {
      tab: 'Start Date of the Investment',
      reason: 'Not a month: a table of start dates and amounts. It is not read.',
    },
  ],
  historical: HISTORICAL,
  conflicts: [CONFLICT],
  renewals: [
    {
      from: 'fd1',
      to: 'fd9',
      month: '2022-09',
      text: 'Sample Bank (Anil): the deposit of 5,00,000 maturing 2022-09-01 is missing from 2022-09, the month a deposit of 5,20,000 maturing 2024-09-01 first appears. It may have been renewed. Not linked; link it yourself if so.',
    },
  ],
  summary: {
    months: 6,
    from: '2021-06',
    to: '2026-10',
    notAdding: 1,
    unchecked: 0,
    doubtful: 1,
    closedDeposits: 2,
    closedAccounts: 1,
    conflicts: 1,
    matched: 147,
    unmatched: 14,
    newValues: 71,
    identicalValues: 34,
    identities: { certain: 0, likely: 0, pinned: 0, open: 0, blocked: 0, leftOut: 0 },
    assumed: { agree: 0, differ: 0, unchecked: 0 },
  },
};

/** The sample preview; choosing a month for the tab in doubt makes it an ordinary month, as the real page does. */
export function demoHistoryView(
  overrides: Record<string, string> = {},
  pins: Pins = {},
): HistoryView {
  const v = applyPins(structuredClone(BASE), pins);
  for (const m of v.months) {
    const ym = overrides[m.tab];
    if (!ym) continue;
    m.month = ym;
    m.overridden = true;
    if (m.doubt) {
      m.warnings.push(`You chose to use this tab as ${ym}.`);
      m.doubt = null;
      m.defaultSelected = m.verdict === 'ok';
      m.asOf = `${ym}-28`;
    }
  }
  v.summary.doubtful = v.months.filter((m) => m.doubt).length;
  return v;
}

/** An invented coverage grid for the public sample. */
export function demoCoverage(): Coverage {
  const cash = (id: string, label: string, owner: string, bank: string, status = 'active') => ({
    id,
    label,
    owner,
    bank,
    kind: 'cash' as const,
    status,
  });
  const months = (from: string, to: string, skip: string[] = []) => {
    const out: string[] = [];
    let [y, m] = from.split('-').map(Number) as [number, number];
    const [ty, tm] = to.split('-').map(Number) as [number, number];
    while (y < ty || (y === ty && m <= tm)) {
      const k = `${y}-${String(m).padStart(2, '0')}`;
      if (!skip.includes(k)) out.push(k);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return out;
  };
  const obs = (id: string, ms: string[]) => ms.map((m) => ({ asset_id: id, as_of: `${m}-28` }));
  return buildCoverage(
    [
      cash('c1', 'Cash-NRE-1100', 'Anil', 'Sample Bank'),
      cash('c2', 'Cash-NRO-2200', 'Anil', 'Sample Bank'),
      cash('c3', 'Cash-NRE-3300', 'Beena', 'Second Bank'),
      cash('c4', 'Cash- NRE', 'Beena', 'Third Bank', 'closed'),
      {
        id: 'f1',
        label: 'FD-NRE-1100',
        owner: 'Anil',
        bank: 'Sample Bank',
        kind: 'fd',
        status: 'active',
        from: '2024-11-01',
        to: '2026-11-01',
      },
      {
        id: 'f2',
        label: 'FD',
        owner: 'Beena',
        bank: 'Second Bank',
        kind: 'fd',
        status: 'matured',
        from: '2021-06-20',
        to: '2022-03-31',
      },
    ],
    [
      ...obs(
        'c1',
        months('2021-06', '2026-10', ['2021-08', '2021-10', '2021-11', '2022-01', '2022-02']),
      ),
      ...obs('c2', months('2022-09', '2026-10')),
      ...obs('c3', months('2021-06', '2026-07', ['2023-02'])),
      ...obs('c4', months('2021-06', '2021-12')),
    ],
    '2026-10-26',
  );
}
