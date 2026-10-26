import { describe, expect, it } from 'vitest';
import { buildBankBlocks } from '../src/accounts-view';
import {
  buildHandbook,
  contactLines,
  EMPTY_PROFILE,
  parseContactLines,
  profileFromJson,
  type HandbookInput,
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
  ...o,
});

describe('buildHandbook', () => {
  const h = buildHandbook(input());
  const text = JSON.stringify(h);
  const sec = (id: string) => h.sections.find((s) => s.id === id)!;

  it('has the sections a family member needs, in order, starting with what to read first', () => {
    expect(h.sections.map((s) => s.id)).toEqual([
      'start',
      'people',
      'call',
      'summary',
      'banks',
      'investments',
      'insurance',
      'property',
      'automatic',
      'next',
      'children',
    ]);
    expect(sec('start').steps!.length).toBeGreaterThanOrEqual(5);
  });

  it('says plainly that it is general guidance and that figures are estimates', () => {
    expect(h.disclaimer).toContain('not legal or tax advice');
    expect(sec('summary').intro).toContain('estimates');
  });

  it('shows each person with age, guardian and only the last four of the PAN', () => {
    const rows = sec('people').tables![0]!.table.rows;
    expect(rows[0]!).toEqual(['Parent', '46', '–', '…234F', 'NRI']);
    expect(rows[1]![0]!).toBe('Child (child)');
    expect(rows[1]![2]!).toBe('Parent');
    expect(text).not.toMatch(/[A-Z]{5}[0-9]{4}[A-Z]/);
  });

  it('lists every account with its code, today’s value, the FD terms and the notes', () => {
    const t = sec('banks').tables![0]!.table;
    expect(t.rows.length).toBe(2);
    const fd = t.rows.find((r) => r[1]!.startsWith('FD'))!;
    expect(fd[3]).toContain('8%');
    expect(fd[3]).toContain('FD number ends 4321');
    expect(t.rows.find((r) => r[1]!.startsWith('Cash'))![4]).toBe('AMB 10K');
  });

  it('is honest about what is missing instead of leaving blanks', () => {
    const empty = buildHandbook(input({ profile: EMPTY_PROFILE }));
    expect(JSON.stringify(empty)).toContain('not recorded');
    expect(empty.sections.find((s) => s.id === 'call')!.paragraphs![0]).toContain(
      'No contacts have been entered',
    );
  });

  it('turns the records into a personal, ordered to-do list with the names of banks, insurers and the guardian', () => {
    const steps = sec('next').steps!.join('\n');
    expect(steps).toContain('Sample Life');
    expect(steps).toContain('Sample Bank');
    expect(steps).toContain('green folder');
    expect(steps).toContain('Child');
    expect(steps.indexOf('FIRST DAYS')).toBeLessThan(steps.indexOf('FIRST MONTH'));
    expect(steps.indexOf('FIRST MONTH')).toBeLessThan(steps.indexOf('MONTHS 2 TO 6'));
  });

  it('lists what keeps moving: monthly investments and deposits maturing within the year', () => {
    const a = sec('automatic');
    expect(a.paragraphs![0]).toContain('1 totalling');
    expect(a.tables![0]!.table.rows[0]![0]).toContain('January 2027');
  });

  it('has a short plain-language section for children', () => {
    expect(sec('children').paragraphs!.join(' ')).toContain('Parent');
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
