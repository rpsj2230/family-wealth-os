import { beforeAll, describe, expect, it } from 'vitest';
import { planHistory, type HistoryExisting, type HistoryPlan } from '../src/history';
import { classifyHistoryRow, detectLayout, outOfSequence } from '../src/history-layout';
import { planWorkbook } from '../src/workbook';
import { buildHistoryWorkbook, type Fixture } from './history-fixture';
import { existingFromPlan } from './history-existing';

const OWNERS = ['Asha', 'Vikram', 'Kiran'];
const TODAY = '2026-10-27';

let fx: Fixture;
let existing: HistoryExisting;
let plan: HistoryPlan;
const month = (tab: string) => plan.months.find((m) => m.tab === tab)!;

beforeAll(async () => {
  fx = await buildHistoryWorkbook();
  // what the database holds after the latest tab was imported the ordinary way
  const cur = await planWorkbook(fx.bytes, {
    asOf: '2026-10-25',
    sheetName: 'Oct 2026',
    ownerNames: OWNERS,
    defaultOwner: 'Asha',
  });
  existing = existingFromPlan(cur);
  plan = await planHistory(fx.bytes, { today: TODAY, ownerNames: OWNERS, existing });
});

describe('which tabs are read', () => {
  it('reads every month tab in any tab order, oldest first, and says why the others were skipped', () => {
    expect(plan.months.map((m) => m.tab)).toEqual([
      'June 2021',
      'July 2021',
      'Sep 2021',
      'Dec 2021',
      'Mar 2022',
      'Sept 2022',
      'Jan 2023',
      'Feb 2025',
      'Oct 2026',
      'Copy of Oct 2026',
    ]);
    const why = Object.fromEntries(plan.skipped.map((s) => [s.tab, s.reason]));
    expect(why['Notes']).toMatch(/not named like a month/i);
    expect(why['Start Date of the Investment']).toMatch(/table of start dates/i);
    expect(why['Summary']).toMatch(/double-check/i);
  });

  it('knows a month that is missing (August 2021) is simply not there', () => {
    expect(plan.months.some((m) => m.month === '2021-08')).toBe(false);
  });

  it('reads "Sept" and "June" as months', () => {
    expect(month('Sept 2022').month).toBe('2022-09');
    expect(month('June 2021').month).toBe('2021-06');
  });
});

describe('the date of a tab', () => {
  it("prefers the Summary tab's date of checking, then the tab's own date cell, then the month end", () => {
    expect(month('June 2021')).toMatchObject({ asOf: '2021-06-20', asOfSource: 'summary' });
    expect(month('Sep 2021')).toMatchObject({ asOf: '2021-09-12', asOfSource: 'summary' });
    expect(month('Sept 2022')).toMatchObject({ asOf: '2022-09-30', asOfSource: 'month_end' });
  });

  it('ignores a date cell left over from another month and says so', () => {
    const m = month('Mar 2022');
    expect(m.asOfSource).toBe('month_end');
    expect(m.asOf).toBe('2022-03-31');
    expect(m.warnings.join(' ')).toMatch(/2021-12-27.*not in 2022-03/);
  });

  it('dates a month that is not over today, never in the future', () => {
    expect(month('Oct 2026')).toMatchObject({ asOf: TODAY, asOfSource: 'today' });
  });
});

describe('does a tab add up', () => {
  it('passes a month whose lines add up to its own total and to the Summary', () => {
    expect(month('June 2021')).toMatchObject({
      verdict: 'ok',
      difference: 0,
      defaultSelected: true,
    });
  });

  it('flags a month that does not add up, with the difference, and does not select it', () => {
    const m = month('Dec 2021');
    expect(m.verdict).toBe('mismatch');
    expect(m.difference).toBe(-1000);
    expect(m.defaultSelected).toBe(false);
    expect(m.checks.some((c) => !c.ok && /own total/.test(c.label))).toBe(true);
  });

  it('flags a tab that adds up but disagrees with the Summary tab', () => {
    const m = month('Mar 2022');
    expect(m.difference).toBe(0);
    expect(m.verdict).toBe('mismatch');
    expect(m.checks.some((c) => !c.ok && /Summary/.test(c.label))).toBe(true);
  });

  it('counts the memo line and the combined fund line an older tab included in its total', () => {
    expect(month('June 2021').verdict).toBe('ok');
    expect(month('June 2021').unmatchedRows.some((u) => /combined line/i.test(u.reason))).toBe(
      true,
    );
  });
});

