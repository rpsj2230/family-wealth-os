import { describe, expect, it } from 'vitest';
import { computeSetupStatus, setupProgress, type SetupFacts } from './setup-status';

const empty: SetupFacts = {
  today: '2026-10-26',
  people: [],
  incomeItems: 0,
  spendingItems: 0,
  unconfirmedRuleGroups: [
    'deposits',
    'reminders',
    'estimates',
    'rates',
    'refunds',
    'harvest',
    'funds',
    'liquidity',
  ],
  taxRules: [],
  aiKeysTotal: 0,
  aiKeysOn: 0,
  integrationSaved: false,
  inboxLabel: 'FWOS/Inbox',
  emailsRead: 0,
  telegramSet: false,
  rateSources: 0,
  digestEnabled: false,
  emergencyContacts: 0,
  emergencyMode: null,
  casImports: 0,
  has26as: false,
  hasAis: false,
};

const full: SetupFacts = {
  ...empty,
  people: [
    { name: 'Asha', dob: '1980-01-02', panLast4: '1234', isMinor: false },
    { name: 'Kiran', dob: '2012-05-06', panLast4: null, isMinor: true },
  ],
  incomeItems: 2,
  spendingItems: 1,
  unconfirmedRuleGroups: [],
  taxRules: [{ fy: '2026-27', verified: true }],
  aiKeysTotal: 2,
  aiKeysOn: 2,
  integrationSaved: true,
  emailsRead: 12,
  telegramSet: true,
  rateSources: 3,
  digestEnabled: true,
  emergencyContacts: 2,
  emergencyMode: 'inactive',
  casImports: 2,
  has26as: true,
  hasAis: true,
};

const byKey = (f: SetupFacts) => Object.fromEntries(computeSetupStatus(f).map((i) => [i.key, i]));

describe('computeSetupStatus', () => {
  it('lists every item, each with a link, and marks nothing done on an empty household', () => {
    const items = computeSetupStatus(empty);
    expect(items.map((i) => i.key)).toEqual([
      'people',
      'income',
      'rules',
      'tax-rules',
      'ai-key',
      'gmail',
      'rate-pages',
      'telegram',
      'digest',
      'emergency',
      'cas',
      'statements',
    ]);
    expect(items.every((i) => !i.done)).toBe(true);
    expect(items.every((i) => i.href.startsWith('/'))).toBe(true);
    expect(setupProgress(items)).toEqual({ done: 0, total: 12 });
  });

  it('marks everything done when everything is set', () => {
    const items = computeSetupStatus(full);
    expect(items.filter((i) => !i.done).map((i) => i.key)).toEqual([]);
    expect(setupProgress(items)).toEqual({ done: 12, total: 12 });
  });

  it('needs a date of birth for everyone and a PAN last four for adults only', () => {
    const noPan = byKey({
      ...full,
      people: [
        { name: 'Asha', dob: '1980-01-02', panLast4: null, isMinor: false },
        { name: 'Kiran', dob: '2012-05-06', panLast4: null, isMinor: true },
      ],
    });
    expect(noPan.people!.done).toBe(false);
    expect(noPan.people!.hint).toBe('PAN missing: Asha.');
    const noDob = byKey({
      ...full,
      people: [{ name: 'Kiran', dob: null, panLast4: null, isMinor: true }],
    });
    expect(noDob.people!.done).toBe(false);
    expect(noDob.people!.hint).toContain('Date of birth missing: Kiran');
  });

  it('wants both an income and a spending line', () => {
    expect(byKey({ ...full, spendingItems: 0 }).income!.done).toBe(false);
    expect(byKey({ ...full, incomeItems: 0 }).income!.done).toBe(false);
  });

  it('names the money-rule groups still on built-in numbers', () => {
    const r = byKey({
      ...full,
      unconfirmedRuleGroups: ['deposits', 'harvest', 'liquidity'],
    }).rules!;
    expect(r.done).toBe(false);
    expect(r.hint).toContain('3 of 12');
    expect(r.hint).toContain('Deposits, Tax-gain harvesting and 1 more');
  });

  it('needs the CURRENT financial year, entered and checked', () => {
    expect(
      byKey({ ...full, taxRules: [{ fy: '2025-26', verified: true }] })['tax-rules']!.done,
    ).toBe(false);
    const unchecked = byKey({ ...full, taxRules: [{ fy: '2026-27', verified: false }] })[
      'tax-rules'
    ]!;
    expect(unchecked.done).toBe(false);
    expect(unchecked.hint).toContain('not yet marked as checked');
    // the new year starts on 1 April
    expect(byKey({ ...full, today: '2027-04-01' })['tax-rules']!.label).toContain('2027-28');
    expect(byKey({ ...full, today: '2027-03-31' })['tax-rules']!.label).toContain('2026-27');
  });

  it('counts the Gmail label as set once saved or once an e-mail was read', () => {
    expect(byKey({ ...full, integrationSaved: false, emailsRead: 0 }).gmail!.done).toBe(false);
    expect(byKey({ ...full, integrationSaved: true, emailsRead: 0 }).gmail!.hint).toContain(
      'no e-mail has been read',
    );
    expect(byKey({ ...full, integrationSaved: false, emailsRead: 4 }).gmail!.done).toBe(true);
  });

  it('counts the AI as ready when any one key is switched on', () => {
    expect(byKey({ ...full, aiKeysTotal: 0, aiKeysOn: 0 })['ai-key']!.done).toBe(false);
    const off = byKey({ ...full, aiKeysTotal: 2, aiKeysOn: 0 })['ai-key']!;
    expect(off.done).toBe(false);
    expect(off.hint).toBe(
      'All 2 saved keys are switched off. Switch one on so the app can read PDF statements and unfamiliar e-mails.',
    );
    const one = byKey({ ...full, aiKeysTotal: 3, aiKeysOn: 1 })['ai-key']!;
    expect(one.done).toBe(true);
    expect(one.hint).toContain('One key is switched on (3 saved)');
    const two = byKey({ ...full, aiKeysTotal: 2, aiKeysOn: 2 })['ai-key']!;
    expect(two.hint).toContain('2 keys are switched on, tried in the order you chose');
  });

  it('needs both 26AS and AIS, and says which one is missing', () => {
    const s = byKey({ ...full, hasAis: false }).statements!;
    expect(s.done).toBe(false);
    expect(s.hint).toBe('26AS read, AIS not yet.');
  });

  it('describes who can open the handbook', () => {
    expect(byKey({ ...full, emergencyMode: 'manual' }).emergency!.hint).toContain(
      'only when you release it',
    );
    expect(byKey({ ...full, emergencyContacts: 0 }).emergency!.done).toBe(false);
  });

  it('never carries a secret: hints only say a key exists', () => {
    const text = JSON.stringify(computeSetupStatus(full));
    expect(text).not.toMatch(/gsk_|AIza|bot\d/);
  });

  it('an item switched off as not needed is no longer a to-do and leaves the count', () => {
    const items = computeSetupStatus({ ...empty, off: ['telegram'] });
    const t = items.find((i) => i.key === 'telegram')!;
    expect(t).toMatchObject({ off: true, done: true });
    const p = setupProgress(items);
    expect(p.total).toBe(items.length - 1);
    expect(items.filter((i) => !i.done).some((i) => i.key === 'telegram')).toBe(false);
  });
});
