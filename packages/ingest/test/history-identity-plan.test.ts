import { beforeAll, describe, expect, it } from 'vitest';
import {
  planHistory,
  type HistoryExisting,
  type HistoryPlan,
  type IdentityLine,
} from '../src/history';
import { applyHistoryMonth } from '../src/history-import';
import {
  ACCOUNTS,
  OWNERS,
  buildIdentityWorkbook,
  type IdentityFixture,
} from './history-identity-fixture';
import { FakeDb } from './history-fake-db';

const TODAY = '2026-10-27';

let fx: IdentityFixture;
const base = (): HistoryExisting => ({ assets: ACCOUNTS.map((a) => ({ ...a })), observations: [] });

beforeAll(async () => {
  fx = await buildIdentityWorkbook();
});

const planOf = (
  existing: HistoryExisting = base(),
  pins?: Record<string, string>,
): Promise<HistoryPlan> =>
  planHistory(fx.bytes, {
    today: TODAY,
    ownerNames: OWNERS,
    existing,
    ...(pins ? { pins } : {}),
  });

const lines = (plan: HistoryPlan, tab = 'Mar 2024'): IdentityLine[] =>
  plan.months.find((m) => m.tab === tab)!.identities;
const byBank = (plan: HistoryPlan, bank: string, tab = 'Mar 2024') =>
  lines(plan, tab).filter((l) => l.bank === bank);

describe('identifying lines from the other tabs', () => {
  let plan: HistoryPlan;
  beforeAll(async () => {
    plan = await planOf();
  });

  it('reads both neighbours and every line, with the plain lines unidentified', () => {
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.rowsRead).toBe(10);
    // plain lines the tab does not identify (the Seventh Bank line is matched on its own)
    expect(mar.identities.map((l) => l.bank).sort()).toEqual([
      'Fifth Bank',
      'Fifth Bank',
      'Fourth Bank',
      'Fourth Bank',
      'Sample Bank',
      'Sample Bank',
      'Second Bank',
      'Sixth Bank',
      'Third Bank',
    ]);
    // the tabs that name every account have nothing to identify
    expect(plan.months.find((m) => m.tab === 'Jan 2024')!.identities).toEqual([]);
  });

  it('same position on both sides: certain, used, with the why naming both tabs', () => {
    const [first, second] = byBank(plan, 'Sample Bank');
    expect(first).toMatchObject({
      state: 'certain',
      accepted: true,
      account: { id: 's1', label: 'Cash-NRE-1111', detail: 'NRE, ending 1111' },
      position: 1,
      of: 2,
    });
    expect(second).toMatchObject({ state: 'certain', accepted: true, account: { id: 's2' } });
    expect(first!.why).toMatch(
      /Same position \(1st of 2\) in Sample Bank - Asha as in the Jan 2024 and May 2024 tabs/,
    );
    expect(first!.fromTabs).toEqual(['Jan 2024', 'May 2024']);
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    const w = mar.writes.filter((x) => x.assetId === 's1' || x.assetId === 's2');
    expect(w.map((x) => [x.assetId, x.amount, x.ref])).toEqual([
      ['s1', 10_500, 'hist:Mar 2024:F3'],
      ['s2', 2_100, 'hist:Mar 2024:F4'],
    ]);
    expect(w[0]!.identity).toMatchObject({ how: 'inferred' });
    expect(w[0]!.identity!.note).toMatch(
      /not stated on the sheet.*Cash-NRE-1111.*Jan 2024 and May 2024 tabs.*same position/,
    );
  });

  it('an account opened part-way: the one open on both sides, likely and not used until accepted', () => {
    const [l] = byBank(plan, 'Second Bank');
    expect(l).toMatchObject({ state: 'likely', accepted: false, account: { id: 'b1' } });
    expect(l!.why).toMatch(/1 line here against 1 in Jan 2024 and 2 in May 2024/);
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.writes.some((w) => w.assetId === 'b1')).toBe(false);
    expect(
      mar.unmatchedRows.some((u) => u.bank === 'Second Bank' && /suggest/.test(u.reason)),
    ).toBe(true);
  });

  it('the closer balance breaks a tie, as likely only', () => {
    const [l] = byBank(plan, 'Third Bank');
    expect(l).toMatchObject({ state: 'likely', accepted: false, account: { id: 't2' } });
    expect(l!.why).toMatch(/much closer/);
  });

  it('a line that states NRE where the neighbours have an NRO is blocked with the reason, and is not used', () => {
    const f = byBank(plan, 'Fourth Bank');
    expect(f.map((l) => l.state)).toEqual(['blocked', 'blocked']);
    expect(f[1]!.accepted).toBe(false);
    expect(f[1]!.contradiction).toMatch(/Cash-NRO-8888/);
    expect(f[1]!.why).toMatch(/^Not inferred/);
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.writes.some((w) => w.assetId === 'f1' || w.assetId === 'f2')).toBe(false);
  });

  it('a balance far from what the account held next door is blocked; the other line of the bank is fine', () => {
    const [a, b] = byBank(plan, 'Fifth Bank');
    expect(a).toMatchObject({ state: 'blocked', accepted: false });
    expect(a!.contradiction).toMatch(
      /₹90,00,000 is far from what .* held next door \(₹100 in Jan 2024 and ₹120 in May 2024\)/,
    );
    // the account it would have been is offered first
    expect(a!.candidates[0]!.id).toBe('v1');
    expect(b).toMatchObject({ state: 'certain', accepted: true, account: { id: 'v2' } });
  });

  it('with no tab naming the accounts: ambiguous in every tab, with the candidates and the other accounts of the bank', () => {
    for (const tab of ['Feb 2024', 'Mar 2024', 'Apr 2024']) {
      const [l] = byBank(plan, 'Sixth Bank', tab);
      expect(l).toMatchObject({ state: 'ambiguous', accepted: false, account: null });
      expect(l!.candidates.map((c) => c.id)).toEqual(['x1', 'x2']);
      expect(l!.why).toMatch(/nothing to work it out from/);
    }
  });

  it('lists, for each line, the same label at the same place in the other tabs', () => {
    const feb = byBank(plan, 'Sixth Bank', 'Feb 2024')[0]!;
    expect(feb.sameAs.sort()).toEqual(['Apr 2024|F3', 'Mar 2024|F11']);
    expect(feb.id).toBe('Feb 2024|F3');
  });

  it('a line matched only because it does not say "joint" is still matched as before, and the month says where the tabs disagree', () => {
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.writes.find((w) => w.cell === 'F12')).toMatchObject({ assetId: 'j2', amount: 55 });
    expect(mar.assumed).toEqual({ agree: 0, differ: 1, unchecked: 0 });
    expect(mar.warnings.join(' ')).toMatch(
      /F12: matched to Cash-NRE-0001 because the line does not say "joint", but the other tabs point to the joint NRE account Cash-NRE JO-0002 \(Jan 2024, May 2024\)\. Check it\./,
    );
    expect(plan.summary.assumed).toEqual({ agree: 0, differ: 1, unchecked: 0 });
  });

  it('counts what became of the lines in the summary', () => {
    expect(plan.summary.identities).toEqual({
      certain: 3,
      likely: 2,
      pinned: 0,
      open: 3,
      blocked: 3,
      leftOut: 0,
    });
  });

  it('inferred lines count as matched, unmatched ones stay in the list of lines not matched', () => {
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.matched).toBe(4);
    expect(mar.unmatched).toBe(6);
  });
});