describe('tabs that cannot be what their title says', () => {
  it('flags a title that is out of place among the tabs, suggests the month it fits, and leaves it unselected', () => {
    const m = month('Jan 2023');
    expect(m.doubt?.kinds).toEqual(['out_of_order']);
    expect(m.doubt?.suggested).toBe('2022-01');
    expect(m.defaultSelected).toBe(false);
  });

  it('flags contents newer than the title (a deposit that starts a year later) and leaves it unselected', () => {
    const m = month('Feb 2025');
    expect(m.doubt?.kinds).toContain('newer_contents');
    expect(m.doubt?.text).toMatch(/newer than its date/);
    // no other tab stands for February 2026, and the deposits that start in January 2026 can only fit that
    expect(m.doubt?.suggested).toBe('2026-02');
    expect(m.defaultSelected).toBe(false);
    expect(m.likeTab).toMatch(/Oct 2026/);
  });

  it('does not let a doubtful tab decide when a deposit ended', () => {
    // the deposit that is on the oldest tabs and on "Jan 2023" (a doubtful January) ends at the first trusted tab without it
    const x = plan.historical.find((h) => h.kind === 'fd' && h.fd?.principal === 500_000)!;
    expect(x.endedMonth).toBe('2022-09');
  });

  it('applies the month the person chooses, and then the tab is an ordinary month', async () => {
    const p = await planHistory(fx.bytes, {
      today: TODAY,
      ownerNames: OWNERS,
      existing,
      monthOverrides: { 'Jan 2023': '2022-01' },
    });
    const m = p.months.find((x) => x.tab === 'Jan 2023')!;
    expect(m).toMatchObject({ month: '2022-01', overridden: true, doubt: null, verdict: 'ok' });
    expect(m.defaultSelected).toBe(true);
    // the values are saved under the corrected month, so the same file imported again finds them
    expect(m.writes[0]!.ref).toMatch(/^hist:Jan 2022:/);
    expect(m.writes[0]!.asOf).toBe('2022-01-31');
  });

  it('lets the person use a doubtful tab as it is titled: the doubt stays as a warning, not a block', async () => {
    const p = await planHistory(fx.bytes, {
      today: TODAY,
      ownerNames: OWNERS,
      existing,
      monthOverrides: { 'Feb 2025': '2025-02' },
    });
    const m = p.months.find((x) => x.tab === 'Feb 2025')!;
    expect(m.doubt).toBeNull();
    expect(m.overridden).toBe(true);
    expect(m.warnings.join(' ')).toMatch(
      /You chose to use this tab as 2025-02.*newer than its date/,
    );
  });

  it('suggests the month the contents fit when a deposit starts in January 2026 in a tab called Feb 2025', async () => {
    // already covered above through the suggestion; here the override to that month makes it ordinary
    const p = await planHistory(fx.bytes, {
      today: TODAY,
      ownerNames: OWNERS,
      existing,
      monthOverrides: { 'Feb 2025': '2026-02' },
    });
    const m = p.months.find((x) => x.tab === 'Feb 2025')!;
    expect(m).toMatchObject({ month: '2026-02', doubt: null, asOf: '2026-02-28' });
    expect(
      m.writes.every(
        (w) => w.ref.startsWith('hist:Feb 2026:') || w.ref.startsWith('histfund:Feb 2026:'),
      ),
    ).toBe(true);
  });

  it('never selects a copy, and never lets it replace what the original has', () => {
    const c = month('Copy of Oct 2026');
    expect(c.copyOf).toBe('Oct 2026');
    expect(c.defaultSelected).toBe(false);
    expect(c.counts.copyDropped).toBe(c.writes.length);
    expect(c.counts.new).toBe(0);
    expect(c.warnings.join(' ')).toMatch(/copy of "Oct 2026"/i);
  });
});

