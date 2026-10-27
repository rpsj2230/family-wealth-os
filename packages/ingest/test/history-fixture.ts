/**
 * A synthetic workbook with many monthly tabs, laid out the way the real one drifted over the years but with invented people,
 * banks, numbers and deposit numbers only: an older layout (Bank | Type | ..., a start date missing on some deposits, "Cash" in the
 * maturity column, helper columns with a #DIV/0! cell and a "This Time" date), the current layout (Category, Cash-NRE tags, Invested,
 * P&L, Notes at N), a Summary tab with a total and a "Date of Checking" per month, a table of start dates, a "Copy of" tab, a tab
 * whose title cannot be right, a tab whose contents are newer than its title, a month that does not add up, a month that is missing,
 * and the tabs in scrambled order.
 */
import ExcelJS from 'exceljs';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

export interface Spec {
  /** the bank-and-person heading: "Sample Bank - Asha" */
  bank: string;
  type: string;
  rate?: number;
  start?: string;
  maturity?: string;
  amount?: number;
  mAmount?: number;
  /** the maturity column's tag when the line is not a deposit: "Cash", "Cash-NRE", "SIP Kiran Education", "Cash Loan" ... */
  tag?: string;
  note?: string;
  /** a loan's date, in the Rate column */
  lent?: string;
  /** a fund's start, in the Start column */
  fundStart?: string;
}

export interface TabSpec {
  title: string;
  era: 'old' | 'new';
  rows: Spec[];
  /** the total written on the tab; default: the sum of the amounts */
  total?: number;
  /** a date beside a "This Time" label (old layout) */
  thisTime?: string;
}

export const sum = (rows: Spec[]) => rows.reduce((s, r) => s + (r.amount ?? 0), 0);

function writeTab(wb: ExcelJS.Workbook, t: TabSpec) {
  const ws = wb.addWorksheet(t.title);
  const set = (ref: string, v: ExcelJS.CellValue) => (ws.getCell(ref).value = v);
  if (t.era === 'old') {
    [
      'Bank',
      'Type',
      'Rate',
      'Start Date',
      'Maturity Date',
      'Amount',
      'Maturity Amount',
      'Notes',
    ].forEach((h, i) => set(`${String.fromCharCode(65 + i)}2`, h));
    set('J2', 'Prev Time');
    set('K2', 'This Time');
    set('N3', { formula: '1/0', result: { error: '#DIV/0!' } } as ExcelJS.CellValue);
    if (t.thisTime) {
      set('P7', 'This Time');
      set('Q7', d(t.thisTime));
    }
  } else {
    set('B1', 'Details');
    [
      'Category',
      'Rate',
      'Start Date',
      'Maturity Date',
      'Amount',
      'Maturity ',
      'Invested',
      'P&L',
    ].forEach((h, i) => set(`${String.fromCharCode(66 + i)}2`, h));
    set('K2', 'Goal');
    set('L2', 'Type');
    set('M2', 'Changes Req');
    set('N2', 'Notes');
    set('P2', 'Prev Time');
    if (t.thisTime) {
      set('V6', 'Current');
      set('W6', d(t.thisTime));
    }
  }
  const noteCol = t.era === 'old' ? 'H' : 'N';
  let r = 3;
  for (const s of t.rows) {
    set(`A${r}`, s.bank);
    set(`B${r}`, s.type);
    if (s.lent) set(`C${r}`, d(s.lent));
    else if (s.rate !== undefined) set(`C${r}`, s.rate);
    if (s.start) set(`D${r}`, d(s.start));
    if (s.fundStart) set(`D${r}`, d(s.fundStart));
    if (s.maturity) set(`E${r}`, d(s.maturity));
    else if (s.tag) set(`E${r}`, s.tag);
    if (s.amount !== undefined) set(`F${r}`, s.amount);
    if (s.mAmount !== undefined) set(`G${r}`, s.mAmount);
    if (s.note) set(`${noteCol}${r}`, s.note);
    r++;
  }
  r++;
  set(`A${r}`, 'Total Amount');
  set(`F${r}`, {
    formula: `SUM(F3:F${r - 2})`,
    result: t.total ?? sum(t.rows),
  } as ExcelJS.CellValue);
}

export interface Fixture {
  bytes: Uint8Array;
  tabs: TabSpec[];
}

