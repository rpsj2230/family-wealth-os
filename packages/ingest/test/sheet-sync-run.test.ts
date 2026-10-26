import { describe, expect, it } from 'vitest';
import { runSheetSync, testSheetConnection, type SyncApp, type SyncView } from '../src/sheet-sync-run';
import { dateToSerial } from '../src/sheet-grid';
import { CONFIG, NOW, workbook } from './harness';
import { build, monthRows, appAssets, newAssets, OWNERS } from './synthetic';

const app = (extra = false): SyncApp => ({
  assets: extra ? [...appAssets(), ...newAssets()] : appAssets(),
  owners: OWNERS,
  defaultOwner: 'Asha',
});
const sync = (w: ReturnType<typeof workbook>, apply: boolean, a = app()) =>
  runSheetSync({ api: w.client, spreadsheetId: w.google.spreadsheetId, now: NOW, app: a, config: CONFIG, apply, newSheetId: () => 777 });
const view = (r: Awaited<ReturnType<typeof sync>>): SyncView => {
  if (!r.ok) throw new Error(`sync failed: ${r.message}`);
  return r.view;
};
const snapshot = (w: ReturnType<typeof workbook>, title: string) => JSON.stringify(w.google.sheet(title)!.rows);
const writes = (w: ReturnType<typeof workbook>) => w.google.calls.filter((c) => c.method === 'POST' && c.url.includes('/v4/') && !c.url.includes('/token'));

describe('preview', () => {
  it('changes nothing in the spreadsheet, and says the tab would be created from last month', async () => {
    const w = workbook();
    const before = w.google.tabOrder();
    const v = view(await sync(w, false));
    expect(v.stage).toBe('preview');
    expect(v.target).toEqual({ title: 'Oct 2026', existed: false, copiedFrom: 'Sep 2026', position: 'left' });
    expect(v.backup).toBeNull();
    expect(v.counts.updated).toBeGreaterThan(5);
    expect(v.summary).toMatch(/rows? to change/);
    expect(writes(w)).toHaveLength(0);
    expect(w.google.tabOrder()).toEqual(before);
    // old -> new for a row
    const cash = v.rows.find((r) => r.label === 'Cash-NRE-1111')!;
    expect(cash.changes).toEqual([{ cell: 'F5', column: 'Amount', old: '25,000', next: '25,678.12' }]);
  });

  it('for a month that already has a tab, previews against that tab and plans a safety copy', async () => {
    const w = workbook(['Oct 2026', 'Sep 2026']);
    const v = view(await sync(w, false));
    expect(v.target).toMatchObject({ title: 'Oct 2026', existed: true, copiedFrom: null, position: null });
    expect(v.backup).toEqual({ title: 'Oct 2026 - before sync', replaces: false });
    expect(writes(w)).toHaveLength(0);
  });
});

