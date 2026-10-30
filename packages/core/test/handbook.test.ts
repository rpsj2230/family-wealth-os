import { describe, expect, it } from 'vitest';
import { buildBankBlocks } from '../src/accounts-view';
import {
  buildGuide,
  buildHandbook,
  CLAIM_CHECKLISTS,
  claimKey,
  contactLines,
  doneCount,
  EMPTY_PROFILE,
  fundHouseOf,
  handbookGaps,
  hbSay,
  hbT,
  parseContactLines,
  profileFromJson,
  STEP_KEY,
  type HandbookInput,
  type HbText,
} from '../src/handbook';
import { buildPortfolio, type AssetRow, type FdRow, type ObservationRow } from '../src/portfolio';

const today = new Date('2026-10-26T00:00:00Z');
const assets: AssetRow[] = [
  {
    id: 's',
    owner_id: 'p1',
    type: 'bank_account',
    status: 'active',
    nickname: 's',
    currency: 'INR',
    account_kind: 'NRE',
    expected_freshness_days: 35,
    institution_id: 'b1',
    identifier_last4: '1111',
    sort_order: 1,
    notes: 'AMB 10K',
  },
  {
    id: 'f',
    owner_id: 'p1',
    type: 'fixed_deposit',
    status: 'active',
    nickname: 'f',
    currency: 'INR',
    account_kind: 'NRE',
    expected_freshness_days: 35,
    institution_id: 'b1',
    linked_last4: '1111',
    sort_order: 2,
  },
];
const obs: ObservationRow[] = [
  {
    id: 'o',
    asset_id: 's',
    kind: 'balance',
    amount: 50_000,
    currency: 'INR',
    fx_rate: null,
    as_of: '2026-10-20',
    confidence: 'manual_confirmed',
    source: 'manual',
    created_at: '2026-10-20T00:00:00Z',
    superseded_by: null,
  },
];
const fds: FdRow[] = [
  {
    asset_id: 'f',
    principal: 500_000,
    rate: 0.08,
    booked_on: '2026-01-01',
    maturity_on: '2027-01-01',
    compounding: 'quarterly',
    bank_maturity_amount: 540_000,
    fd_ref_last4: '4321',
  },
];
const banks = buildBankBlocks({
  assets,
  observations: obs,
  fds,
  portfolio: buildPortfolio(assets, obs, fds, today),
  institutionNames: { b1: 'Sample Bank' },
  today,
});

const input = (o: Partial<HandbookInput> = {}): HandbookInput => ({
  asOf: '2026-10-26',
  householdName: 'Sample family',
  people: [
    {
      name: 'Parent',
      dob: '1980-05-05',
      isMinor: false,
      guardian: null,
      panLast4: '234F',
      residency: 'NRI',
    },
    {
      name: 'Child',
      dob: '2015-03-03',
      isMinor: true,
      guardian: 'Parent',
      panLast4: null,
      residency: null,
    },
  ],
  profile: {
    ...EMPTY_PROFILE,
    contacts: [{ name: 'Uncle', relation: 'brother', phone: '+65 0000 0000', note: '' }],
    willLocation: 'the green folder',
  },
  banks,
  ownerName: { p1: 'Parent' },
  funds: [
    {
      owner: 'Parent',
      fund: 'Sample Fund',
      value: 100_000,
      invested: 80_000,
      sipMonthly: 10_000,
      sipStopped: false,
    },
  ],
  heldByOthers: [],
  policies: [
    {
      kind: 'term',
      insurer: 'Sample Life',
      coverage: '₹1 crore',
      insured: ['Parent'],
      paidBy: null,
      renewalOn: '2027-02-01',
      expiresOn: null,
      nominee: null,
      documents: 'green folder',
    },
  ],
  property: [{ owner: 'Parent', label: 'Flat', value: 2_500_000, note: null }],
  owedToUs: [{ counterparty: 'A friend', outstanding: 7000, expectedOn: null }],
  nominees: { f: 'Child, 100%' },
  institutions: [{ id: 'b1', name: 'Sample Bank', helpline: '1800 000 000' }],
  ...o,
});