describe('matching lines to what is on file', () => {
  it('finds every line of the latest tab on file and writes nothing for it', () => {
    const m = month('Oct 2026');
    expect(m.unmatched).toBe(0);
    expect(m.created).toBe(0);
    expect(m.counts.new).toBe(0);
    expect(m.counts.identical).toBeGreaterThan(0);
  });

  it('follows an account across a renamed line, by bank, person and NRE/NRO', () => {
    const m = month('Sep 2021');
    const nre = m.writes.find((w) => w.label.includes('Cash-NRE-1111'));
    expect(nre).toBeTruthy();
    expect(nre).toMatchObject({
      amount: 18_000,
      asOf: '2021-09-12',
      kind: 'balance',
      check: false,
    });
    expect(nre!.ref).toBe(`hist:Sep 2021:${nre!.cell}`);
  });

  it('lists a line that two accounts could be as ambiguous, with its cell, and writes neither', () => {
    // the plain "Cash" line fits two accounts at that bank; the two lines with one deposit number cannot be told apart
    const amb = month('Mar 2022').unmatchedRows.filter((u) => u.why === 'ambiguous');
    expect(amb).toHaveLength(3);
    expect(amb.every((u) => /^F\d+$/.test(u.cell))).toBe(true);
    expect(amb.filter((u) => /deposit number/.test(u.reason))).toHaveLength(2);
    expect(amb.filter((u) => /2 accounts fit this line/.test(u.reason))).toHaveLength(1);
    expect(month('Mar 2022').writes.some((w) => w.amount === 700)).toBe(false);
  });

  it('keeps a Singapore balance in its own currency with the rate, and a held account and a loan are followed', () => {
    const m = month('Sep 2021');
    const sg = m.writes.find((w) => w.currency === 'SGD')!;
    expect(sg).toMatchObject({ amount: 1000, fxRate: 60 });
    expect(m.writes.some((w) => /Account held by Atul/.test(w.label))).toBe(true);
    expect(m.writes.some((w) => /Friend Loan/.test(w.label) && w.amount === 50_000)).toBe(true);
  });

  it("stores a fund's monthly value for cross-checking only, under its own reference, and never creates a fund", () => {
    const m = month('Sept 2022');
    const alpha = m.writes.find((w) => w.check)!;
    expect(alpha).toMatchObject({ kind: 'valuation', amount: 150_000 });
    expect(alpha.ref.startsWith('histfund:Sept 2022:')).toBe(true);
    const omega = m.unmatchedRows.find((u) => /Omega/.test(u.label))!;
    expect(omega.why).toBe('not_on_file');
    expect(omega.reason).toMatch(/never created from a monthly line/);
  });
});

describe('deposits and accounts that are not on file', () => {
  const fd = () => plan.historical.filter((h) => h.kind === 'fd');

  it('adds each closed deposit once, however many tabs list it, from its terms', () => {
    expect(
      fd()
        .map((h) => [h.fd!.principal, h.firstSeen, h.lastSeen])
        .sort(),
    ).toEqual(
      [
        [80_000, '2021-06', '2021-07'],
        [150_000, '2021-12', '2022-03'],
        [300_000, '2021-06', '2022-09'],
        [500_000, '2021-06', '2022-03'],
        [520_000, '2022-09', '2022-09'],
      ].sort(),
    );
  });

  it('closes it on the first month it is missing from, flagged as estimated, using the maturity date when that falls in between', () => {
    const matured = fd().find((h) => h.fd!.principal === 500_000)!;
    expect(matured).toMatchObject({
      endedMonth: '2022-09',
      endedOn: '2022-09-01',
      status: 'matured',
    });
    const early = fd().find((h) => h.fd!.principal === 150_000)!;
    // it was not due until 2023: it left before maturity, in the month the tabs stop listing it
    expect(early).toMatchObject({ endedOn: '2022-09-30', status: 'closed' });
    const longer = fd().find((h) => h.fd!.principal === 300_000)!;
    expect(longer).toMatchObject({
      endedMonth: '2026-10',
      endedOn: '2024-05-01',
      status: 'matured',
    });
  });

  it('never invents a start date: it takes one from another tab, else the first month it is listed, flagged', () => {
    const x = fd().find((h) => h.fd!.principal === 500_000)!;
    expect(x.fd).toMatchObject({ bookedOn: '2021-03-01', startEstimated: false });
    const w = fd().find((h) => h.fd!.principal === 80_000)!;
    expect(w.fd).toMatchObject({ bookedOn: '2021-06-20', startEstimated: true });
  });

  it('does not add a deposit that has two equal deposit numbers on one tab', () => {
    expect(fd().some((h) => h.fd!.principal === 111_000 || h.fd!.principal === 222_000)).toBe(
      false,
    );
  });

  it('suggests, and does not link, a renewal: one deposit ends in the month another of the same bank and person appears', () => {
    const r = plan.renewals.find((x) => x.month === '2022-09' && /5,00,000/.test(x.text));
    expect(r).toBeTruthy();
    expect(r!.text).toMatch(/Not linked/);
  });

  it('adds a closed savings account that the older tabs list and later ones do not', () => {
    const c = plan.historical.filter((h) => h.kind === 'cash');
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({
      bank: 'Second Bank',
      accountKind: 'NRE',
      status: 'closed',
      lastSeen: '2021-12',
    });
  });

  it('counts them in the summary with the months and what does not add up', () => {
    expect(plan.summary).toMatchObject({
      months: 9,
      from: '2021-06',
      to: '2026-10',
      notAdding: 2,
      closedDeposits: 5,
      closedAccounts: 1,
      conflicts: 0,
    });
  });
});