describe('a month with no tab yet', () => {
  it('copies last month inside the spreadsheet, keeps formulas and formats, and fills in the app’s figures', async () => {
    const w = workbook();
    const sepBefore = snapshot(w, 'Sep 2026');
    const augBefore = snapshot(w, 'Aug 2026');
    const v = view(await sync(w, true));
    expect(v.stage).toBe('applied');
    // the newest month sits at the left in this workbook, so the copy takes Sep's place
    expect(w.google.tabOrder()).toEqual(['Notes', 'Oct 2026', 'Sep 2026', 'Aug 2026']);
    // other months are untouched
    expect(snapshot(w, 'Sep 2026')).toBe(sepBefore);
    expect(snapshot(w, 'Aug 2026')).toBe(augBefore);
    // values arrived as numbers; formulas are still formulas and recalculate
    expect(w.google.value('Oct 2026', 'F5')).toBe(25_678.12);
    expect(w.google.cell('Oct 2026', 'G5').f).toBe('=F5');
    expect(w.google.value('Oct 2026', 'G5')).toBe(25_678.12);
    expect(w.google.value('Oct 2026', 'I10')).toBe(281_000.5 - 276_000);
    expect(w.google.cell('Oct 2026', 'G10').f).toBe('=F10');
    // fixed deposit
    expect(w.google.value('Oct 2026', 'C4')).toBe(0.0725);
    expect(w.google.cell('Oct 2026', 'C4').fmt?.type).toBe('PERCENT');
    expect(w.google.value('Oct 2026', 'G3')).toBe(1_161_000);
    // Singapore note, in the note's own format
    expect(w.google.value('Oct 2026', 'N9')).toBe('Base: $1= Rs 74.26\nBal : $100.00');
    expect(w.google.value('Oct 2026', 'F9')).toBe(7_426);
    // the sheet's own total follows
    expect(typeof w.google.value('Oct 2026', 'F20')).toBe('number');
  });

  it('is named like the existing tabs and uses few API calls', async () => {
    const w = workbook(["Sep'26", "Aug'26"]);
    const v = view(await sync(w, true));
    expect(v.target.title).toBe("Oct'26");
    // list tabs, read the template, copy it, read the copy, write the values (plus the token)
    const api = w.google.calls.filter((c) => !c.url.includes('/token'));
    expect(api.length).toBeLessThanOrEqual(6);
    expect(w.google.tokenRequests).toBe(1);
  });

  it('puts the new tab after the template when the workbook keeps its newest month at the right', async () => {
    const w = workbook(['Aug 2026', 'Sep 2026']);
    const v = view(await sync(w, true));
    expect(v.target.position).toBe('right');
    expect(w.google.tabOrder()).toEqual(['Notes', 'Aug 2026', 'Sep 2026', 'Oct 2026']);
  });

  it('copies the most recent earlier month even when one is missing', async () => {
    const w = workbook(['Aug 2026', 'Jun 2026']);
    const v = view(await sync(w, true));
    expect(v.target.copiedFrom).toBe('Aug 2026');
  });

  it('adds rows under the right groups, copies formulas into them, and the total grows to include them', async () => {
    const w = workbook();
    const v = view(await sync(w, true, app(true)));
    const g = w.google;
    expect(v.counts.added).toBe(3);
    // the new deposit sits below the group's last deposit (old row 4, so new row 5) in the deposit format
    expect(g.value('Oct 2026', 'B5')).toBe('FD-NRE-7777');
    expect(g.cell('Oct 2026', 'D5').fmt?.type).toBe('DATE');
    expect(g.cell('Oct 2026', 'C5').fmt?.type).toBe('PERCENT');
    expect(g.value('Oct 2026', 'E5')).toBe(dateToSerial('2027-10-05'));
    // the cash account the second bank gained
    const cashRow = [...Array(30).keys()].map((i) => i + 1).find((r) => g.value('Oct 2026', `B${r}`) === 'Cash-NRE-8888')!;
    expect(g.value('Oct 2026', `F${cashRow}`)).toBe(12_000);
    expect(g.cell('Oct 2026', `G${cashRow}`).f).toBe(`=F${cashRow}`);
    // rows below moved down together with their formulas
    expect(g.cell('Oct 2026', 'G6').f).toBe('=F6');
    expect(g.value('Oct 2026', 'F6')).toBe(25_678.12);
    // the total row (now 3 rows lower) still sums the whole register, so it includes the new rows
    const totalRow = [...Array(40).keys()].map((i) => i + 1).find((r) => g.cell('Oct 2026', `F${r}`).f?.startsWith('=SUM'))!;
    expect(totalRow).toBe(23);
    const sum = [...Array(totalRow - 3).keys()].reduce((n, i) => {
      const v = g.value('Oct 2026', `F${i + 3}`);
      return n + (typeof v === 'number' ? v : 0);
    }, 0);
    expect(g.value('Oct 2026', `F${totalRow}`)).toBeCloseTo(sum, 2);
    // what could not be placed is reported, not invented
    expect(v.placeByHand).toHaveLength(2);
  });
});

