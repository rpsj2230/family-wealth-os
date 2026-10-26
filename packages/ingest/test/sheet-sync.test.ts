import { describe, expect, it } from 'vitest';
import { dateToSerial } from '../src/sheet-grid';
import { classifyRegisterRow, fdNumberIn, foreignNoteIn, parseGroup } from '../src/sheet-rows';
import {
  layoutOf,
  planSheetSync,
  registerEnd,
  withFdNumber,
  withForeignNote,
  type RowPlan,
  type SyncAsset,
} from '../src/sheet-sync';
import { gridOf } from './harness';
import { appAssets, build, monthRows, newAssets, OPTS } from './synthetic';

const writesOf = async (assets: SyncAsset[], rows = monthRows()) => {
  const grid = await gridOf(rows);
  const plan = planSheetSync(grid, assets, OPTS);
  return { grid, plan, w: Object.fromEntries(plan.writes.map((x) => [x.ref, x.value])) };
};
const row = (rows: RowPlan[], n: number) => rows.find((r) => r.row === n)!;

describe('the importer’s row rules are shared, not copied', () => {
  it('classifies rows by what they are', () => {
    const g = parseGroup('Sample Bank - Asha', ['Asha']);
    expect(classifyRegisterRow({ b: 'FD', e: new Date(), f: 5 }, g).kind).toBe('fd');
    expect(classifyRegisterRow({ b: 'Cash', e: 'Cash-NRE', f: 5 }, g)).toMatchObject({
      kind: 'cash',
      accountKind: 'NRE',
    });
    expect(classifyRegisterRow({ b: 'Cash', e: 'Cash SG', f: 5 }, g).kind).toBe('cash_sg');
    expect(
      classifyRegisterRow({ b: '(STOPPED) Fund X', e: 'SIP Kiran Education', f: 5 }, g),
    ).toMatchObject({ kind: 'fund', stopped: true, name: 'Fund X' });
    expect(classifyRegisterRow({ b: 'Friend', e: 'Cash Loan', f: 5 }, g).kind).toBe('loan');
    expect(classifyRegisterRow({ b: 'Shares', e: 'Shares', f: 5 }, g).kind).toBe('third_party');
    expect(classifyRegisterRow({ b: 'FD', e: null, f: null }, g).kind).toBe('placeholder');
    expect(classifyRegisterRow({ b: '', e: null, f: null }, g).kind).toBe('blank');
    expect(classifyRegisterRow({ b: 'FD', e: null, f: 5 }, null).kind).toBe('no_group');
    expect(classifyRegisterRow({ b: 'Odd', e: 'Something', f: 5 }, g).kind).toBe('unclassified');
  });

  it('reads group headings, deposit numbers and Singapore notes with the importer’s functions', () => {
    expect(parseGroup('SIP - Kiran (Asha)\nRs 10k/month', ['Asha', 'Kiran'])).toMatchObject({
      kind: 'sip',
      owner: 'Asha',
      goalPerson: 'Kiran',
    });
    expect(parseGroup('Atul IDFC', ['Asha'])).toMatchObject({ kind: 'person' });
    expect(fdNumberIn('x FD Number : 555500001111-1, 99999').ref).toBe('555500001111-1');
    expect(foreignNoteIn('Base: $1= Rs 65\nBal : $1,100.50')).toEqual({ sgd: 1100.5, base: 65 });
  });

  it('finds where the register ends from the total row, whatever the configured last row says', async () => {
    const grid = await gridOf(monthRows());
    expect(registerEnd(grid, OPTS)).toBe(19);
    expect(layoutOf(grid, OPTS)).toMatchObject({
      registerEnd: 19,
      recognised: 14,
      unclassified: 0,
    });
  });
});

