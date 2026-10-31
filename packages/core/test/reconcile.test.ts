import { describe, expect, it } from 'vitest';
import { attachProceeds } from '../src/position-build';
import { linesExplain, reconcileQueue } from '../src/reconcile';
import type { PositionAsset, PositionConfig } from '../src/position';

const TODAY = '2026-10-28';
const cfg: PositionConfig = {
  today: TODAY,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
};
const base = (
  o: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'r',
  status: 'active',
  name: o.assetId,
  currency: 'INR',
  rate: { own: 0.03, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  institutionId: 'b',
  ...o,
});
const rec = (date: string, amount: number) => ({ date, amount, currency: 'INR', fxRate: null });

describe('reconcileQueue (acceptance tests 4 and 16)', () => {
  const fd = base({
    assetId: 'fd',
    type: 'fixed_deposit',
    linkedLast4: '1234',
    fd: {
      principal: 1_000_000,
      rate: 0.07,
      bookedOn: '2025-10-10',
      maturityOn: '2026-10-10',
      compounding: 'simple',
      bankMaturityAmount: null,
      endedOn: null,
    },
  });
  const sav = base({
    assetId: 's',
    type: 'bank_account',
    last4: '1234',
    records: [rec('2026-09-01', 200_000)],
  });

  it('lists matured proceeds nobody placed, with the linked account suggested, never assigned', () => {
    const position = { assets: attachProceeds([fd, sav], cfg), config: cfg };
    const q = reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120 });
    expect(q.proceeds).toHaveLength(1);
    expect(q.proceeds[0]).toMatchObject({ assetId: 'fd', status: 'awaiting', outOn: '2026-10-11' });
    expect(q.proceeds[0]!.amount).toBeCloseTo(1_070_000, 0);
    expect(q.proceeds[0]!.suggestion?.assetId).toBe('s');
  });

  it('flags a balance that jumped, offering the matching proceeds first; an answered one is not asked again', () => {
    const jumped = { ...sav, records: [rec('2026-09-01', 200_000), rec('2026-10-20', 1_270_600)] };
    const position = { assets: attachProceeds([fd, { ...jumped }], cfg), config: cfg };
    // the later balance is evidence: the proceeds are probably in it, and still listed to confirm
    const q = reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120 });
    expect(q.proceeds[0]!.status).toBe('probably_placed');
    expect(q.balances).toHaveLength(1);
    expect(q.balances[0]!.difference).toBeGreaterThan(1_060_000);
    expect(q.balances[0]!.suggestions[0]).toMatchObject({ kind: 'fd_proceeds', assetId: 'fd' });
    const after = reconcileQueue({
      position,
      moves: [
        {
          movedOn: '2026-10-20',
          amount: 1,
          kind: 'fd_proceeds',
          fromAssetId: 'fd',
          toAssetId: 's',
          status: 'confirmed',
          idemKey: 'recon:s:2026-10-20',
        },
      ],
      tolerance: 500,
      sinceDays: 120,
    });
    expect(after.balances).toHaveLength(0);
  });

  it('asks where a new deposit came from, unless a movement or a renewal says so', () => {
    const fresh = base({
      assetId: 'new',
      type: 'fixed_deposit',
      fd: {
        principal: 300_000,
        rate: 0.07,
        bookedOn: '2026-10-01',
        maturityOn: '2027-10-01',
        compounding: 'quarterly',
        bankMaturityAmount: null,
        endedOn: null,
      },
    });
    const position = { assets: attachProceeds([fresh, sav], cfg), config: cfg };
    expect(
      reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120 }).funding[0],
    ).toMatchObject({
      assetId: 'new',
      suggestion: { assetId: 's' },
    });
    const done = reconcileQueue({
      position,
      moves: [
        {
          movedOn: '2026-10-01',
          amount: 300_000,
          kind: 'fd_funding',
          fromAssetId: 's',
          toAssetId: 'new',
          status: 'confirmed',
          idemKey: 'fund:new',
        },
      ],
      tolerance: 500,
      sinceDays: 120,
    });
    expect(done.funding).toHaveLength(0);
  });
});