describe('buildHandbook', () => {
  const h = buildHandbook(input());
  const g = h.guide!;
  const text = JSON.stringify(h);
  const card = (id: string) => g.cards.find((c) => c.id === id)!;

  it('stores a guide with an English title and the disclaimer', () => {
    expect(h.title).toBe('Sample family: family handbook');
    expect(h.disclaimer).toContain('not legal or tax advice');
    expect(g.v).toBe(2);
    expect(h.sections).toBeUndefined();
  });

  it('never stores a full PAN, and shows only the last four digits of accounts', () => {
    expect(text).not.toMatch(/[A-Z]{5}[0-9]{4}[A-Z]/);
    expect(g.people[0]).toMatchObject({ name: 'Parent', age: 46, panLast4: '234F' });
    expect(g.people[1]).toMatchObject({ isMinor: true, guardian: 'Parent' });
  });

  it('has one card per bank, fund house and insurer, with what is held, nominee and helpline', () => {
    expect(g.cards.map((c) => [c.id, c.kind])).toEqual([
      ['b-b1', 'bank'],
      ['f-sample', 'funds'],
      ['i-sample-life', 'insurer'],
    ]);
    const bank = card('b-b1');
    expect(bank.name).toBe('Sample Bank');
    expect(bank.holdings).toHaveLength(2);
    const fd = bank.holdings.find((x) => typeof x.label !== 'string' && x.label.k === 'h.fd')!;
    expect(hbSay(fd.label as HbText)).toBe('Fixed deposit (NRE) …1111');
    expect(hbSay(fd.detail!)).toContain('8% a year');
    expect(hbSay(fd.detail!)).toContain('deposit number ends 4321');
    expect(fd.nominee).toBe('Child, 100%');
    const savings = bank.holdings.find((x) => x !== fd)!;
    expect(savings.amount).toBeGreaterThanOrEqual(50_000);
    expect(savings).toMatchObject({
      owner: 'Parent',
      nominee: null,
      note: 'AMB 10K',
    });
    expect(bank.helpline).toBe('1800 000 000');
    expect(bank.institutionId).toBe('b1');
    expect(bank.total).toBe(bank.holdings.reduce((t, x) => t + (x.amount ?? 0), 0));
    expect(card('f-sample')).toMatchObject({ name: 'Sample Mutual Fund', total: 100_000 });
    expect(card('i-sample-life')).toMatchObject({ total: null, helpline: null });
    expect(card('i-sample-life').holdings[0]!.nominee).toBeNull();
  });

  it('re-groups the steps into a first week, 30 days and 90 days, with the family’s names', () => {
    expect(g.timeline.map((p) => p.id)).toEqual(['week', 'month', 'quarter']);
    const say = (id: string) => g.timeline.flatMap((p) => p.steps).find((s) => s.id === id)!.text;
    expect(hbSay(say('t:week:will'))).toContain('the green folder');
    expect(hbSay(say('t:week:guardian'))).toContain('Child');
    expect(hbSay(say('t:week:insurers'))).toContain('Sample Life');
    expect(hbSay(say('t:month:banks'))).toContain('Sample Bank');
    expect(say('t:month:funds')).toBeDefined();
    // every tick key is unique and one the server accepts
    const ids = g.timeline.flatMap((p) => p.steps.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(STEP_KEY);
  });

  it('leaves out steps that do not apply', () => {
    const none = buildHandbook(input({ banks: [], funds: [], policies: [] })).guide!;
    const ids = none.timeline.flatMap((p) => p.steps.map((s) => s.id));
    expect(ids).not.toContain('t:month:banks');
    expect(ids).not.toContain('t:month:funds');
    expect(hbSay(none.timeline[0]!.steps.find((s) => s.id === 't:week:insurers')!.text)).toContain(
      'not listed here',
    );
  });

  it('sums what the family has for the start card', () => {
    expect(g.totals).toEqual({ money: g.totals.money, banks: 1, funds: 1, policies: 1 });
    expect(g.totals.money).toBeGreaterThan(600_000);
    const line = hbSay(hbT('start.have', { total: g.totals.money, ...g.totals }));
    expect(line).toMatch(/^About ₹\d/);
    expect(line).toContain('1 bank, 1 fund and 1 insurance policy');
  });

  it('lists what keeps moving: monthly investments and deposits maturing within the year', () => {
    expect(g.moving.sipCount).toBe(1);
    expect(g.moving.sipMonthly).toBe(10_000);
    expect(g.moving.maturing[0]).toMatchObject({ on: '2027-01-01', bank: 'Sample Bank' });
    expect(g.moving.renewals).toEqual([{ insurer: 'Sample Life', on: '2027-02-01' }]);
    expect(g.property).toEqual([{ owner: 'Parent', label: 'Flat', amount: 2_500_000, note: null }]);
    expect(g.owed).toEqual([{ counterparty: 'A friend', outstanding: 7000, expectedOn: null }]);
  });

  it('keeps the family’s own words and where things are, empty when not written down', () => {
    expect(g.where.find((w) => w.id === 'will')!.value).toBe('the green folder');
    expect(g.where.find((w) => w.id === 'passwords')!.value).toBe('');
    expect(g.contacts[0]!.name).toBe('Uncle');
  });
});

describe('fund houses', () => {
  it('uses the official AMC name when there is one, else the words before the kind of fund', () => {
    expect(fundHouseOf('Anything', 'SBI Funds Management Ltd')).toBe('SBI');
    expect(fundHouseOf('Parag Parikh Flexi Cap Fund - Direct Plan - Growth')).toBe('Parag Parikh');
    expect(fundHouseOf('Mirae Asset Large Cap Fund')).toBe('Mirae Asset');
    expect(fundHouseOf('HDFC Mid-Cap Opportunities Fund')).toBe('HDFC');
    expect(fundHouseOf('ICICI Prudential Bluechip Fund')).toBe('ICICI Prudential');
    expect(fundHouseOf('Nippon India Small Cap Fund')).toBe('Nippon India');
    expect(fundHouseOf('UTI Nifty 50 Index Fund')).toBe('UTI');
  });
  it('groups funds of one house on one card', () => {
    const g = buildGuide(
      input({
        funds: [
          {
            owner: 'Parent',
            fund: 'Alpha Flexi Cap',
            value: 10,
            invested: 5,
            sipMonthly: null,
            sipStopped: false,
          },
          {
            owner: 'Child',
            fund: 'Alpha Small Cap',
            value: 30,
            invested: 5,
            sipMonthly: 500,
            sipStopped: true,
            nominee: 'Parent',
          },
          {
            owner: 'Parent',
            fund: 'Beta Liquid',
            value: 20,
            invested: 5,
            sipMonthly: null,
            sipStopped: false,
          },
        ],
      }),
    );
    const f = g.cards.filter((c) => c.kind === 'funds');
    expect(f.map((c) => [c.name, c.total])).toEqual([
      ['Alpha Mutual Fund', 40],
      ['Beta Mutual Fund', 20],
    ]);
    expect(f[0]!.holdings.map((h) => h.label)).toEqual(['Alpha Small Cap', 'Alpha Flexi Cap']);
    expect(hbSay(f[0]!.holdings[0]!.detail!)).toBe('SIP stopped');
    expect(f[0]!.holdings[0]!.nominee).toBe('Parent');
  });
});

describe('claim checklists', () => {
  it('has a list of papers for each kind of place, with stable ids', () => {
    for (const kind of ['bank', 'funds', 'insurer'] as const) {
      const ids = CLAIM_CHECKLISTS[kind].map((x) => x.id);
      expect(ids.length).toBeGreaterThanOrEqual(5);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids).toContain('death-cert');
      for (const id of ids) expect(claimKey('b-1234-abcd', id)).toMatch(STEP_KEY);
    }
    expect(CLAIM_CHECKLISTS.funds.map((x) => x.id)).toContain('transmission-form');
    expect(CLAIM_CHECKLISTS.insurer.map((x) => x.id)).toContain('policy-doc');
  });
  it('accepts only tick keys of the handbook', () => {
    expect(STEP_KEY.test('t:week:certificates')).toBe(true);
    expect(STEP_KEY.test('c:b-6f1c2a9e-0000-4000-8000-000000000000:death-cert')).toBe(true);
    expect(STEP_KEY.test('x:week:certificates')).toBe(false);
    expect(STEP_KEY.test("t:week:'; drop")).toBe(false);
  });
  it('counts what is done in a group', () => {
    expect(doneCount(['a', 'b', 'c'], new Set(['b', 'z']))).toEqual({ done: 1, total: 3 });
  });
});