describe('what is written for each kind of row', () => {
  it('Indian cash: the balance the app shows, rounded to paise, in column F only', async () => {
    const { plan, w } = await writesOf(appAssets());
    expect(w.F5).toBe(25_678.12);
    expect(Object.keys(w).filter((k) => /^[A-Z]+5$/.test(k))).toEqual(['F5']);
    expect(row(plan.rows, 5)).toMatchObject({
      status: 'update',
      kind: 'cash',
      asset: 'Cash-NRE-1111',
    });
    expect(row(plan.rows, 5).changes).toEqual([
      { cell: 'F5', column: 'Amount', old: '25,000', next: '25,678.12' },
    ]);
    // an unchanged balance produces no change at all
    expect(row(plan.rows, 6).status).toBe('same');
    expect(w.F6).toBeUndefined();
  });

  it('fixed deposits: rate, dates, principal and bank maturity value, and the deposit number as written', async () => {
    const { plan, w } = await writesOf(appAssets());
    // row 3: only the maturity value moved
    expect(row(plan.rows, 3).changes.map((c) => c.cell)).toEqual(['G3']);
    expect(w.G3).toBe(1_161_000);
    // row 4: the rate moved
    expect(w.C4).toBe(0.0725);
    expect(row(plan.rows, 4).changes[0]).toMatchObject({
      column: 'Rate',
      old: '7.00%',
      next: '7.25%',
    });
    expect(w.D4).toBeUndefined();
    // the joint deposit has no deposit number in the app: its note is left alone
    expect(row(plan.rows, 7).status).toBe('same');
  });

  it('writes a changed date as a real date (a serial number) and a changed deposit number into the note', async () => {
    const assets = appAssets();
    assets[0]!.fd!.bookedOn = '2024-11-04';
    assets[0]!.fd!.maturityOn = '2026-11-04';
    assets[0]!.fd!.ref = '555500009999-2';
    const { plan, w } = await writesOf(assets);
    expect(w.D3).toBe(dateToSerial('2024-11-04'));
    expect(w.E3).toBe(dateToSerial('2026-11-04'));
    expect(typeof w.D3).toBe('number');
    expect(w.N3).toBe('FD Number : 555500009999-2');
    expect(plan.writes.find((x) => x.ref === 'D3')!.isDate).toBe(true);
    // the cells are already date-formatted, so no format is touched
    expect(plan.dateFormats).toEqual([]);
    expect(row(plan.rows, 3).changes.find((c) => c.cell === 'D3')).toMatchObject({
      old: '1 Nov 2024',
      next: '4 Nov 2024',
    });
  });

  it('Singapore cash: rupee value in F and the S$ amount and rate in the note, in the note’s own format', async () => {
    const { w } = await writesOf(appAssets());
    expect(w.F9).toBe(7_426);
    expect(w.N9).toBe('Base: $1= Rs 74.26\nBal : $100.00');
    expect(w.G9).toBeUndefined();
  });

  it('funds: value, invested and start date; the stopped mark is kept and added when the app says stopped', async () => {
    const assets = appAssets();
    const { plan, w } = await writesOf(assets);
    expect(w.F10).toBe(281_000.5);
    expect(w.H10).toBe(276_000);
    expect(w.D10).toBeUndefined(); // same start date
    expect(w.B10).toBeUndefined();
    expect(w.B11).toBeUndefined(); // already marked (STOPPED)
    expect(w.F11).toBe(194_000);
    expect(w.H11).toBe(180_000);
    // goal and note stay as the sheet has them
    expect(Object.keys(w).filter((k) => /^[EN](10|11)$/.test(k))).toEqual([]);
    // the ULIP: value only
    expect(w.F12).toBe(61_000);
    expect(w.H12).toBeUndefined();
    expect(row(plan.rows, 12).kind).toBe('ulip');

    const unmarked = appAssets();
    unmarked.find((a) => a.kind === 'fund')!.fund!.stopped = true;
    const r = await writesOf(unmarked);
    expect(r.w.B10).toBe('(STOPPED) Alpha Small Cap Direct Plan');
  });

  it('money lent: what is still owed; the memo row is not an asset', async () => {
    const { plan, w } = await writesOf(appAssets());
    expect(w.F13).toBe(150_000);
    expect(plan.rows.find((r) => r.label === 'Papa')).toBeUndefined();
    expect(w.F14).toBeUndefined();
  });

  it('money held by someone else: the value in F', async () => {
    const { w, plan } = await writesOf(appAssets());
    expect(w.F15).toBe(30_000);
    expect(row(plan.rows, 15)).toMatchObject({
      kind: 'third_party',
      asset: 'Account held by Atul',
    });
  });

  it('never writes a cell that holds a formula, and says which it kept', async () => {
    const rows = monthRows();
    rows[16]![5] = { f: '=500+500', fmt: { type: 'NUMBER' } }; // F17 becomes a formula
    const assets = appAssets();
    assets.find((a) => a.last4 === '5555')!.value = 2_000;
    const { plan, w } = await writesOf(assets, rows);
    expect(w.F17).toBeUndefined();
    expect(row(plan.rows, 17).keptFormulas).toEqual(['F17']);
    expect(plan.counts.formulasKept).toBe(1);
    // none of the formula columns of the sheet is among the writes
    for (const ref of Object.keys(w)) expect(ref).not.toMatch(/^[GI](5|6|8|9|10|11|12|15|17|18)$/);
    expect(Object.keys(w)).not.toContain('F20');
  });
});

