import { beforeAll, describe, expect, it } from 'vitest';
import { planHistory, type HistoryExisting, type HistoryPlan } from '../src/history';
import {
  applyHistoryMonth,
  HISTORY_NOTE_PREFIX,
  type ConflictChoice,
  type MonthResult,
} from '../src/history-import';
import { planWorkbook } from '../src/workbook';
import { buildHistoryWorkbook, type Fixture } from './history-fixture';
import { existingFromPlan } from './history-existing';
import { FakeDb } from './history-fake-db';

const OWNERS = ['Asha', 'Vikram', 'Kiran'];
const TODAY = '2026-10-27';

let fx: Fixture;
let base: HistoryExisting;

beforeAll(async () => {
  fx = await buildHistoryWorkbook();
  const cur = await planWorkbook(fx.bytes, {
    asOf: '2026-10-25',
    sheetName: 'Oct 2026',
    ownerNames: OWNERS,
    defaultOwner: 'Asha',
  });
  base = existingFromPlan(cur);
});

const planOf = (db: FakeDb, monthOverrides: Record<string, string> = {}): Promise<HistoryPlan> =>
  planHistory(fx.bytes, {
    today: TODAY,
    ownerNames: OWNERS,
    existing: db.snapshot(),
    monthOverrides,
  });

/** What the page does: plan again for every month, then apply that month. */
async function importMonths(
  db: FakeDb,
  tabs: string[],
  choices: Record<string, ConflictChoice> = {},
): Promise<MonthResult[]> {
  const out: MonthResult[] = [];
  for (const tab of tabs)
    out.push(await applyHistoryMonth(await planOf(db), tab, choices, db.io()));
  return out;
}

const SELECTED = ['June 2021', 'July 2021', 'Sep 2021', 'Sept 2022', 'Oct 2026'];