describe('reconcileQueue: transfers between the family’s own accounts are paired', () => {
  const position = (assets: PositionAsset[]) => ({ assets, config: cfg });
  // RTGS from one bank to another on 28 Oct: one account falls, the other rises by the same sum
  const rbl = base({
    assetId: 'rbl',
    type: 'bank_account',
    name: 'RBL savings',
    institutionId: 'rblbank',
    records: [rec('2026-10-01', 556_750.05), rec('2026-10-28', 0.05)],
  });
  const yes = base({
    assetId: 'yes',
    type: 'bank_account',
    name: 'YES savings',
    institutionId: 'yesbank',
    records: [rec('2026-10-01', 256.53), rec('2026-10-28', 557_006.53)],
  });
  const queue = (moves: Parameters<typeof reconcileQueue>[0]['moves'] = []) =>
    reconcileQueue({
      position: position([rbl, yes]),
      moves,
      tolerance: 500,
      sinceDays: 120,
      pairDays: 3,
    });

  it('offers the fall and the rise as one transfer, already chosen, on both sides', () => {
    const q = queue();
    const up = q.balances.find((b) => b.assetId === 'yes')!;
    const down = q.balances.find((b) => b.assetId === 'rbl')!;
    expect(up.pair).toMatchObject({ assetId: 'rbl' });
    expect(down.pair).toMatchObject({ assetId: 'yes' });
    expect(up.suggestions[0]).toMatchObject({ kind: 'transfer', assetId: 'rbl' });
    expect(down.suggestions[0]).toMatchObject({ kind: 'transfer', assetId: 'yes' });
  });

  it('answering one side clears both', () => {
    const q = queue([
      {
        movedOn: '2026-10-28',
        amount: 556_750,
        kind: 'transfer',
        fromAssetId: 'rbl',
        toAssetId: 'yes',
        status: 'confirmed',
        idemKey: 'recon:yes:2026-10-28',
      },
    ]);
    expect(q.balances).toHaveLength(0);
  });

  it('does not pair sums that differ, or changes too far apart', () => {
    const far = base({
      ...yes,
      assetId: 'far',
      records: [rec('2026-09-01', 256.53), rec('2026-09-20', 557_006.53)],
    });
    const odd = base({
      ...yes,
      assetId: 'odd',
      records: [rec('2026-10-01', 256.53), rec('2026-10-28', 300_000)],
    });
    const q = reconcileQueue({
      position: position([rbl, far, odd]),
      moves: [],
      tolerance: 500,
      sinceDays: 120,
      pairDays: 3,
    });
    expect(q.balances.every((b) => !b.pair)).toBe(true);
  });

  it('a fall that matches a new deposit booked within the window is offered as its funding', () => {
    const fdNew = base({
      assetId: 'fd-new',
      type: 'fixed_deposit',
      name: 'New deposit',
      institutionId: 'rblbank',
      fd: {
        principal: 556_750,
        rate: 0.07,
        bookedOn: '2026-10-27',
        maturityOn: '2027-10-27',
        compounding: 'quarterly',
        bankMaturityAmount: null,
        endedOn: null,
      },
    });
    const q = reconcileQueue({
      position: position([rbl, fdNew]),
      moves: [],
      tolerance: 500,
      sinceDays: 120,
      pairDays: 3,
    });
    const fall = q.balances.find((b) => b.assetId === 'rbl')!;
    expect(fall.suggestions[0]).toMatchObject({ kind: 'fd_funding', assetId: 'fd-new' });
    expect(q.funding[0]!.suggestion).toMatchObject({ assetId: 'rbl' });
    expect(q.funding[0]!.suggestion!.why).toContain('the same sum left RBL savings');
  });
});

