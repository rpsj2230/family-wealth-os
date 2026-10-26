import { describe, expect, it } from 'vitest';
import {
  addProblems,
  buildQuickSave,
  emptyAdd,
  quickLayout,
  savedMessage,
  statusOptions,
  type QuickDraft,
  type QuickRow,
} from './quick-edit';

const row = (o: Partial<QuickRow> = {}): QuickRow => ({
  id: 'a1',
  code: 'Cash-NRE 0266',
  bankKey: 'b1',
  bankName: 'Sample Bank',
  ownerName: 'Anil',
  kind: 'cash',
  ownerId: 'p1',
  institutionId: 'b1',
  label: '',
  accountKind: 'NRE',
  isJoint: false,
  jointHolderId: '',
  last4: '0266',
  linkedLast4: '',
  notes: '',
  status: 'active',
  holderName: '',
  inferred: '',
  fdRate: '',
  fdBookedOn: '',
  fdMaturityOn: '',
  fdPrincipal: '',
  fdMaturityAmount: '',
  fdRefLast4: '',
  currency: 'INR',
  recorded: 100_000,
  recordedOn: '2026-10-01',
  savingsRate: '',
  ...o,
});
const draft = (o: Partial<QuickDraft> = {}): QuickDraft => ({
  balance: '',
  balanceOn: '2026-10-26',
  fx: '',
  savingsRate: '',
  ...o,
});
const TODAY = '2026-10-26';