describe('matching rows to assets', () => {
  it('tells apart two deposits with the same label by their deposit number', async () => {
    const assets = appAssets();
    // swap the order the app lists them in: the match must not depend on it
    assets[0]!.sortOrder = 99;
    const { plan } = await writesOf(assets);
    expect(row(plan.rows, 3).changes.map((c) => c.cell)).toEqual(['G3']);
    expect(row(plan.rows, 4).changes.map((c) => c.cell)).toEqual(['C4']);
  });

  it('matches a deposit with no deposit number by its dates and amount', async () => {
    const assets = appAssets();
    for (const a of assets) if (a.fd) a.fd.ref = null;
    const { plan } = await writesOf(assets);
    expect(row(plan.rows, 3).asset).toBe('FD-NRE-1111');
    expect(row(plan.rows, 3).changes.map((c) => c.cell)).toEqual(['G3']);
    expect(row(plan.rows, 4).changes.map((c) => c.cell)).toEqual(['C4']);
  });

  it('keeps joint accounts apart from single ones with the same last four digits', async () => {
    const rows = build({
      3: { A: 'Sample Bank - Asha', B: 'Cash-NRO-2222', E: 'Cash-NRO', F: 10 },
      4: { B: 'Cash-NRO JO-2222', E: 'Cash-NRO', F: 20 },
    });
    const mk = (joint: boolean, value: number): SyncAsset =>
      appAssets().find((a) => a.last4 === '2222')
        ? {
            ...appAssets().find((a) => a.last4 === '2222')!,
            id: joint ? 'j' : 's',
            joint,
            value,
            label: joint ? 'Cash-NRO JO-2222' : 'Cash-NRO-2222',
          }
        : (undefined as never);
    const { w } = await writesOf([mk(true, 222), mk(false, 111)], rows);
    expect(w.F3).toBe(111);
    expect(w.F4).toBe(222);
  });

  it('matches the same fund under two people by the owner and the start date', async () => {
    const rows = build({
      3: {
        A: 'SIP - Kiran (Asha)',
        B: 'Alpha Fund',
        D: { d: '2024-01-10' },
        E: 'SIP Kiran Education',
        F: 1,
      },
      4: {
        A: 'SIP - Kiran (Vikram)',
        B: 'Alpha Fund',
        D: { d: '2024-02-20' },
        E: 'SIP Kiran Education',
        F: 2,
      },
    });
    const mk = (owner: string, started: string, value: number): SyncAsset => ({
      ...appAssets().find((a) => a.kind === 'fund')!,
      id: owner,
      owner,
      names: ['Alpha Fund'],
      value,
      fund: { invested: null, startedOn: started, stopped: false },
    });
    const { w } = await writesOf(
      [mk('Vikram', '2024-02-20', 20), mk('Asha', '2024-01-10', 10)],
      rows,
    );
    expect(w.F3).toBe(10);
    expect(w.F4).toBe(20);
  });

  it('leaves a sheet line with no matching asset alone and lists it', async () => {
    const assets = appAssets().filter((a) => a.last4 !== '5555');
    const { plan, w } = await writesOf(assets);
    expect(row(plan.rows, 17)).toMatchObject({ status: 'unmatched', asset: null });
    expect(row(plan.rows, 17).note).toMatch(/Nothing in the app matches/);
    expect(w.F17).toBeUndefined();
    expect(plan.counts.unmatched).toBeGreaterThan(0);
  });

  it('closed, renewed or matured in the app: the row stays and is listed, never written or removed', async () => {
    const { plan, w } = await writesOf(appAssets());
    const closed = row(plan.rows, 8);
    expect(closed.status).toBe('closed');
    expect(closed.note).toMatch(/Closed in the app, still in the sheet/);
    expect(w.F8).toBeUndefined();
    const assets = appAssets();
    assets[1]!.status = 'renewed';
    const r = await writesOf(assets);
    expect(row(r.plan.rows, 4).status).toBe('closed');
    expect(r.w.C4).toBeUndefined();
  });

  it('a deposit past its maturity date that is awaiting confirmation is still written', async () => {
    const assets = appAssets();
    assets[0]!.status = 'matured_unconfirmed';
    const { plan } = await writesOf(assets);
    expect(row(plan.rows, 3).status).toBe('update');
  });
});