// ----------------------------------------------------------------------------------------------
// The people and what they hold
// ----------------------------------------------------------------------------------------------
const FD_X = (start?: string): Spec => ({
  bank: 'Sample Bank - Asha',
  type: 'FD',
  rate: 0.0725,
  ...(start ? { start } : {}),
  maturity: '2022-09-01',
  amount: 500_000,
  mAmount: 540_000,
});
const FD_Y = (start?: string): Spec => ({
  bank: 'Second Bank - Vikram',
  type: 'FD',
  rate: 0.065,
  ...(start ? { start } : {}),
  maturity: '2024-05-01',
  amount: 300_000,
  mAmount: 352_000,
});
const FD_Z: Spec = {
  bank: 'Sample Bank - Asha',
  type: 'FD',
  rate: 0.07,
  start: '2021-11-20',
  maturity: '2023-11-20',
  amount: 150_000,
  mAmount: 172_000,
};
/** a short-lived deposit whose start date no tab gives */
const FD_W: Spec = {
  bank: 'Third Bank - Vikram',
  type: 'FD',
  rate: 0.06,
  maturity: '2022-01-15',
  amount: 80_000,
  mAmount: 84_000,
};
const FD_X2: Spec = {
  bank: 'Sample Bank - Asha',
  type: 'FD',
  rate: 0.075,
  start: '2022-09-02',
  maturity: '2024-09-01',
  amount: 520_000,
  mAmount: 600_000,
};
const FD_ON_FILE_1: Spec = {
  bank: 'Sample Bank - Asha',
  type: 'FD-NRE-1111',
  rate: 0.065,
  start: '2024-11-01',
  maturity: '2026-11-01',
  amount: 1_000_000,
  mAmount: 1_160_000,
  note: 'FD Number : 555500001111-1',
};
const FD_ON_FILE_2: Spec = {
  bank: 'Second Bank - Vikram',
  type: 'FD-NRO JO-3333',
  rate: 0.08,
  start: '2025-08-24',
  maturity: '2030-08-24',
  amount: 250_000,
  mAmount: 371_441,
};

/** The older layout's lines of one month. `cash` is what the savings balances were. */
function oldRows(o: {
  deposits: Spec[];
  asha: number;
  vikram: number;
  uob: number;
  atul: number;
  loan: number;
  fund?: number;
  papa?: boolean;
  summaryLine?: number;
  closedCash?: number;
  nro2222?: number;
  extra?: Spec[];
}): Spec[] {
  const rows: Spec[] = [...(o.extra ?? [])];
  for (const dep of o.deposits.filter((x) => x.bank.startsWith('Sample Bank'))) rows.push(dep);
  rows.push({
    bank: 'Sample Bank - Asha',
    type: 'Cash - NRE',
    tag: 'Cash',
    amount: o.asha,
    mAmount: o.asha,
  });
  if (o.nro2222 !== undefined)
    rows.push({ bank: 'Sample Bank - Asha', type: 'Cash - NRO', tag: 'Cash', amount: o.nro2222 });
  for (const dep of o.deposits.filter((x) => x.bank.startsWith('Second Bank'))) rows.push(dep);
  if (o.closedCash !== undefined)
    rows.push({
      bank: 'Second Bank - Vikram',
      type: 'Cash- NRE',
      tag: 'Cash',
      amount: o.closedCash,
    });
  rows.push({ bank: 'Second Bank - Vikram', type: 'Cash - NRO', tag: 'Cash', amount: o.vikram });
  if (o.summaryLine !== undefined)
    rows.push({ bank: 'Third Bank - Asha', type: 'SIP/Share', amount: o.summaryLine });
  if (o.fund !== undefined)
    rows.push(
      {
        bank: 'SIP - Kiran (Asha)',
        type: 'Alpha Small Cap Direct Plan',
        fundStart: '2021-02-01',
        tag: 'SIP Kiran Education',
        amount: o.fund,
        note: '5.09%, NAV-191.33, 12K/Month',
      },
      {
        bank: 'SIP - Kiran (Asha)',
        type: 'Omega Value Fund',
        fundStart: '2021-01-05',
        tag: 'SIP Kiran Education',
        amount: 40_000,
      },
    );
  rows.push({
    bank: 'UOB',
    type: 'Cash',
    amount: o.uob,
    note: 'Base: $1= Rs 60 Bal : $1000',
  });
  rows.push({
    bank: 'Atul IDFC',
    type: 'Cash',
    tag: 'Cash',
    amount: o.atul,
    note: 'Atul account but money is mine',
  });
  rows.push({ bank: 'Others', type: 'Friend Loan', tag: 'Cash', amount: o.loan });
  if (o.papa) rows.push({ bank: 'Others', type: 'Papa', amount: 350_000 });
  return rows;
}

