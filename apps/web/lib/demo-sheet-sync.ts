/**
 * The public sample of "Sync with Google Sheet": an invented month, an invented set of accounts, and the real planner run over them.
 * Nothing here talks to Google; the sample pages show this preview so the feature can be seen without any connection.
 */
import {
  planSheetSync,
  syncView,
  type GridCell,
  type SyncAsset,
  type SyncView,
} from '@fwos/ingest';
import { SheetGrid } from '@fwos/ingest';
import type { GsheetTestState } from '@/app/(app)/gsheet/actions';
import type { SheetSyncInfo } from './sheet-sync-status';

export const DEMO_SYNC_INFO: SheetSyncInfo = {
  connected: true,
  hasId: true,
  keySet: true,
  sheetUrl: 'https://example.com/a-sample-google-sheet',
  email: 'portal-sync@sample-project.iam.gserviceaccount.com',
  tested: {
    at: '2026-10-25T09:00:00Z',
    ok: true,
    note: 'Found 12 month tabs; the next sync fills Oct 2026',
  },
  last: {
    at: '2026-09-27T08:00:00Z',
    ok: true,
    month: 'Sep 2026',
    note: '14 changed, 1 added, 31 cells written',
  },
};

export const DEMO_TEST: GsheetTestState = {
  ran: true,
  ok: true,
  target: 'Oct 2026',
  template: 'Sep 2026',
  monthTabs: [
    'Oct 2025',
    'Nov 2025',
    'Dec 2025',
    'Jan 2026',
    'Feb 2026',
    'Mar 2026',
    'Apr 2026',
    'May 2026',
    'Jun 2026',
    'Jul 2026',
    'Aug 2026',
    'Sep 2026',
  ],
  steps: [
    {
      ok: true,
      text: 'The service-account key was read. It signs in as portal-sync@sample-project.iam.gserviceaccount.com.',
    },
    {
      ok: true,
      text: 'Google accepted the key. The spreadsheet “Summary - Bank Reports (sample)” has 13 tabs.',
    },
    {
      ok: true,
      text: 'Month tabs found: Mar 2026, Apr 2026, May 2026, Jun 2026, Jul 2026, Aug 2026 and 6 older.',
    },
    {
      ok: true,
      text: 'This month has no tab yet. A sync copies “Sep 2026” (the latest earlier month) into a new tab named “Oct 2026”, placed to its left.',
    },
    {
      ok: true,
      text: 'The layout of “Sep 2026” is recognised: 9 lines (3 deposits, 3 balances, 2 funds, 1 loan, 0 held by others).',
    },
    {
      ok: true,
      text: 'The service account may edit the spreadsheet. (This step sets the file name to what it already is; nothing else is changed.)',
    },
  ],
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dateText = (iso: string) =>
  `${Number(iso.slice(8))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

type V = number | string | { d: string } | { f: string; v: number } | undefined;

/** Sheet rows from `{ column: value }` maps: a date is `{ d }`, a formula `{ f, v }` (its text and what it shows). */
function sheet(rows: Record<number, Record<string, V>>): SheetGrid {
  const out: GridCell[][] = [];
  const empty: GridCell = { value: null, formula: null, text: '', isDate: false, pattern: null };
  for (const [r, cols] of Object.entries(rows)) {
    const row: GridCell[] = (out[Number(r) - 1] = []);
    for (const [col, v] of Object.entries(cols)) {
      if (v === undefined) continue;
      const at = col.charCodeAt(0) - 65;
      row[at] =
        typeof v === 'object' && 'd' in v
          ? {
              value: new Date(`${v.d}T00:00:00Z`),
              formula: null,
              text: dateText(v.d),
              isDate: true,
              pattern: 'd mmm yyyy',
            }
          : typeof v === 'object'
            ? {
                value: v.v,
                formula: v.f,
                text: v.v.toLocaleString('en-IN'),
                isDate: false,
                pattern: null,
              }
            : {
                value: v,
                formula: null,
                text:
                  typeof v === 'number'
                    ? col === 'C'
                      ? `${(v * 100).toFixed(2)}%`
                      : v.toLocaleString('en-IN')
                    : v,
                isDate: false,
                pattern: null,
              };
    }
    for (let i = 0; i < row.length; i++) row[i] ??= empty;
  }
  for (let i = 0; i < out.length; i++) out[i] ??= [];
  return new SheetGrid(out);
}

/** A last-month sheet with the usual quirks, and the accounts as the app knows them today. */
function demoGrid(): SheetGrid {
  return sheet({
    3: {
      A: 'Sample Equity Bank - Anil',
      B: 'FD-NRE-1101',
      C: 0.0725,
      D: { d: '2025-10-26' },
      E: { d: '2026-11-01' },
      F: 500_000,
      G: 640_000,
      N: 'FD Number : 300017791101-1',
    },
    4: { B: 'Cash-NRE-1100', E: 'Cash-NRE', F: 40_000, G: { f: '=F4', v: 40_000 } },
    5: {
      A: 'Sample Jan Bank - Beena',
      B: 'Cash-NRO-1117',
      E: 'Cash-NRO',
      F: 128_000,
      G: { f: '=F5', v: 128_000 },
    },
    6: {
      B: 'FD-NRO-1117',
      C: 0.0675,
      D: { d: '2025-10-26' },
      E: { d: '2028-01-20' },
      F: 650_000,
      G: 800_000,
    },
    7: {
      A: 'SIP - Beena (Anil)',
      B: 'Sample Flexi Cap Fund',
      D: { d: '2024-04-05' },
      E: 'SIP Beena Education',
      F: 600_000,
      G: { f: '=F7', v: 600_000 },
      H: 520_000,
      I: { f: '=G7-H7', v: 80_000 },
      N: 'NAV-48.20, 10K/Month',
    },
    8: {
      B: '(STOPPED) Sample Small Cap Fund',
      D: { d: '2024-04-05' },
      E: 'SIP Beena Education',
      F: 350_000,
      G: { f: '=F8', v: 350_000 },
      H: 300_000,
      I: { f: '=G8-H8', v: 50_000 },
    },
    9: {
      A: 'Others',
      B: 'Loan to a relative',
      C: { d: '2025-06-20' },
      D: 'Cash Loan',
      E: 'Cash Loan',
      F: 200_000,
    },
    10: {
      A: 'Sample Old Bank - Anil',
      B: 'Cash-NRE-0099',
      E: 'Cash-NRE',
      F: 1_000,
      G: { f: '=F10', v: 1_000 },
    },
    11: {
      A: 'Sample Closed Bank - Beena',
      B: 'FD-NRO-4455',
      C: 0.07,
      D: { d: '2025-04-04' },
      E: { d: '2026-10-04' },
      F: 100_000,
      G: 107_000,
    },
    13: { A: 'Total', F: { f: '=SUM(F3:F12)', v: 2_369_000 } },
    15: { A: 'Plans', B: 'Anil', D: 'Beena' },
  });
}

function demoAssets(): SyncAsset[] {
  let n = 0;
  const base = (o: Partial<SyncAsset> & Pick<SyncAsset, 'kind' | 'owner'>): SyncAsset => ({
    id: `d${++n}`,
    label: '',
    names: [],
    institution: null,
    holder: null,
    last4: null,
    joint: false,
    accountKind: null,
    status: 'active',
    sortOrder: n,
    value: null,
    foreign: null,
    fd: null,
    fund: null,
    loan: null,
    ...o,
  });
  return [
    base({
      kind: 'fd',
      owner: 'Anil',
      institution: 'Sample Equity Bank',
      label: 'FD-NRE-1101',
      names: ['FD-NRE-1101'],
      last4: '1101',
      accountKind: 'NRE',
      fd: {
        principal: 500_000,
        rate: 0.0725,
        bookedOn: '2025-10-26',
        maturityOn: '2026-11-01',
        maturityAmount: 640_000,
        ref: '300017791101-1',
      },
    }),
    base({
      kind: 'cash',
      owner: 'Anil',
      institution: 'Sample Equity Bank',
      label: 'Cash-NRE-1100',
      names: ['Cash-NRE-1100'],
      last4: '1100',
      accountKind: 'NRE',
      value: 47_315.42,
    }),
    base({
      kind: 'cash',
      owner: 'Beena',
      institution: 'Sample Jan Bank',
      label: 'Cash-NRO-1117',
      names: ['Cash-NRO-1117'],
      last4: '1117',
      accountKind: 'NRO',
      value: 128_000,
    }),
    base({
      kind: 'fd',
      owner: 'Beena',
      institution: 'Sample Jan Bank',
      label: 'FD-NRO-1117',
      names: ['FD-NRO-1117'],
      last4: '1117',
      accountKind: 'NRO',
      fd: {
        principal: 650_000,
        rate: 0.0675,
        bookedOn: '2025-10-26',
        maturityOn: '2028-01-20',
        maturityAmount: 812_400,
        ref: '300017791117-1',
      },
    }),
    base({
      kind: 'fund',
      owner: 'Anil',
      label: 'Sample Flexi Cap Fund',
      names: ['Sample Flexi Cap Fund'],
      value: 634_870.35,
      fund: { invested: 540_000, startedOn: '2024-04-05', stopped: false },
    }),
    base({
      kind: 'fund',
      owner: 'Anil',
      label: 'Sample Small Cap Fund',
      names: ['Sample Small Cap Fund'],
      status: 'stopped',
      value: 361_220.1,
      fund: { invested: 300_000, startedOn: '2024-04-05', stopped: true },
    }),
    base({
      kind: 'loan',
      owner: 'Anil',
      label: 'Loan to a relative',
      names: ['Loan to a relative'],
      value: 150_000,
      loan: { counterparty: 'Loan to a relative', lentOn: '2025-06-20' },
    }),
    base({
      kind: 'fd',
      owner: 'Beena',
      institution: 'Sample Closed Bank',
      label: 'FD-NRO-4455',
      names: ['FD-NRO-4455'],
      last4: '4455',
      accountKind: 'NRO',
      status: 'renewed',
      fd: {
        principal: 100_000,
        rate: 0.07,
        bookedOn: '2025-04-04',
        maturityOn: '2026-10-04',
        maturityAmount: 107_000,
        ref: null,
      },
    }),
    // in the app, not in the sheet yet: one fits under an existing heading, one has no heading to go under
    base({
      kind: 'fd',
      owner: 'Beena',
      institution: 'Sample Jan Bank',
      label: '',
      names: [],
      last4: '1117',
      accountKind: 'NRO',
      fd: {
        principal: 300_000,
        rate: 0.071,
        bookedOn: '2026-10-05',
        maturityOn: '2027-10-05',
        maturityAmount: 322_000,
        ref: '300017795005-1',
      },
    }),
    base({
      kind: 'fd',
      owner: 'Anil',
      institution: 'Sample New Bank',
      label: '',
      names: [],
      accountKind: 'NRE',
      fd: {
        principal: 200_000,
        rate: 0.0725,
        bookedOn: '2026-10-12',
        maturityOn: '2027-10-12',
        maturityAmount: 215_000,
        ref: null,
      },
    }),
  ];
}

/** The preview the public sample pages show: the real planner over the invented sheet and accounts. */
export function demoSyncView(): SyncView {
  const plan = planSheetSync(demoGrid(), demoAssets(), {
    owners: ['Anil', 'Beena'],
    defaultOwner: 'Anil',
    firstRow: 3,
    lastRow: 113,
  });
  return syncView(plan, 'preview', {
    target: { title: 'Oct 2026', existed: false, copiedFrom: 'Sep 2026', position: 'left' },
    backup: null,
    today: '2026-10-26',
  });
}