describe('what the person chooses', () => {
  it('accepting a likely line and choosing for an ambiguous one use them, as pinned', async () => {
    const plan = await planOf(base(), { 'Mar 2024|F5': 'b1', 'Mar 2024|F11': 'x2' });
    const second = byBank(plan, 'Second Bank')[0]!;
    expect(second).toMatchObject({
      state: 'pinned',
      accepted: true,
      account: { id: 'b1' },
      why: 'You chose this account.',
    });
    const six = byBank(plan, 'Sixth Bank')[0]!;
    expect(six).toMatchObject({ state: 'pinned', accepted: true, account: { id: 'x2' } });
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    const w = mar.writes.find((x) => x.assetId === 'x2')!;
    expect(w).toMatchObject({ amount: 510, ref: 'hist:Mar 2024:F11' });
    expect(w.identity).toMatchObject({ how: 'pinned' });
    expect(w.identity!.note).toMatch(/chosen by you as Cash-NRO-3434/);
  });

  it('a choice made for every tab where the label sits in the same place is written for each', async () => {
    const first = await planOf();
    const all = lines(first, 'Feb 2024')[0]!;
    const pins = Object.fromEntries([all.id, ...all.sameAs].map((id) => [id, 'x1']));
    const plan = await planOf(base(), pins);
    for (const tab of ['Feb 2024', 'Mar 2024', 'Apr 2024']) {
      const w = plan.months.find((m) => m.tab === tab)!.writes.filter((x) => x.assetId === 'x1');
      expect(w, tab).toHaveLength(1);
      expect(w[0]!.identity?.how).toBe('pinned');
    }
  });

  it('leaving a line out writes nothing for it and is not inferred again', async () => {
    const plan = await planOf(base(), { 'Mar 2024|F3': '' });
    const l = byBank(plan, 'Sample Bank')[0]!;
    expect(l).toMatchObject({ state: 'left_out', accepted: false, account: null });
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.writes.some((w) => w.cell === 'F3')).toBe(false);
    expect(mar.unmatchedRows.find((u) => u.cell === 'F3')!.reason).toBe(
      'You chose to leave this line out.',
    );
  });

  it('a choice that is not one of the accounts that fit is ignored and said so', async () => {
    const plan = await planOf(base(), { 'Mar 2024|F3': 't1' });
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    expect(byBank(plan, 'Sample Bank')[0]!.state).toBe('certain');
    expect(mar.writes.some((w) => w.assetId === 't1' && w.cell === 'F3')).toBe(false);
    expect(mar.warnings.join(' ')).toMatch(/choice was ignored/);
  });

  it('a choice that would put two lines of a tab on one account keeps only the first', async () => {
    const plan = await planOf(base(), { 'Mar 2024|F3': 's2' });
    const mar = plan.months.find((m) => m.tab === 'Mar 2024')!;
    const onS2 = mar.writes.filter((w) => w.assetId === 's2');
    expect(onS2).toHaveLength(1);
  });
});