describe('a month that already has a tab', () => {
  it('keeps one hidden safety copy, replaces the data, and leaves every other month alone', async () => {
    const w = workbook(['Oct 2026', 'Sep 2026']);
    const sep = snapshot(w, 'Sep 2026');
    const octBefore = snapshot(w, 'Oct 2026');
    const v = view(await sync(w, true));
    expect(v.target.existed).toBe(true);
    const backup = w.google.sheet('Oct 2026 - before sync')!;
    expect(backup.hidden).toBe(true);
    expect(backup.index).toBe(w.google.sheets.length - 1); // at the end, so the month tabs keep their order
    expect(JSON.stringify(backup.rows)).toBe(octBefore); // the copy holds what was there before
    expect(snapshot(w, 'Sep 2026')).toBe(sep);
    expect(w.google.value('Oct 2026', 'F5')).toBe(25_678.12);
    expect(w.google.tabOrder().filter((t) => t.includes('before sync'))).toHaveLength(1);
  });

  it('is idempotent: a second sync gives the same sheet, and the safety copy is overwritten, not added to', async () => {
    const w = workbook();
    await sync(w, true, app(true)); // creates the tab (with new rows)
    const first = snapshot(w, 'Oct 2026');
    const again = view(await sync(w, true, app(true)));
    expect(snapshot(w, 'Oct 2026')).toBe(first);
    expect(again.counts).toMatchObject({ updated: 0, added: 0 });
    const third = view(await sync(w, true, app(true)));
    expect(snapshot(w, 'Oct 2026')).toBe(first);
    expect(third.backup?.replaces).toBe(true);
    // one safety copy, and it holds the sheet as it was before the last sync
    const copies = w.google.sheets.filter((s) => s.title.includes('before sync'));
    expect(copies).toHaveLength(1);
    expect(JSON.stringify(copies[0]!.rows)).toBe(first);
    // and a preview now has nothing left to change
    const p = view(await sync(w, false, app(true)));
    expect(p.counts).toMatchObject({ updated: 0, added: 0, cells: 0 });
  });

  it('replaces figures that were wrong with the app’s, but never touches a formula cell', async () => {
    const w = workbook(['Oct 2026', 'Sep 2026']);
    const rows = w.google.sheet('Oct 2026')!.rows;
    rows[4]![5] = { v: 99, fmt: { type: 'NUMBER' } }; // F5 typed over by hand
    rows[16]![5] = { f: '=500+500', fmt: { type: 'NUMBER' } }; // F17 is a formula
    const a = app();
    a.assets.find((x) => x.last4 === '5555')!.value = 2_000;
    await sync(w, true, a);
    expect(w.google.value('Oct 2026', 'F5')).toBe(25_678.12);
    expect(w.google.cell('Oct 2026', 'F17').f).toBe('=500+500');
    expect(w.google.value('Oct 2026', 'F17')).toBe(1_000);
  });

  it('refuses to delete a visible tab that happens to have the safety copy’s name', async () => {
    const w = workbook(['Oct 2026', 'Sep 2026']);
    w.google.add('Oct 2026 - before sync', [[{ v: 'mine' }]]);
    const r = await sync(w, true);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/will not touch a tab you can see/);
    expect(w.google.sheet('Oct 2026 - before sync')!.rows[0]![0]!.v).toBe('mine');
  });
});