describe('what is missing', () => {
  it('counts nominees, helplines and places not written down, and how complete the handbook is', () => {
    const r = handbookGaps(buildGuide(input()));
    const ids = r.open.map((x) => x.id);
    expect(ids).toContain('nomineeAccounts');
    expect(ids).toContain('nomineeFunds');
    expect(ids).toContain('nomineePolicies');
    expect(ids).toContain('where');
    expect(ids).toContain('message');
    expect(ids).not.toContain('will');
    expect(ids).not.toContain('contacts');
    expect(ids).not.toContain('helpline');
    const acc = r.open.find((x) => x.id === 'nomineeAccounts')!;
    expect(acc).toMatchObject({ missing: 1, of: 2, href: '/accounts' });
    expect(hbSay(acc.text)).toBe('1 account or deposit has no nominee recorded');
    expect(r.percent).toBeGreaterThan(0);
    expect(r.percent).toBeLessThan(100);
  });
  it('says no one to call, no will and no helpline when nothing is written down', () => {
    const r = handbookGaps(
      buildGuide(input({ profile: EMPTY_PROFILE, institutions: [], nominees: {} })),
    );
    const ids = r.open.map((x) => x.id);
    expect(ids).toEqual(expect.arrayContaining(['contacts', 'will', 'helpline']));
    expect(hbSay(r.open.find((x) => x.id === 'will')!.text)).toBe(
      'Where is the will? Not written down yet',
    );
  });
  it('is 100% when everything is filled in', () => {
    const full = {
      ...input().profile,
      message: 'Hello',
      passwordManager: 'x',
      documentsLocation: 'x',
      lockerDetails: 'x',
      devices: 'x',
      emailAccounts: 'x',
      backupKeyLocation: 'x',
      nominees: 'x',
    };
    const g = buildGuide(
      input({
        profile: full,
        nominees: { s: 'A', f: 'A' },
        funds: [],
        policies: [],
      }),
    );
    expect(handbookGaps(g)).toEqual({ open: [], percent: 100 });
  });
});

describe('profile helpers', () => {
  it('reads saved profiles defensively', () => {
    expect(profileFromJson(null)).toEqual(EMPTY_PROFILE);
    expect(profileFromJson({ willLocation: 5, contacts: 'x' })).toEqual(EMPTY_PROFILE);
  });
  it('parses and prints contact lines', () => {
    const c = parseContactLines('Uncle | brother | +65 1 | call first\n\n | no name | 1\nLawyer');
    expect(c).toEqual([
      { name: 'Uncle', relation: 'brother', phone: '+65 1', note: 'call first' },
      { name: 'Lawyer', relation: '', phone: '', note: '' },
    ]);
    expect(parseContactLines(contactLines(c))).toEqual(c);
  });
});