describe('accounts the sheet does not have', () => {
  it('adds a row under the group, in the sheet’s format, and numbers the rows after it', async () => {
    const { plan, w } = await writesOf([...appAssets(), ...newAssets()]);
    // a new deposit below the group's last deposit (row 4), a new account below the last account of the second bank (row 8), a loan below row 13
    expect(plan.inserts.map((i) => [i.anchor, i.count])).toEqual([
      [4, 1],
      [8, 1],
      [13, 1],
    ]);
    expect(plan.counts.added).toBe(3);
    const fd = plan.rows.find((r) => r.status === 'added' && r.kind === 'fd')!;
    expect(fd.row).toBe(5);
    expect(w.B5).toBe('FD-NRE-7777');
    expect(w.C5).toBe(0.071);
    expect(w.D5).toBe(dateToSerial('2026-10-05'));
    expect(w.E5).toBe(dateToSerial('2027-10-05'));
    expect(w.F5).toBe(300_000);
    expect(w.G5).toBe(322_000);
    expect(w.N5).toBe('FD Number : 555500007777-1');
    // later rows moved down: the cash row that was row 5 is now row 6, and its change is addressed there
    expect(w.F6).toBe(25_678.12);
    // the account below the second bank's last account: after the FD row above it and its own position
    const cash = plan.rows.find((r) => r.status === 'added' && r.kind === 'cash')!;
    expect(cash.row).toBe(10);
    expect(w.B10).toBe('Cash-NRE-8888');
    expect(w.E10).toBe('Cash-NRE');
    expect(w.F10).toBe(12_000);
    const loan = plan.rows.find((r) => r.status === 'added' && r.kind === 'loan')!;
    expect(loan.row).toBe(16);
    expect(w.B16).toBe('Colleague Loan');
    expect(w.D16).toBe('Cash Loan');
    expect(w.E16).toBe('Cash Loan');
    expect(w.F16).toBe(15_000);
    expect(w.C16).toBe(dateToSerial('2026-09-01'));
  });

  it('copies the formulas of the line above into a new row instead of writing numbers', async () => {
    const { plan } = await writesOf([...appAssets(), ...newAssets()]);
    const cashInsert = plan.inserts.find((i) => i.anchor === 8)!;
    expect(cashInsert.formulas[0]).toEqual({ fromRow: 8, columns: ['G'] });
    // a deposit's maturity value is written, not copied, so nothing is copied into G for it
    expect(plan.inserts.find((i) => i.anchor === 4)!.formulas[0]!.columns).toEqual([]);
  });

  it('lists what it cannot place: no matching group, or a goal the sheet needs and the group does not settle', async () => {
    const { plan } = await writesOf([...appAssets(), ...newAssets()]);
    const byAsset = Object.fromEntries(plan.placeByHand.map((p) => [p.asset, p.reason]));
    expect(Object.keys(byAsset)).toHaveLength(2);
    expect(Object.values(byAsset).some((r) => /No group in the sheet matches/.test(r))).toBe(true);
    expect(byAsset['Delta Index Fund Direct']).toMatch(/goal/);
  });

  it('does not add a copy when the sheet has an unmatched line of the same kind in that group', async () => {
    const assets = [...appAssets(), ...newAssets()].filter(
      (a) => a.last4 !== '6666' && a.last4 !== '8888',
    );
    const extra = {
      ...newAssets()[1]!,
      last4: '6667',
      institution: 'Fourth Bank',
      owner: 'Vikram',
    };
    const { plan } = await writesOf([...assets, extra]);
    expect(plan.rows.some((r) => r.status === 'added' && r.kind === 'cash')).toBe(false);
    expect(
      plan.placeByHand.some((p) => /could not match in the same group \(row 18\)/.test(p.reason)),
    ).toBe(true);
  });

  it('a date written into a cell with no date format also gets the sheet’s date format', async () => {
    const rows = monthRows();
    delete rows[9]![3]!.fmt; // D10 has no date format
    delete rows[9]![3]!.v; // and is empty
    const { plan, w } = await writesOf(appAssets(), rows);
    expect(w.D10).toBe(dateToSerial('2024-07-26'));
    expect(plan.dateFormats).toEqual([{ ref: 'D10', pattern: 'd mmm yyyy' }]);
  });
});