describe('problems are explained with the way out', () => {
  it('no earlier month tab', async () => {
    const w = workbook(['Nov 2026']);
    const r = await sync(w, false);
    expect(!r.ok && r.code).toBe('no_template');
    expect(!r.ok && r.message).toMatch(/no month tab before Oct 2026/);
    const none = workbook([]);
    const r2 = await sync(none, false);
    expect(!r2.ok && r2.message).toMatch(/nothing to copy/);
  });

  it('a template that does not look like the usual layout', async () => {
    const w = workbook(['Sep 2026'], () => build({ 3: { A: 'Hello', B: 'World', F: 5 } }));
    const r = await sync(w, false);
    expect(!r.ok && r.code).toBe('no_register');
    expect(!r.ok && r.message).toMatch(/does not look like the usual layout/);
  });

  it('not shared, API off, quota', async () => {
    const w = workbook();
    w.google.shared = false;
    const a = await sync(w, false);
    expect(!a.ok && a.code).toBe('not_shared');
    expect(!a.ok && a.message).toMatch(/sync-bot@fake-project/);
    w.google.shared = true;
    w.google.apiEnabled = false;
    expect((await sync(w, false) as { code?: string }).code).toBe('api_disabled');
  });

  it('a viewer-only account can read for the preview but the write is refused before anything is changed', async () => {
    const w = workbook();
    w.google.canEdit = false;
    expect(view(await sync(w, false)).stage).toBe('preview');
    const r = await sync(w, true);
    expect(!r.ok && r.code).toBe('not_shared');
    expect(w.google.tabOrder()).toEqual(['Notes', 'Sep 2026', 'Aug 2026']);
  });

  it('an unexpected failure is reported without crashing', async () => {
    const w = workbook();
    const r = await runSheetSync({
      api: { ...w.client, email: 'x', listTabs: async () => { throw new Error('boom'); } } as never,
      spreadsheetId: 'x', now: NOW, app: app(), config: CONFIG, apply: false,
    });
    expect(!r.ok && r.message).toMatch(/stopped unexpectedly \(boom\)/);
  });
});

describe('the connection test', () => {
  it('reports the month tabs, the template, the layout and the edit right', async () => {
    const w = workbook();
    const t = await testSheetConnection({ api: w.client, spreadsheetId: w.google.spreadsheetId, now: NOW, app: app(), config: CONFIG });
    expect(t.ok).toBe(true);
    expect(t.template).toBe('Sep 2026');
    expect(t.target).toBe('Oct 2026');
    expect(t.monthTabs).toEqual(['Aug 2026', 'Sep 2026']);
    const text = t.steps.map((s) => s.text).join('\n');
    expect(text).toContain('sync-bot@fake-project.iam.gserviceaccount.com');
    expect(text).toMatch(/Month tabs found: Aug 2026, Sep 2026/);
    expect(text).toMatch(/copies “Sep 2026”.*“Oct 2026”.*to its left/);
    expect(text).toMatch(/layout of “Sep 2026” is recognised: 14 lines \(3 deposits, 6 balances, 3 funds, 1 loans, 1 held by others\)/);
    expect(text).toMatch(/may edit the spreadsheet/);
    // nothing but the file name was "touched", and to the same value
    expect(w.google.title).toBe('Summary - Bank Reports (synthetic)');
    expect(w.google.tabOrder()).toEqual(['Notes', 'Sep 2026', 'Aug 2026']);
  });

  it('says what is wrong, step by step, when the sheet is not shared or cannot be edited', async () => {
    const w = workbook();
    w.google.shared = false;
    const a = await testSheetConnection({ api: w.client, spreadsheetId: w.google.spreadsheetId, now: NOW, app: app(), config: CONFIG });
    expect(a.ok).toBe(false);
    expect(a.steps.at(-1)!.text).toMatch(/not shared with the service account/);
    w.google.shared = true;
    w.google.canEdit = false;
    const b = await testSheetConnection({ api: w.client, spreadsheetId: w.google.spreadsheetId, now: NOW, app: app(), config: CONFIG });
    expect(b.ok).toBe(false);
    expect(b.steps.some((s) => s.ok && /layout/.test(s.text))).toBe(true);
    expect(b.steps.at(-1)!.text).toMatch(/Editor/);
  });

  it('a spreadsheet with no earlier month is a failed step, with the reason', async () => {
    const w = workbook(['Nov 2026']);
    const t = await testSheetConnection({ api: w.client, spreadsheetId: w.google.spreadsheetId, now: NOW, app: app(), config: CONFIG });
    expect(t.ok).toBe(false);
    expect(t.steps.at(-1)!.text).toMatch(/no month tab before Oct 2026/);
  });
});

void monthRows;