describe('quickLayout', () => {
  it('shows the few fields people change first and keeps the rare ones behind More', () => {
    const l = quickLayout('cash');
    expect(l.main).toEqual(['label', 'balance', 'savingsRate', 'accountKind', 'status', 'notes']);
    expect(l.more).toContain('last4');
    expect(l.more).toContain('joint');
    expect(l.main).not.toContain('last4');
  });
  it('a deposit has its terms and no balance box', () => {
    const l = quickLayout('fd');
    expect(l.main).toEqual(
      expect.arrayContaining(['fdRate', 'fdMaturityOn', 'fdPrincipal', 'fdMaturityAmount']),
    );
    expect(l.main).not.toContain('balance');
    expect(l.more).toContain('fdRefLast4');
  });
  it('a foreign-currency account has no savings-rate box', () => {
    expect(quickLayout('cash', 'SGD').main).not.toContain('savingsRate');
  });
  it('an account held by someone else keeps who holds it behind More', () => {
    expect(quickLayout('held').more).toContain('holderName');
  });
  it('never loses a field: main and more together cover the same fields for cash', () => {
    const all = [...quickLayout('cash').main, ...quickLayout('cash').more];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('statusOptions', () => {
  it('speaks plainly and keeps a status the list does not normally offer', () => {
    expect(statusOptions('fd', 'active').map((s) => s.label)).toEqual([
      'Running',
      'Matured',
      'Renewed',
      'Closed',
    ]);
    const odd = statusOptions('fd', 'matured_unconfirmed');
    expect(odd[0]!.value).toBe('matured_unconfirmed');
    expect(statusOptions('cash', 'active').map((s) => s.value)).toEqual([
      'active',
      'closed',
      'stopped',
    ]);
  });
});

describe('buildQuickSave', () => {
  it('sends nothing when nothing changed', () => {
    const was = row();
    const q = buildQuickSave(was, was, draft(), TODAY);
    expect(q.details).toBeNull();
    expect(q.monthly).toBeNull();
    expect(q.changes).toEqual([]);
    expect(q.problems).toEqual([]);
  });

  it('a name and a note go as details; the balance goes to the monthly update dated as chosen', () => {
    const was = row();
    const q = buildQuickSave(
      was,
      { ...was, label: 'Salary account', notes: 'AMB 10,000' },
      draft({ balance: '1,25,000.50', balanceOn: '2026-10-20' }),
      TODAY,
    );
    expect(q.details).toEqual({ id: 'a1', label: 'Salary account', notes: 'AMB 10,000' });
    expect(q.monthly).toEqual({ assetId: 'a1', amount: 125000.5, asOf: '2026-10-20' });
    expect(q.changes).toEqual(['name', 'note', 'balance']);
    expect(q.problems).toEqual([]);
  });

  it('a savings rate typed as a percentage is stored as a fraction, and clearing it clears the setting', () => {
    const was = row({ savingsRate: '3' });
    expect(buildQuickSave(was, was, draft({ savingsRate: '3.5' }), TODAY).monthly).toEqual({
      assetId: 'a1',
      interestRate: 0.035,
    });
    expect(buildQuickSave(was, was, draft({ savingsRate: '' }), TODAY).monthly).toEqual({
      assetId: 'a1',
      interestRate: null,
    });
    expect(buildQuickSave(was, was, draft({ savingsRate: '3' }), TODAY).monthly).toBeNull();
    expect(buildQuickSave(was, was, draft({ savingsRate: 'abc' }), TODAY).problems[0]).toMatch(
      /interest rate/,
    );
  });

  it('refuses a balance that is not a number or is dated in the future', () => {
    const was = row();
    expect(buildQuickSave(was, was, draft({ balance: 'lots' }), TODAY).problems[0]).toMatch(
      /plain number/,
    );
    expect(
      buildQuickSave(was, was, draft({ balance: '10', balanceOn: '2026-11-01' }), TODAY)
        .problems[0],
    ).toMatch(/future/);
  });

  it('a foreign balance needs a rate, taken from the last known one when none is typed', () => {
    const was = row({ currency: 'SGD' });
    expect(buildQuickSave(was, was, draft({ balance: '4200' }), TODAY).problems[0]).toMatch(/SGD/);
    const ok = buildQuickSave(was, was, draft({ balance: '4200' }), TODAY, { SGD: 63.4 });
    expect(ok.problems).toEqual([]);
    expect(ok.monthly?.fxRate).toBe(63.4);
    expect(
      buildQuickSave(was, was, draft({ balance: '4200', fx: '64' }), TODAY, { SGD: 63.4 }).monthly
        ?.fxRate,
    ).toBe(64);
  });

  it('a deposit edit sends its terms in database form and checks them', () => {
    const was = row({
      kind: 'fd',
      fdRate: '7',
      fdBookedOn: '2025-10-26',
      fdMaturityOn: '2026-11-01',
      fdPrincipal: '500000',
    });
    const q = buildQuickSave(
      was,
      { ...was, fdRate: '7.25', fdMaturityOn: '2027-11-01' },
      draft(),
      TODAY,
    );
    expect(q.details).toEqual({ id: 'a1', fdRate: 0.0725, fdMaturityOn: '2027-11-01' });
    expect(q.changes).toEqual(['interest rate', 'maturity date']);
    const bad = buildQuickSave(was, { ...was, fdMaturityOn: '2025-01-01' }, draft(), TODAY);
    expect(bad.problems.join(' ')).toMatch(/maturity must be after the start/);
  });

  it('names each change once even when several fields share a word', () => {
    const was = row();
    const q = buildQuickSave(was, { ...was, isJoint: true, jointHolderId: 'p2' }, draft(), TODAY);
    expect(q.changes).toEqual(['joint', 'second name']);
  });
});

describe('savedMessage', () => {
  it('says what was kept in plain words', () => {
    expect(savedMessage([])).toBe('Nothing was changed.');
    expect(savedMessage(['balance'])).toBe('Saved: balance.');
    expect(savedMessage(['name', 'interest rate', 'balance'])).toBe(
      'Saved: name, interest rate and balance.',
    );
  });
});

describe('addProblems', () => {
  it('lists what is missing for a new deposit, in plain words', () => {
    const p = addProblems(emptyAdd());
    expect(p).toEqual(
      expect.arrayContaining([
        'choose the bank',
        'choose whose it is',
        'enter the amount invested',
        'enter a start date and a later maturity date',
      ]),
    );
  });
  it('a complete deposit has no problems; a savings account needs only the bank and person', () => {
    expect(
      addProblems(
        emptyAdd({
          institutionId: 'b',
          ownerId: 'p',
          principal: '5,00,000',
          ratePct: '7.25',
          bookedOn: '2026-10-01',
          maturityOn: '2027-10-01',
        }),
      ),
    ).toEqual([]);
    expect(
      addProblems(emptyAdd({ type: 'bank_account', institutionId: 'b', ownerId: 'p' })),
    ).toEqual([]);
  });
  it('rejects a rate outside 0 to 30 and a maturity before the start', () => {
    const base = emptyAdd({
      institutionId: 'b',
      ownerId: 'p',
      principal: '1000',
      ratePct: '45',
      bookedOn: '2026-10-01',
      maturityOn: '2026-09-01',
    });
    const p = addProblems(base);
    expect(p.some((x) => /interest rate/.test(x))).toBe(true);
    expect(p.some((x) => /later maturity/.test(x))).toBe(true);
  });
});