describe('text of the notes', () => {
  it('rewrites the S$ amount and the rate in place and keeps other words', () => {
    expect(withForeignNote('Base: $1= Rs 65\nBal : $100.00', 250.5, 74.2563)).toBe(
      'Base: $1= Rs 74.2563\nBal : $250.50',
    );
    expect(withForeignNote('Joint with Asha. Base: $1= Rs 65 Bal : $1,100.50', 2000, 74.26)).toBe(
      'Joint with Asha. Base: $1= Rs 74.26 Bal : $2,000.00',
    );
    expect(withForeignNote('', 100, 74.26)).toBe('Base: $1= Rs 74.26\nBal : $100.00');
    expect(withForeignNote('Lounge card', 100, 74.26)).toBe(
      'Lounge card\nBase: $1= Rs 74.26\nBal : $100.00',
    );
    // and the importer reads back what was written
    expect(
      foreignNoteIn(withForeignNote('Base: $1= Rs 65\nBal : $100.00', 250.5, 74.2563)),
    ).toEqual({ sgd: 250.5, base: 74.2563 });
  });

  it('puts the full deposit number in the note, keeping the rest', () => {
    expect(withFdNumber('', '555500001111-1')).toBe('FD Number : 555500001111-1');
    expect(withFdNumber('FD Number : 555500001111-1', '555500001111-1')).toBeNull();
    expect(withFdNumber('Auto renew. FD Number : 111-1, 222-1', '999-1')).toBe(
      'Auto renew. FD Number : 999-1, 222-1',
    );
    expect(withFdNumber('Lounge card', '999-1')).toBe('Lounge card\nFD Number : 999-1');
  });
});
