import {
  buildBankBlocks,
  buildPortfolio,
  EMPTY_PROFILE,
  type AssetRow,
  type FdRow,
  type HandbookInput,
  type ObservationRow,
} from '@fwos/core';

/**
 * The invented family of the public handbook sample (/demo/emergency): three banks, two fund houses, two insurers, a flat and a
 * small loan to a cousin. No real names, numbers or amounts; phone numbers are placeholders.
 */
const TODAY = new Date('2026-10-26T00:00:00Z');
const OWNERS = { a: 'Asha', v: 'Vikram', k: 'Kiran' };

const account = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'a',
  type: 'bank_account',
  status: 'active',
  nickname: o.id,
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  ...o,
});
const balance = (asset: string, amount: number): ObservationRow => ({
  id: `o-${asset}`,
  asset_id: asset,
  kind: 'balance',
  amount,
  currency: 'INR',
  fx_rate: null,
  as_of: '2026-10-20',
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: '2026-10-20T00:00:00Z',
  superseded_by: null,
});

const ASSETS: AssetRow[] = [
  account({ id: 'hb-s1', institution_id: 'bank-h', identifier_last4: '4411', sort_order: 1 }),
  account({
    id: 'hb-f1',
    type: 'fixed_deposit',
    institution_id: 'bank-h',
    linked_last4: '4411',
    sort_order: 2,
  }),
  account({
    id: 'hb-s2',
    owner_id: 'v',
    account_kind: 'NRO',
    institution_id: 'bank-l',
    identifier_last4: '7302',
    sort_order: 3,
    notes: 'Rent from the flat comes in here',
  }),
  account({
    id: 'hb-s3',
    institution_id: 'bank-r',
    identifier_last4: '5520',
    is_joint: true,
    sort_order: 4,
  }),
];
const OBS: ObservationRow[] = [
  balance('hb-s1', 320_000),
  balance('hb-s2', 115_000),
  balance('hb-s3', 640_000),
];
const FDS: FdRow[] = [
  {
    asset_id: 'hb-f1',
    principal: 1_000_000,
    rate: 0.0725,
    booked_on: '2026-02-01',
    maturity_on: '2027-02-01',
    compounding: 'quarterly',
    bank_maturity_amount: null,
    fd_ref_last4: '8820',
  },
];

export function demoHandbookInput(filledIn = true): HandbookInput {
  const banks = buildBankBlocks({
    assets: ASSETS,
    observations: OBS,
    fds: FDS,
    portfolio: buildPortfolio(ASSETS, OBS, FDS, TODAY),
    institutionNames: {
      'bank-h': 'Sample Harbour Bank',
      'bank-l': 'Sample Lotus Bank',
      'bank-r': 'Sample River Bank',
    },
    today: TODAY,
  });
  return {
    asOf: '2026-10-26',
    householdName: 'Sample family',
    people: [
      {
        name: 'Asha',
        dob: '1982-03-14',
        isMinor: false,
        guardian: null,
        panLast4: '4321',
        residency: 'NRI',
      },
      {
        name: 'Vikram',
        dob: '1980-11-02',
        isMinor: false,
        guardian: null,
        panLast4: '8765',
        residency: 'NRI',
      },
      {
        name: 'Kiran',
        dob: '2013-06-20',
        isMinor: true,
        guardian: 'Asha',
        panLast4: null,
        residency: null,
      },
    ],
    profile: filledIn
      ? {
          ...EMPTY_PROFILE,
          message:
            'We made this so you are never left wondering what to do. Take your time, lean on each other, and call Ravi first.',
          contacts: [
            {
              name: 'Ravi Menon',
              relation: 'my brother',
              phone: '+65 9000 0000',
              note: 'knows where the papers are',
            },
            {
              name: 'Meera Iyer',
              relation: 'my sister',
              phone: '+91 98100 00000',
              note: 'lives in Delhi',
            },
          ],
          advisors: [
            {
              name: 'Rao & Co',
              relation: 'lawyer',
              phone: '+65 6000 0000',
              note: 'holds a copy of the will',
            },
          ],
          willLocation: 'Fireproof box in the study; a copy with Rao & Co.',
          documentsLocation: 'Blue folder in the study',
          passwordManager: 'Family password manager; Ravi has the emergency sheet.',
        }
      : EMPTY_PROFILE,
    banks,
    ownerName: OWNERS,
    funds: [
      {
        owner: 'Asha',
        fund: 'Sample Alpha Flexi Cap Fund',
        value: 840_000,
        invested: 600_000,
        sipMonthly: 15_000,
        sipStopped: false,
        nominee: filledIn ? 'Vikram, 100%' : null,
      },
      {
        owner: 'Vikram',
        fund: 'Sample Alpha Small Cap Fund',
        value: 310_000,
        invested: 250_000,
        sipMonthly: 10_000,
        sipStopped: true,
        nominee: null,
      },
      {
        owner: 'Asha',
        fund: 'Sample Beta Large Cap Fund',
        value: 560_000,
        invested: 420_000,
        sipMonthly: null,
        sipStopped: false,
        nominee: filledIn ? 'Kiran (Asha as guardian)' : null,
      },
      {
        owner: 'Kiran',
        fund: 'Sample Beta Liquid Fund',
        value: 90_000,
        invested: 85_000,
        sipMonthly: null,
        sipStopped: false,
        nominee: filledIn ? 'Asha' : null,
      },
    ],
    heldByOthers: [],
    policies: [
      {
        kind: 'term',
        insurer: 'Sample Shield Life',
        coverage: 'Term cover until 2045',
        insured: ['Vikram'],
        paidBy: 'Vikram',
        renewalOn: '2027-03-15',
        expiresOn: null,
        nominee: filledIn ? 'Asha' : null,
        documents: 'Blue folder in the study',
      },
      {
        kind: 'health_in',
        insurer: 'Sample Care Health',
        coverage: 'Family floater',
        insured: ['Asha', 'Vikram', 'Kiran'],
        paidBy: 'Asha',
        renewalOn: '2027-01-10',
        expiresOn: null,
        nominee: null,
        documents: null,
      },
    ],
    property: [
      {
        owner: 'Asha',
        label: 'Flat in Pune',
        value: 8_500_000,
        note: 'Registered papers in the bank locker',
      },
    ],
    owedToUs: [{ counterparty: 'A cousin', outstanding: 50_000, expectedOn: '2027-04-01' }],
    nominees: filledIn ? { 'hb-s1': 'Vikram, 100%', 'hb-s3': 'Kiran (Asha as guardian)' } : {},
    institutions: [
      { id: 'bank-h', name: 'Sample Harbour Bank', helpline: filledIn ? '1800 000 1111' : null },
      { id: 'bank-l', name: 'Sample Lotus Bank', helpline: null },
      {
        id: 'bank-r',
        name: 'Sample River Bank',
        helpline: filledIn ? '+91 22 0000 0000' : null,
      },
      {
        id: 'ins-s',
        name: 'Sample Shield Life',
        helpline: filledIn ? '1800 000 2222' : null,
      },
    ],
  };
}