describe('writing', () => {
  it('writes an inferred or chosen line like a direct one and says so on the note, and a second run adds nothing', async () => {
    const db = new FakeDb(base());
    const pins = { 'Mar 2024|F5': 'b1', 'Mar 2024|F11': 'x2' };
    const run = async () => {
      const plan = await planOf(db.snapshot(), pins);
      return applyHistoryMonth(plan, 'Mar 2024', {}, db.io());
    };
    const first = await run();
    expect(first).toMatchObject({ ok: true, errors: [] });
    // three certain, the accepted likely and the chosen ambiguous one, and the line that matched on its own
    expect(first.observations).toBe(6);
    const mine = db.observations.filter((o) => o.sourceRef?.startsWith('hist:Mar 2024:'));
    expect(mine.map((o) => o.assetId).sort()).toEqual(['b1', 'j2', 's1', 's2', 'v2', 'x2']);
    expect(
      mine.every((o) => o.source === 'workbook' && o.confidence === 'imported_unverified'),
    ).toBe(true);
    const notes = mine.map((o) => db.notes.get(o.id) ?? '');
    expect(notes.filter((n) => /inferred as/.test(n))).toHaveLength(3);
    expect(notes.filter((n) => /chosen by you as/.test(n))).toHaveLength(2);
    expect(notes.every((n) => !/[0-9]{9,}/.test(n))).toBe(true);

    const n = db.observations.length;
    const second = await run();
    expect(second).toMatchObject({ ok: true, observations: 0, identical: 6 });
    expect(db.observations).toHaveLength(n);
  });

  it('a line written earlier keeps its account when the run is repeated without the choice (the reference decides)', async () => {
    const db = new FakeDb(base());
    const withPin = await planOf(db.snapshot(), { 'Mar 2024|F11': 'x2' });
    await applyHistoryMonth(withPin, 'Mar 2024', {}, db.io());
    const n = db.observations.length;
    // no choices this time: the value for that cell is on file for x2, so the line is still x2, listed no more, and nothing is added
    const again = await planOf(db.snapshot());
    expect(byBank(again, 'Sixth Bank')).toEqual([]);
    const mar = again.months.find((m) => m.tab === 'Mar 2024')!;
    expect(mar.writes.find((w) => w.cell === 'F11')).toMatchObject({
      assetId: 'x2',
      status: 'identical',
    });
    const res = await applyHistoryMonth(again, 'Mar 2024', {}, db.io());
    expect(res.errors).toEqual([]);
    expect(db.observations).toHaveLength(n);
  });

  it('never overwrites: a value already on file for that account and month is a conflict, as for any line', async () => {
    const existing = base();
    existing.observations.push({
      id: 'o-old',
      assetId: 's1',
      asOf: '2024-03-31',
      amount: 9_999,
      currency: 'INR',
      source: 'manual',
      sourceRef: null,
      confidence: 'manual_confirmed',
      supersededBy: null,
    });
    const plan = await planOf(existing);
    expect(plan.conflicts.find((c) => c.assetId === 's1')).toMatchObject({
      tab: 'Mar 2024',
      sheetAmount: 10_500,
      existing: { amount: 9_999 },
    });
    const db = new FakeDb(existing);
    const res = await applyHistoryMonth(plan, 'Mar 2024', {}, db.io());
    expect(res.conflictsKept).toBe(1);
    expect(db.observations.find((o) => o.id === 'o-old')!.amount).toBe(9_999);
    expect(db.superseded).toEqual([]);
  });
});