/** The current layout: what is on file after the ordinary import of this tab. */
export function currentRows(o: { asha: number; copyDiffers?: boolean }): Spec[] {
  return [
    FD_ON_FILE_1,
    { bank: 'Sample Bank - Asha', type: 'Cash-NRE-1111', tag: 'Cash-NRE', amount: o.asha },
    { bank: 'Sample Bank - Asha', type: 'Cash-NRO-2222', tag: 'Cash-NRO', amount: 4_000 },
    FD_ON_FILE_2,
    { bank: 'Second Bank - Vikram', type: 'Cash-NRO-4444', tag: 'Cash-NRO', amount: 300 },
    {
      bank: 'SIP - Kiran (Asha)',
      type: 'Alpha Small Cap Direct Plan',
      fundStart: '2021-02-01',
      tag: 'SIP Kiran Education',
      amount: 278_248,
      note: '5.09%, NAV-191.33, 12K/Month',
    },
    {
      bank: 'UOB',
      type: 'Cash',
      tag: 'Cash SG',
      amount: 6_500,
      note: 'Base: $1= Rs 65\nBal : $100.00',
    },
    {
      bank: 'Atul IDFC',
      type: 'Cash',
      tag: 'Cash-NRO',
      amount: 27_748,
      note: 'Atul account but money is mine',
    },
    {
      bank: 'Others',
      type: 'Friend Loan',
      tag: 'Cash Loan',
      lent: '2025-06-20',
      amount: 200_000,
      note: 'Gave to Friend on 20 June 2025.',
    },
  ];
}

