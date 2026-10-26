/**
 * A synthetic month for the sync tests: invented people, banks, numbers and deposit numbers only. It has the same quirks as the real
 * workbook (overloaded column E, joint lines, a stopped fund, a Singapore balance whose S$ amount lives in the note, a memo row, formulas
 * in G and I, a total row and a Plans block) but no real data.
 */
import { colNumber, dateToSerial } from '../src/sheet-grid';
import type { SyncAsset, SyncOptions } from '../src/sheet-sync';
import { DATE_FMT, NUM_FMT, PCT_FMT, type FakeCell } from './fake-google';

export const OWNERS = ['Asha', 'Vikram', 'Kiran'];
export const OPTS: SyncOptions = {
  owners: OWNERS,
  defaultOwner: 'Asha',
  firstRow: 3,
  lastRow: 113,
};

type V = number | string | { d: string } | { f: string } | undefined;

/** Builds sheet rows from `{ column: value }` maps; a date is `{ d: '2026-11-01' }` and a formula `{ f: '=F5' }`. */
export function build(rows: Record<number, Record<string, V>>): FakeCell[][] {
  const out: FakeCell[][] = [];
  for (const [r, cols] of Object.entries(rows)) {
    const row: FakeCell[] = (out[Number(r) - 1] = []);
    for (const [c, v] of Object.entries(cols)) {
      if (v === undefined) continue;
      const cell: FakeCell = {};
      if (typeof v === 'object' && 'd' in v)
        Object.assign(cell, { v: dateToSerial(v.d), fmt: DATE_FMT });
      else if (typeof v === 'object') {
        cell.f = v.f;
        cell.fmt = NUM_FMT;
      } else {
        cell.v = v;
        if (typeof v === 'number' && 'CFGHI'.includes(c)) cell.fmt = c === 'C' ? PCT_FMT : NUM_FMT;
      }
      row[colNumber(c) - 1] = cell;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] ??= [];
  return out;
}

/** One month's sheet, rows 3 to 18 are the register, row 20 the total, row 22 the Plans block. */
export function monthRows(): FakeCell[][] {
  return build({
    1: {
      B: 'Category',
      C: 'Rate',
      D: 'Start Date',
      E: 'Maturity Date',
      F: 'Amount',
      G: 'Maturity',
      H: 'Invested',
      I: 'P&L',
      M: 'Changes Req',
      N: 'Notes',
    },
    3: {
      A: 'Sample Bank - Asha',
      B: 'FD-NRE-1111',
      C: 0.065,
      D: { d: '2024-11-01' },
      E: { d: '2026-11-01' },
      F: 1_000_000,
      G: 1_160_000,
      N: 'FD Number : 555500001111-1',
    },
    4: {
      B: 'FD-NRE-1111',
      C: 0.07,
      D: { d: '2025-02-10' },
      E: { d: '2027-02-10' },
      F: 500_000,
      G: 575_000,
      N: 'FD Number : 555500002222-1',
    },
    5: { B: 'Cash-NRE-1111', E: 'Cash-NRE', F: 25_000, G: { f: '=F5' } },
    6: { B: 'Cash-NRO-2222', E: 'Cash-NRO', F: 4_000, G: { f: '=F6' }, N: 'AMB - 10K' },
    7: {
      A: 'Second Bank - Vikram',
      B: 'FD-NRO JO-3333',
      C: 0.08,
      D: { d: '2025-08-24' },
      E: { d: '2030-08-24' },
      F: 250_000,
      G: 371_441,
    },
    8: { B: 'Cash-NRO-4444', E: 'Cash-NRO', F: 300, G: { f: '=F8' } },
    9: {
      A: 'UOB',
      B: 'Cash',
      E: 'Cash SG',
      F: 6_500,
      G: { f: '=F9' },
      N: 'Base: $1= Rs 65\nBal : $100.00',
    },
    10: {
      A: 'SIP - Kiran (Asha)\nRs 10k/month',
      B: 'Alpha Small Cap Direct Plan',
      D: { d: '2024-07-26' },
      E: 'SIP Kiran Education',
      F: 278_248,
      G: { f: '=F10' },
      H: 275_986,
      I: { f: '=G10-H10' },
      N: '5.09%, NAV-191.33, 12K/Month',
    },
    11: {
      B: '(STOPPED) Beta Flexi Cap Direct Plan',
      D: { d: '2024-07-26' },
      E: 'SIP Kiran Education',
      F: 193_795,
      G: { f: '=F11' },
      H: 179_991,
      I: { f: '=G11-H11' },
      J: 'today',
    },
    12: {
      B: 'Gamma Wealth Smart Plus',
      D: { d: '2024-06-24' },
      E: 'SIP Retirement',
      F: 60_515,
      G: { f: '=F12' },
      H: 60_515,
      I: { f: '=G12-H12' },
    },
    13: {
      A: 'Others',
      B: 'Friend Loan',
      C: { d: '2025-06-20' },
      D: 'Cash Loan',
      E: 'Cash Loan',
      F: 200_000,
      N: 'Gave to Friend on 20 June 2025.',
    },
    14: { B: 'Papa', E: 'Cash Loan', F: 5_000 },
    15: {
      A: 'Atul IDFC',
      B: 'Cash',
      E: 'Cash-NRO',
      F: 27_748,
      G: { f: '=F15' },
      N: 'Atul account but money is mine',
    },
    16: { A: 'Third Bank - Asha', B: 'FD', M: 'KYC completed' },
    17: { B: 'Cash-NRE-5555', E: 'Cash-NRE', F: 1_000, G: { f: '=F17' } },
    18: { A: 'Fourth Bank - Vikram', B: 'Cash-NRE-6666', E: 'Cash-NRE', F: 700, G: { f: '=F18' } },
    20: { A: 'Total', F: { f: '=SUM(F3:F19)' } },
    22: { A: 'Plans', B: 'Asha', D: 'Vikram', F: 'Kiran' },
    23: { A: 'Term Insurance (Death)', B: 'Sample Life - 1 Crore Cover' },
  });
}

let seq = 0;
const asset = (o: Partial<SyncAsset> & Pick<SyncAsset, 'kind' | 'owner'>): SyncAsset => ({
  id: `a${++seq}`,
  label: '',
  names: [],
  institution: null,
  holder: null,
  last4: null,
  joint: false,
  accountKind: null,
  status: 'active',
  sortOrder: seq,
  value: null,
  foreign: null,
  fd: null,
  fund: null,
  loan: null,
  ...o,
});

/** The app's side of the synthetic month: every line of the sheet, with some figures that moved. */
export function appAssets(): SyncAsset[] {
  seq = 0;
  return [
    asset({
      kind: 'fd',
      owner: 'Asha',
      institution: 'Sample Bank',
      label: 'FD-NRE-1111',
      names: ['FD-NRE-1111'],
      last4: '1111',
      accountKind: 'NRE',
      fd: {
        principal: 1_000_000,
        rate: 0.065,
        bookedOn: '2024-11-01',
        maturityOn: '2026-11-01',
        maturityAmount: 1_161_000,
        ref: '555500001111-1',
      },
    }),
    asset({
      kind: 'fd',
      owner: 'Asha',
      institution: 'Sample Bank',
      label: 'FD-NRE-1111',
      names: ['FD-NRE-1111'],
      last4: '1111',
      accountKind: 'NRE',
      fd: {
        principal: 500_000,
        rate: 0.0725,
        bookedOn: '2025-02-10',
        maturityOn: '2027-02-10',
        maturityAmount: 575_000,
        ref: '555500002222-1',
      },
    }),
    asset({
      kind: 'cash',
      owner: 'Asha',
      institution: 'Sample Bank',
      label: 'Cash-NRE-1111',
      names: ['Cash-NRE-1111'],
      last4: '1111',
      accountKind: 'NRE',
      value: 25_678.123,
    }),
    asset({
      kind: 'cash',
      owner: 'Asha',
      institution: 'Sample Bank',
      label: 'Cash-NRO-2222',
      names: ['Cash-NRO-2222'],
      last4: '2222',
      accountKind: 'NRO',
      value: 4_000,
    }),
    asset({
      kind: 'fd',
      owner: 'Vikram',
      institution: 'Second Bank',
      label: 'FD-NRO JO-3333',
      names: ['FD-NRO JO-3333'],
      last4: '3333',
      accountKind: 'NRO',
      joint: true,
      fd: {
        principal: 250_000,
        rate: 0.08,
        bookedOn: '2025-08-24',
        maturityOn: '2030-08-24',
        maturityAmount: 371_441,
        ref: null,
      },
    }),
    asset({
      kind: 'cash',
      owner: 'Vikram',
      institution: 'Second Bank',
      label: 'Cash-NRO-4444',
      names: ['Cash-NRO-4444'],
      last4: '4444',
      accountKind: 'NRO',
      status: 'closed',
      value: 0,
    }),
    asset({
      kind: 'cash_sg',
      owner: 'Asha',
      institution: 'UOB',
      label: 'UOB S$ account',
      names: ['UOB S$ account'],
      value: 7_426,
      foreign: { amount: 100, rate: 74.26 },
    }),
    asset({
      kind: 'fund',
      owner: 'Asha',
      label: 'Alpha Small Cap Direct Plan',
      names: ['Alpha Small Cap Direct Plan'],
      value: 281_000.5,
      fund: { invested: 276_000, startedOn: '2024-07-26', stopped: false },
    }),
    asset({
      kind: 'fund',
      owner: 'Asha',
      label: 'Beta Flexi Cap Direct Plan',
      names: ['Beta Flexi Cap Direct Plan'],
      status: 'stopped',
      value: 194_000,
      fund: { invested: 180_000, startedOn: '2024-07-26', stopped: true },
    }),
    asset({
      kind: 'ulip',
      owner: 'Asha',
      label: 'Gamma Wealth Smart Plus',
      names: ['Gamma Wealth Smart Plus'],
      value: 61_000,
    }),
    asset({
      kind: 'loan',
      owner: 'Asha',
      label: 'Friend Loan (2025-06-20)',
      names: ['Friend Loan (2025-06-20)'],
      value: 150_000,
      loan: { counterparty: 'Friend Loan', lentOn: '2025-06-20' },
    }),
    asset({
      kind: 'third_party',
      owner: 'Asha',
      institution: 'IDFC',
      holder: 'Atul',
      label: 'Account held by Atul',
      names: ['Account held by Atul'],
      accountKind: 'NRO',
      value: 30_000,
    }),
    asset({
      kind: 'cash',
      owner: 'Asha',
      institution: 'Third Bank',
      label: 'Cash-NRE-5555',
      names: ['Cash-NRE-5555'],
      last4: '5555',
      accountKind: 'NRE',
      value: 1_000,
    }),
    asset({
      kind: 'cash',
      owner: 'Vikram',
      institution: 'Fourth Bank',
      label: 'Cash-NRE-6666',
      names: ['Cash-NRE-6666'],
      last4: '6666',
      accountKind: 'NRE',
      value: 700,
    }),
  ];
}

/** Accounts the app has that the sheet does not: some can get a row under their group, some must be placed by hand. */
export function newAssets(): SyncAsset[] {
  return [
    asset({
      kind: 'fd',
      owner: 'Asha',
      institution: 'Sample Bank',
      label: '',
      names: [],
      last4: '7777',
      accountKind: 'NRE',
      fd: {
        principal: 300_000,
        rate: 0.071,
        bookedOn: '2026-10-05',
        maturityOn: '2027-10-05',
        maturityAmount: 322_000,
        ref: '555500007777-1',
      },
    }),
    asset({
      kind: 'cash',
      owner: 'Vikram',
      institution: 'Second Bank',
      label: '',
      names: [],
      last4: '8888',
      accountKind: 'NRE',
      value: 12_000,
    }),
    asset({
      kind: 'fd',
      owner: 'Asha',
      institution: 'Unlisted Bank',
      label: '',
      names: [],
      accountKind: 'NRE',
      fd: {
        principal: 100_000,
        rate: 0.07,
        bookedOn: '2026-09-01',
        maturityOn: '2027-09-01',
        maturityAmount: 107_000,
        ref: null,
      },
    }),
    asset({
      kind: 'loan',
      owner: 'Asha',
      label: 'Colleague Loan',
      names: ['Colleague Loan'],
      value: 15_000,
      loan: { counterparty: 'Colleague Loan', lentOn: '2026-09-01' },
    }),
    asset({
      kind: 'fund',
      owner: 'Asha',
      label: 'Delta Index Fund Direct',
      names: ['Delta Index Fund Direct'],
      value: 50_000,
      fund: { invested: 48_000, startedOn: '2026-01-05', stopped: false },
    }),
  ];
}
