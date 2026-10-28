import { describe, expect, it } from 'vitest';
import { attachProceeds } from '../src/position-build';
import { reconcileQueue } from '../src/reconcile';
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
