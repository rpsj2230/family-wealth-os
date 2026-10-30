import { describe, expect, it } from 'vitest';
import {
  buildAddFund,
  buildFundSave,
  buildTxn,
  draftOf,
  EMPTY_FUND,
  savedMessage,
  typed,
  type FundEditRow,
} from './fund-edit';

const row: FundEditRow = {
  id: 'a',
  name: 'Sample Flexi Cap Fund',
  label: '',
  ownerId: 'p1',
  ownerName: 'Anil',
  units: 100.5,
  nav: 50,
  value: 5025,
  invested: 4000,
  sipMonthly: 1000,
  sipStopped: false,
  startedOn: '2022-07-05',
  plan: 'direct',
  goalIds: ['g1'],
  closed: false,
  exitLoadPct: 0.01,
  exitLoadDays: 365,
  amfiCode: '1',
  hasStatement: true,
};
const TODAY = '2026-10-26';

describe('typed', () => {
  it('reads numbers typed with commas and rupee signs', () => {
    expect(typed('₹1,25,000.50')).toBe(125000.5);
    expect(typed('')).toBeNull();
    expect(typed('abc')).toBeNaN();
  });
});

describe('buildFundSave', () => {
  it('has no changes when nothing was touched', () => {
    const r = buildFundSave(row, draftOf(row), TODAY);
    expect(r.changes).toEqual([]);
    expect(r.payload).toBeNull();
    expect(r.problems).toEqual([]);
  });

  it('works the value out from the units and the live price', () => {
    const d = { ...draftOf(row), units: '120' };
    const r = buildFundSave(row, d, TODAY);
    expect(r.payload).toMatchObject({
      assetId: 'a',
      units: 120,
      nav: 50,
      value: 6000,
      asOf: TODAY,
    });
    expect(r.changes).toEqual(['units']);
  });

  it('asks for the value when the fund has no live price', () => {
    const noPrice = { ...row, nav: null };
    const d = { ...draftOf(noPrice), units: '120' };
    expect(buildFundSave(noPrice, d, TODAY).problems[0]).toContain('value now');
    const ok = buildFundSave(noPrice, { ...d, value: '6,100' }, TODAY);
    expect(ok.payload).toMatchObject({ units: 120, nav: null, value: 6100 });
  });

  it('collects each changed field and names it in words', () => {
    const d = {
      ...draftOf(row),
      label: 'Our flexi fund',
      invested: '4500',
      sip: '1500',
      startedOn: '2022-08-05',
      goalId: '',
      plan: 'regular',
      exitPct: '0.5',
      exitDays: '180',
    };
    const r = buildFundSave(row, d, TODAY);
    expect(r.changes).toEqual([
      'name',
      'amount invested',
      'SIP',
      'start date',
      'goal',
      'plan',
      'exit load',
    ]);
    expect(r.payload).toMatchObject({
      label: 'Our flexi fund',
      invested: 4500,
      sipMonthly: 1500,
      startedOn: '2022-08-05',
      goalId: '',
      planType: 'regular',
      exitLoadPct: 0.005,
      exitLoadDays: 180,
    });
    expect(savedMessage(r.changes)).toBe(
      'Saved: name, amount invested, SIP, start date, goal, plan, exit load.',
    );
  });

  it('stops and resumes the SIP, and a cleared SIP is not left stopped', () => {
    expect(buildFundSave(row, { ...draftOf(row), sipStopped: true }, TODAY).payload).toMatchObject({
      sipStopped: true,
    });
    const cleared = buildFundSave(row, { ...draftOf(row), sip: '' }, TODAY);
    expect(cleared.payload).toMatchObject({ sipMonthly: null });
    const stoppedRow = { ...row, sipStopped: true };
    expect(
      buildFundSave(stoppedRow, { ...draftOf(stoppedRow), sipStopped: false }, TODAY).changes,
    ).toEqual(['SIP running']);
  });

  it('marks a fund with no SIP amount saved as stopped', () => {
    const none = { ...row, sipMonthly: null };
    const r = buildFundSave(none, { ...draftOf(none), sipStopped: true }, TODAY);
    expect(r.problems).toEqual([]);
    expect(r.payload).toMatchObject({ sipStopped: true });
    expect(r.payload?.sipMonthly).toBeUndefined();
    expect(r.changes).toEqual(['SIP stopped']);
  });

  it('marks a fund sold or closed, and active again', () => {
    expect(buildFundSave(row, { ...draftOf(row), closed: true }, TODAY).payload).toMatchObject({
      status: 'closed',
    });
    const closed = { ...row, closed: true };
    expect(
      buildFundSave(closed, { ...draftOf(closed), closed: false }, TODAY).payload,
    ).toMatchObject({
      status: 'active',
    });
  });

  it('leaves the goal alone for a fund split between several goals', () => {
    const split = { ...row, goalIds: ['g1', 'g2'] };
    expect(buildFundSave(split, { ...draftOf(split), goalId: 'g3' }, TODAY).payload).toBeNull();
  });

  it('refuses what cannot be saved, and says which box to look at', () => {
    const r = buildFundSave(
      row,
      {
        ...draftOf(row),
        units: 'many',
        invested: '-5',
        sip: '0',
        startedOn: '2030-01-01',
        exitPct: '50',
        label: 'x'.repeat(121),
      },
      TODAY,
    );
    expect(r.payload).toBeNull();
    expect(r.problems).toEqual(
      expect.arrayContaining([
        'units held',
        'amount invested',
        'SIP amount',
        'start date (today or earlier)',
      ]),
    );
    expect(r.problems.some((p) => p.startsWith('exit load'))).toBe(true);
    expect(r.problems.some((p) => p.includes('120 characters'))).toBe(true);
  });

  it('clears the exit load when both boxes are emptied', () => {
    const r = buildFundSave(row, { ...draftOf(row), exitPct: '', exitDays: '' }, TODAY);
    expect(r.payload).toMatchObject({ exitLoadPct: null, exitLoadDays: null });
  });
});