export async function buildHistoryWorkbook(): Promise<Fixture> {
  const wb = new ExcelJS.Workbook();
  const oct26 = currentRows({ asha: 25_000 });
  const tabs: TabSpec[] = [];
  const add = (t: TabSpec) => tabs.push(t);

  // newest first, then scrambled: the order of the tab bar is not the order of the months
  add({ title: 'Oct 2026', era: 'new', rows: oct26 });
  add({
    title: 'Copy of Oct 2026',
    era: 'new',
    rows: currentRows({ asha: 25_500 }),
  });
  // contents newer than the title: a deposit that starts years later, in a "Feb 2025" tab
  add({
    title: 'Feb 2025',
    era: 'new',
    rows: [
      FD_ON_FILE_1,
      { ...FD_ON_FILE_2, start: '2026-01-05' },
      { bank: 'Sample Bank - Asha', type: 'Cash-NRE-1111', tag: 'Cash-NRE', amount: 11_111 },
    ],
  });
  add({
    title: 'Sept 2022',
    era: 'old',
    rows: oldRows({
      deposits: [FD_X2, FD_Y('2021-05-01')],
      asha: 21_000,
      vikram: 900,
      uob: 61_000,
      atul: 5_000,
      loan: 50_000,
      fund: 150_000,
      nro2222: 1_500,
    }),
  });
  // a tab whose title is out of place among its neighbours (it is a January, among the tabs of 2021 and 2022)
  add({
    title: 'Jan 2023',
    era: 'old',
    rows: oldRows({
      deposits: [FD_X('2021-03-01'), FD_Y('2021-05-01'), FD_Z],
      asha: 19_500,
      vikram: 880,
      uob: 60_100,
      atul: 4_900,
      loan: 50_000,
      fund: 140_000,
    }),
  });
  add({
    title: 'Mar 2022',
    era: 'old',
    thisTime: '2021-12-27', // left over from the month before: not this month's date
    rows: [
      ...oldRows({
        deposits: [FD_X('2021-03-01'), FD_Y('2021-05-01'), FD_Z],
        asha: 20_500,
        vikram: 850,
        uob: 60_500,
        atul: 5_100,
        loan: 50_000,
        fund: 130_000,
      }),
      // a plain "Cash" line at a bank where two accounts are on file: it could be either
      { bank: 'Sample Bank - Asha', type: 'Cash', tag: 'Cash', amount: 700 },
      // the same deposit number written on two lines of one bank and person
      {
        ...FD_X('2021-03-01'),
        amount: 111_000,
        maturity: '2023-01-01',
        note: 'FD Number : 888800004444',
      },
      {
        ...FD_X('2021-03-01'),
        amount: 222_000,
        maturity: '2023-02-01',
        note: 'FD Number : 888800004444',
      },
    ],
  });
  add({
    title: 'Dec 2021',
    era: 'old',
    rows: oldRows({
      deposits: [FD_X('2021-03-01'), FD_Y('2021-05-01'), FD_Z],
      asha: 20_000,
      vikram: 840,
      uob: 59_000,
      atul: 5_200,
      loan: 50_000,
      closedCash: 3_000,
    }),
    // this month does not add up: the total on the tab is a thousand too high
    total:
      sum(
        oldRows({
          deposits: [FD_X('2021-03-01'), FD_Y('2021-05-01'), FD_Z],
          asha: 20_000,
          vikram: 840,
          uob: 59_000,
          atul: 5_200,
          loan: 50_000,
          closedCash: 3_000,
        }),
      ) + 1_000,
  });
  add({
    title: 'Sep 2021',
    era: 'old',
    rows: oldRows({
      deposits: [FD_X(), FD_Y()],
      asha: 18_000,
      vikram: 800,
      uob: 58_000,
      atul: 5_000,
      loan: 50_000,
      closedCash: 2_500,
    }),
  });
  add({
    title: 'July 2021',
    era: 'old',
    thisTime: '2021-07-20',
    rows: oldRows({
      deposits: [FD_X(), FD_Y()],
      asha: 17_000,
      vikram: 790,
      uob: 57_500,
      atul: 4_800,
      loan: 50_000,
      closedCash: 2_400,
      papa: true,
      extra: [FD_W],
    }),
  });
  add({
    title: 'June 2021',
    era: 'old',
    thisTime: '2021-06-20',
    rows: oldRows({
      deposits: [FD_X(), FD_Y()],
      asha: 16_000,
      vikram: 780,
      uob: 57_000,
      atul: 4_700,
      loan: 50_000,
      closedCash: 2_300,
      papa: true,
      summaryLine: 70_000,
      extra: [FD_W],
    }),
  });

  const t = (title: string) => tabs.find((x) => x.title === title)!;
  const summary = () => {
    const sm = wb.addWorksheet('Summary');
    sm.getCell('A2').value = 'Summary';
    sm.getCell('B2').value = 'Total Amount';
    sm.getCell('G2').value = 'Date of Checking';
    const line = (r: number, label: string, total: number, date?: string) => {
      sm.getCell(`A${r}`).value = label;
      sm.getCell(`B${r}`).value = { formula: 'F1', result: total } as ExcelJS.CellValue;
      if (date) sm.getCell(`G${r}`).value = d(date);
    };
    line(3, 'June 2021', sum(t('June 2021').rows), '2021-06-20');
    line(4, 'July 2021', sum(t('July 2021').rows), '2021-07-20');
    line(5, 'Sep 2021', sum(t('Sep 2021').rows), '2021-09-12');
    line(6, 'Dec 2021', sum(t('Dec 2021').rows) - 1_000, '2021-12-27');
    line(7, 'Mar 2022', sum(t('Mar 2022').rows) + 5_000); // the Summary disagrees with the tab
  };
  // the order of the tab bar: the Summary and the stray tabs among the months, one month out of place
  const order = [
    'Summary',
    'Oct 2026',
    'Copy of Oct 2026',
    'Feb 2025',
    'Sept 2022',
    'Notes',
    'Mar 2022',
    'Jan 2023',
    'Dec 2021',
    'Start Date of the Investment',
    'Sep 2021',
    'July 2021',
    'June 2021',
  ];
  for (const name of order) {
    if (name === 'Summary') summary();
    else if (name === 'Notes') wb.addWorksheet('Notes').getCell('A1').value = 'not a month';
    else if (name === 'Start Date of the Investment') {
      const pv = wb.addWorksheet(name);
      pv.getCell('A2').value = 'Start Date';
      pv.getCell('A4').value = 'Cash Loan';
      pv.getCell('C4').value = 657_000;
    } else writeTab(wb, t(name));
  }
  return { bytes: new Uint8Array(await wb.xlsx.writeBuffer()), tabs };
}