describe('reconcileQueue: a balance change the bank’s own lines account for is not asked about', () => {
  // Equitas NRE: ₹0 on 26 Oct, ₹10,06,687 on 28 Oct; the bank's line: a transfer in of exactly that sum
  const acct = base({
    assetId: 'eq',
    type: 'bank_account',
    records: [rec('2026-10-26', 0), rec('2026-10-28', 1_006_687)],
  });
  // a savings account: ₹5,00,000 on 30 Sep, ₹4,84,758 on 6 Oct; lines: interest +6,915 and TDS −2,157 on 1 Oct, two fund SIPs on 5 Oct
  const sav = base({
    assetId: 'sv',
    type: 'bank_account',
    records: [rec('2026-09-30', 500_000), rec('2026-10-06', 484_758)],
  });
  const position = { assets: [acct, sav], config: cfg };
  const lines = [
    { assetId: 'eq', date: '2026-10-28', amount: 1_006_687 },
    { assetId: 'sv', date: '2026-10-01', amount: 6_915 },
    { assetId: 'sv', date: '2026-10-01', amount: -2_157 },
    { assetId: 'sv', date: '2026-10-05', amount: -10_000 },
    { assetId: 'sv', date: '2026-10-05', amount: -10_000 },
  ];

  it('without the lines, both changes are asked about', () => {
    const q = reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120 });
    expect(q.balances.map((b) => b.assetId).sort()).toEqual(['eq', 'sv']);
  });

  it('with the lines, neither is', () => {
    const q = reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120, lines });
    expect(q.balances).toEqual([]);
  });

  it('lines that do not add up to the change leave it asked', () => {
    const q = reconcileQueue({
      position,
      moves: [],
      tolerance: 500,
      sinceDays: 120,
      lines: lines.filter((l) => l.date !== '2026-10-05' || l.amount !== -10_000).slice(0, 3),
    });
    expect(q.balances.map((b) => b.assetId)).toEqual(['sv']);
  });
});

describe('linesExplain', () => {
  it('takes a balance before or after the lines of its own day', () => {
    const ls = [{ date: '2026-10-01', amount: 100 }];
    // the first balance was taken before the day's line
    expect(
      linesExplain(
        ls,
        { date: '2026-10-01', amount: 1_000 },
        { date: '2026-10-03', amount: 1_100 },
        1,
      ),
    ).toBe(true);
    // or after it: then nothing moved between them, and no line inside proves nothing
    expect(
      linesExplain(
        ls,
        { date: '2026-10-01', amount: 1_100 },
        { date: '2026-10-03', amount: 1_100 },
        1,
      ),
    ).toBe(false);
    expect(linesExplain([], { date: 'a', amount: 0 }, { date: 'b', amount: 0 }, 1)).toBe(false);
  });
});

describe('reconcileQueue: a new deposit the bank lines show being paid for is not asked about', () => {
  const dep = (id: string, bank: string, owner: string) =>
    base({
      assetId: id,
      type: 'fixed_deposit',
      ownerId: owner,
      institutionId: bank,
      fd: {
        principal: 500_000,
        rate: 0.07,
        bookedOn: '2026-09-14',
        maturityOn: '2029-09-15',
        compounding: 'quarterly',
        bankMaturityAmount: null,
        endedOn: null,
      },
    });
  const acct = (id: string, bank: string, owner: string) =>
    base({ assetId: id, type: 'bank_account', ownerId: owner, institutionId: bank });
  const assets = [
    dep('yes-fd', 'yes', 'g'),
    dep('eq-fd1', 'eq', 'r'),
    dep('eq-fd2', 'eq', 'r'),
    dep('eq-fd3', 'eq', 'a'),
    acct('yes-sb', 'yes', 'g'),
    acct('eq-sb1', 'eq', 'r'),
    acct('eq-sb2', 'eq', 'r'),
  ];
  const position = { assets: attachProceeds(assets, cfg), config: cfg };
  const q = (lines: { assetId: string; date: string; amount: number }[]) =>
    reconcileQueue({ position, moves: [], tolerance: 500, sinceDays: 120, pairDays: 5, lines })
      .funding.map((f) => f.assetId)
      .sort();

  it('without lines, every deposit is asked about', () => {
    expect(q([])).toEqual(['eq-fd1', 'eq-fd2', 'eq-fd3', 'yes-fd']);
  });

  it('each line pays for one deposit only, so a third deposit of the same sum is still asked about', () => {
    expect(
      q([
        { assetId: 'yes-sb', date: '2026-09-14', amount: -500_000 },
        { assetId: 'eq-sb1', date: '2026-09-13', amount: -500_000 },
        { assetId: 'eq-sb2', date: '2026-09-14', amount: -500_000 },
      ]),
    ).toEqual(['eq-fd3']);
  });

  it('a line of another sum, or outside the pairing days, does not count', () => {
    expect(
      q([
        { assetId: 'yes-sb', date: '2026-09-14', amount: -400_000 },
        { assetId: 'eq-sb1', date: '2026-09-01', amount: -500_000 },
      ]),
    ).toEqual(['eq-fd1', 'eq-fd2', 'eq-fd3', 'yes-fd']);
  });
});