describe('importing months', () => {
  it('adds values and closed records, flagged as estimates, and a second run adds nothing', async () => {
    const db = new FakeDb(base);
    const first = await importMonths(db, SELECTED);
    expect(first.every((r) => r.ok)).toBe(true);
    const added = first.reduce((s, r) => s + r.observations, 0);
    expect(added).toBeGreaterThan(10);
    const assetsAfter = db.assets.length;
    const obsAfter = db.observations.length;

    // the same file again: nothing is added, nothing changes
    const second = await importMonths(db, SELECTED);
    expect(second.every((r) => r.ok)).toBe(true);
    expect(second.reduce((s, r) => s + r.observations + r.addedAssets + r.checks, 0)).toBe(0);
    expect(db.assets).toHaveLength(assetsAfter);
    expect(db.observations).toHaveLength(obsAfter);
    expect(db.superseded).toHaveLength(0);
  });

  it('adds each closed deposit once with its end date flagged, however many months list it', async () => {
    const db = new FakeDb(base);
    await importMonths(db, ['June 2021', 'July 2021', 'Sep 2021', 'Sept 2022']);
    const fds = db.created.filter((a) => a.type === 'fixed_deposit');
    expect(fds.map((a) => a.fd!.principal).sort((a, b) => a - b)).toEqual([
      80_000, 300_000, 500_000, 520_000,
    ]);
    const matured = fds.find((a) => a.fd!.principal === 500_000)!;
    expect(matured).toMatchObject({ status: 'matured', ownerName: 'Asha', bank: 'Sample Bank' });
    expect(matured.fd).toMatchObject({
      endedOn: '2022-09-01',
      bookedOn: '2021-03-01',
      startEstimated: false,
    });
    // one short line for the list; the full explanation is on the account's page
    expect(matured.notes).toMatch(/estimate/i);
    expect(matured.notes!.startsWith(HISTORY_NOTE_PREFIX)).toBe(true);
    expect(matured.notes!.length).toBeLessThan(90);
    const noStart = fds.find((a) => a.fd!.principal === 80_000)!;
    expect(noStart.fd).toMatchObject({
      startEstimated: true,
      bookedOn: '2021-06-20',
      endedOn: '2021-09-12',
    });
    expect(noStart.status).toBe('closed');
    // a deposit already on file is untouched: no record of it is created
    expect(db.created.some((a) => a.fd?.principal === 1_000_000)).toBe(false);
  });

  it('adds the closed savings account and its values', async () => {
    const db = new FakeDb(base);
    await importMonths(db, ['June 2021', 'Sep 2021']);
    const acct = db.created.find((a) => a.type === 'bank_account')!;
    expect(acct).toMatchObject({ bank: 'Second Bank', accountKind: 'NRE', status: 'closed' });
    const id = db.assets.find((a) => a.nickname === acct.nickname)!.id;
    expect(db.observations.filter((o) => o.assetId === id).map((o) => o.amount)).toEqual([
      2_300, 2_500,
    ]);
  });

  it('writes every value with the sheet as source, unverified, and a reference that names the tab and cell', async () => {
    const db = new FakeDb(base);
    await importMonths(db, ['Sep 2021']);
    const mine = db.observations.filter((o) => o.sourceRef?.startsWith('hist:'));
    expect(mine.length).toBeGreaterThan(3);
    expect(
      mine.every((o) => o.source === 'workbook' && o.confidence === 'imported_unverified'),
    ).toBe(true);
    expect(
      mine.every((o) => /^hist:Sep 2021:F\d+$|^hist:Sep 2021:[A-Z]+\d+$/.test(o.sourceRef!)),
    ).toBe(true);
  });

  it("keeps a fund's value for checking only: under its own reference, as a valuation, never creating a fund", async () => {
    const db = new FakeDb(base);
    const r = await importMonths(db, ['Sept 2022']);
    expect(r[0]!.checks).toBe(1);
    const fund = db.observations.find((o) => o.sourceRef?.startsWith('histfund:'))!;
    expect(fund).toMatchObject({ assetId: 'mf:8', amount: 150_000 });
    expect(db.assets.some((a) => a.type === 'mutual_fund' && a.id !== 'mf:8')).toBe(false);
    // the importer's plain references never name a fund
    expect(
      db.observations.some((o) => o.assetId === 'mf:8' && o.sourceRef?.startsWith('hist:')),
    ).toBe(false);
  });

  it('does nothing for the month already on file', async () => {
    const db = new FakeDb(base);
    const before = db.observations.length;
    const [r] = await importMonths(db, ['Oct 2026']);
    expect(r).toMatchObject({ observations: 0, addedAssets: 0, ok: true });
    expect(r!.identical).toBeGreaterThan(0);
    expect(db.observations).toHaveLength(before + r!.checks);
  });

  it('never lets a copy replace the original', async () => {
    const db = new FakeDb(base);
    const [r] = await importMonths(db, ['Copy of Oct 2026'], {});
    expect(r!.observations).toBe(0);
    expect(r!.copyDropped).toBeGreaterThan(0);
    // the copy says 25,500 where the original says 25,000: the original's number is the one on file
    expect(db.observations.some((o) => o.amount === 25_500)).toBe(false);
  });
});