describe('buildAddFund', () => {
  it('needs a name, a person, the amount invested and the value', () => {
    const r = buildAddFund(EMPTY_FUND, TODAY);
    expect(r.payload).toBeNull();
    expect(r.problems).toEqual(
      expect.arrayContaining([
        'the fund name (2 to 120 characters)',
        'whose fund it is',
        'the amount invested',
        'the value now',
      ]),
    );
  });
  it('builds the payload from what was typed', () => {
    const r = buildAddFund(
      {
        ...EMPTY_FUND,
        ownerId: 'p1',
        name: ' New Fund ',
        invested: '1,00,000',
        value: '1,10,000',
        units: '500',
        sip: '5000',
        plan: 'direct',
        startedOn: '2024-01-05',
      },
      TODAY,
    );
    expect(r.payload).toEqual({
      ownerId: 'p1',
      name: 'New Fund',
      invested: 100000,
      value: 110000,
      units: 500,
      startedOn: '2024-01-05',
      sipMonthly: 5000,
      planType: 'direct',
      goalId: '',
    });
  });
});

describe('buildTxn', () => {
  const ok = {
    asset: 'a',
    date: '2026-10-01',
    kind: 'sip',
    amount: '5000',
    units: '',
    nav: '125.5',
  };
  it('accepts units or a price', () => {
    expect(buildTxn(ok, TODAY).values).toMatchObject({ amount: '5000', nav: '125.5', units: '' });
    expect(buildTxn({ ...ok, nav: '', units: '39.8' }, TODAY).problems).toEqual([]);
  });
  it('refuses a missing amount, both units and price missing, a future date and an unknown type', () => {
    expect(buildTxn({ ...ok, amount: '' }, TODAY).problems).toContain('the amount');
    expect(buildTxn({ ...ok, nav: '' }, TODAY).problems).toContain('units or the price per unit');
    expect(buildTxn({ ...ok, date: '2027-01-01' }, TODAY).problems).toContain(
      'the date (today or earlier)',
    );
    expect(buildTxn({ ...ok, kind: 'gift' }, TODAY).problems).toContain('the type');
  });
  it('a sale of every unit needs only the amount received: the units are what is held on the date', () => {
    const r = buildTxn({ ...ok, kind: 'redeem', nav: '', units: '12', all: true }, TODAY);
    expect(r.problems).toEqual([]);
    expect(r.values).toMatchObject({ kind: 'redeem', units: '', all: '1' });
    expect(buildTxn({ ...ok, kind: 'sip', all: true }, TODAY).problems).toContain(
      'a sale or switch out (only those can be for every unit)',
    );
  });
});