describe('what is already on file', () => {
  it('reports a different value on the same day as a conflict, and an identical one in the same month as already there', async () => {
    const withValues: HistoryExisting = {
      ...existing,
      observations: [
        ...existing.observations,
        // entered by hand on the same day, different amount
        {
          id: 'hand-1',
          assetId: 'cash:4',
          asOf: '2021-09-12',
          amount: 18_500,
          currency: 'INR',
          source: 'manual',
          sourceRef: null,
          confidence: 'manual_confirmed',
          supersededBy: null,
        },
        // the same amount a few days earlier in the month
        {
          id: 'hand-2',
          assetId: 'cash:4',
          asOf: '2021-06-05',
          amount: 16_000,
          currency: 'INR',
          source: 'manual',
          sourceRef: null,
          confidence: 'manual_confirmed',
          supersededBy: null,
        },
        // a newer value that must never be touched
        {
          id: 'later',
          assetId: 'cash:4',
          asOf: '2026-01-31',
          amount: 1,
          currency: 'INR',
          source: 'manual',
          sourceRef: null,
          confidence: 'manual_confirmed',
          supersededBy: null,
        },
      ],
    };
    const p = await planHistory(fx.bytes, {
      today: TODAY,
      ownerNames: OWNERS,
      existing: withValues,
    });
    expect(p.conflicts).toHaveLength(1);
    expect(p.conflicts[0]).toMatchObject({
      tab: 'Sep 2021',
      assetId: 'cash:4',
      asOf: '2021-09-12',
      sheetAmount: 18_000,
      existing: { id: 'hand-1', amount: 18_500, source: 'manual' },
    });
    const june = p.months.find((m) => m.tab === 'June 2021')!;
    expect(june.writes.find((w) => w.assetId === 'cash:4')!.status).toBe('identical');
    expect(p.summary.conflicts).toBe(1);
  });

  it('does not report a value that was replaced earlier', async () => {
    const p = await planHistory(fx.bytes, {
      today: TODAY,
      ownerNames: OWNERS,
      existing: {
        ...existing,
        observations: [
          ...existing.observations,
          {
            id: 'old',
            assetId: 'cash:4',
            asOf: '2021-09-12',
            amount: 1,
            currency: 'INR',
            source: 'manual',
            sourceRef: null,
            confidence: 'manual_confirmed',
            supersededBy: 'newer',
          },
        ],
      },
    });
    expect(p.conflicts).toHaveLength(0);
  });
});

describe('layout helpers', () => {
  it('reads the register from the headings, whichever column they are in', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(fx.bytes as unknown as ArrayBuffer);
    const old = detectLayout(wb.getWorksheet('Sep 2021')!);
    expect(old.headerRow).toBe(2);
    expect(old.layout.columns).toMatchObject({
      a: 'A',
      b: 'B',
      c: 'C',
      d: 'D',
      e: 'E',
      f: 'F',
      n: 'H',
    });
    expect(old.standard).toBe(false);
    const cur = detectLayout(wb.getWorksheet('Oct 2026')!);
    expect(cur.layout.columns).toMatchObject({ f: 'F', h: 'H', n: 'N', m: 'M' });
    expect(cur.layout.totalRef).toMatch(/^F\d+$/);
  });

  it('reads the older way of writing a line', () => {
    const grp = (kind: string, extra: object = {}) =>
      ({
        raw: '',
        institution: 'Sample Bank',
        owner: 'Asha',
        goalPerson: null,
        holder: null,
        kind,
        ...extra,
      }) as never;
    expect(classifyHistoryRow({ b: 'Cash - NRE', e: 'Cash', f: 10 }, grp('bank'))).toMatchObject({
      kind: 'cash',
      accountKind: 'NRE',
    });
    expect(classifyHistoryRow({ b: 'Cash', e: '', f: 10 }, grp('sg_bank'))).toEqual({
      kind: 'cash_sg',
    });
    expect(classifyHistoryRow({ b: 'Friend', e: 'Cash', f: 10 }, grp('others'))).toEqual({
      kind: 'loan',
    });
    expect(classifyHistoryRow({ b: 'Papa', e: '', f: 10 }, grp('others'))).toEqual({
      kind: 'memo',
    });
    expect(classifyHistoryRow({ b: 'FD', e: '', f: 0 }, grp('bank'))).toEqual({
      kind: 'placeholder',
    });
    expect(
      classifyHistoryRow({ b: 'Some Fund', e: 'LumpSum', f: 10 }, grp('person')),
    ).toMatchObject({ kind: 'fund' });
  });

  it('finds the tabs that are out of order among the rest', () => {
    const tabs = [
      [2026, 10],
      [2026, 5],
      [2025, 2],
      [2024, 12],
      [2024, 3],
      [2023, 1], // out of place: a January between March 2024 and December 2023
      [2023, 12],
      [2023, 11],
      [2023, 8],
    ].map(([year, month], index) => ({ index, ym: { year: year!, month: month! } }));
    const out = outOfSequence(tabs);
    expect([...out.keys()]).toEqual([5]);
    expect(out.get(5)!.suggested).toBe('2024-01');
  });
});