describe('conflicts', () => {
  const hand = (amount: number, asOf = '2021-09-12') => ({
    id: 'hand',
    assetId: 'cash:4',
    asOf,
    amount,
    currency: 'INR',
    source: 'manual',
    sourceRef: null,
    confidence: 'manual_confirmed',
    supersededBy: null,
  });
  const later = {
    id: 'later',
    assetId: 'cash:4',
    asOf: '2026-01-31',
    amount: 7,
    currency: 'INR',
    source: 'manual',
    sourceRef: null,
    confidence: 'manual_confirmed',
    supersededBy: null,
  };

  it('keeps what is on file unless the person chooses the sheet, and reports it', async () => {
    const db = new FakeDb({ ...base, observations: [...base.observations, hand(18_500), later] });
    const [r] = await importMonths(db, ['Sep 2021']);
    expect(r).toMatchObject({ conflictsKept: 1, conflictsReplaced: 0, ok: true });
    expect(db.observations.find((o) => o.id === 'hand')!.amount).toBe(18_500);
    expect(db.observations.some((o) => o.amount === 18_000 && o.assetId === 'cash:4')).toBe(false);
    expect(db.superseded).toHaveLength(0);
  });

  it("uses the sheet when asked: adds its value and marks only the same day's value as replaced, never a later one", async () => {
    const db = new FakeDb({ ...base, observations: [...base.observations, hand(18_500), later] });
    const plan = await planOf(db);
    const id = plan.conflicts[0]!.id;
    const r = await applyHistoryMonth(plan, 'Sep 2021', { [id]: 'sheet' }, db.io());
    expect(r).toMatchObject({ conflictsReplaced: 1, ok: true });
    const hereNow = db.observations.find((o) => o.id === 'hand')!;
    expect(hereNow.amount).toBe(18_500); // a value is never edited
    expect(hereNow.supersededBy).toBeTruthy();
    expect(db.observations.find((o) => o.id === 'later')).toMatchObject({
      amount: 7,
      supersededBy: null,
    });
    expect(db.observations.find((o) => o.id === hereNow.supersededBy)).toMatchObject({
      amount: 18_000,
      asOf: '2021-09-12',
      sourceRef: expect.stringMatching(/^hist:Sep 2021:/),
    });
    // and the next run finds nothing left to decide
    const again = await planOf(db);
    expect(again.conflicts).toHaveLength(0);
  });

  it('leaves identical values alone', async () => {
    const db = new FakeDb({
      ...base,
      observations: [...base.observations, hand(18_000, '2021-09-03')],
    });
    const [r] = await importMonths(db, ['Sep 2021']);
    expect(r!.identical).toBeGreaterThan(0);
    expect(
      db.observations.some(
        (o) => o.assetId === 'cash:4' && o.sourceRef?.startsWith('hist:Sep 2021'),
      ),
    ).toBe(false);
  });
});

describe('failures', () => {
  it('reports what could not be added and still saves the rest, and the next run finishes it', async () => {
    const db = new FakeDb(base);
    db.failOn = (a) => a.type === 'bank_account';
    const [r] = await importMonths(db, ['June 2021']);
    expect(r!.ok).toBe(false);
    expect(r!.errors.join(' ')).toMatch(/not in this household/);
    expect(r!.errors.join(' ')).toMatch(/was not added, so its value was not saved/);
    expect(r!.observations).toBeGreaterThan(0);
    db.failOn = null;
    const [again] = await importMonths(db, ['June 2021']);
    expect(again!.ok).toBe(true);
    expect(again!.addedAssets).toBe(1);
  });

  it('says so for a tab that is not in the file', async () => {
    const db = new FakeDb(base);
    const r = await applyHistoryMonth(await planOf(db), 'Nov 1999', {}, db.io());
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/not in this workbook/);
  });
});

describe('deposit numbers', () => {
  it('fills in a missing deposit number on a deposit on file, and never changes one that has a number', async () => {
    const noRef: HistoryExisting = {
      ...base,
      assets: base.assets.map((a) => (a.fd && a.fd.ref ? { ...a, fd: { ...a.fd, ref: null } } : a)),
    };
    const db = new FakeDb(noRef);
    const [r] = await importMonths(db, ['Oct 2026']);
    expect(r!.fdNumbers).toBe(1);
    expect(db.fills).toEqual([['fd:3', '555500001111-1']]);
    const [again] = await importMonths(db, ['Oct 2026']);
    expect(again!.fdNumbers).toBe(0);
    // the terms of the deposit on file are not changed
    expect(db.assets.find((a) => a.id === 'fd:3')!.fd).toMatchObject({
      principal: 1_000_000,
      rate: 0.065,
    });
  });
});

describe('a month the person dated', () => {
  it('saves under the corrected month, and importing again adds nothing', async () => {
    const db = new FakeDb(base);
    const ovr = { 'Jan 2023': '2022-01' };
    const plan1 = await planOf(db, ovr);
    const r1 = await applyHistoryMonth(plan1, 'Jan 2023', {}, db.io());
    expect(r1.observations).toBeGreaterThan(0);
    expect(db.observations.some((o) => o.sourceRef?.startsWith('hist:Jan 2022:'))).toBe(true);
    expect(db.observations.some((o) => o.asOf === '2022-01-31')).toBe(true);
    const plan2 = await planOf(db, ovr);
    const r2 = await applyHistoryMonth(plan2, 'Jan 2023', {}, db.io());
    expect(r2.observations + r2.addedAssets + r2.checks).toBe(0);
  });
});
