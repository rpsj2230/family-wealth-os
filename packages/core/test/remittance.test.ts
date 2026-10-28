import { describe, expect, it } from 'vitest';
import { remittanceDestinations, type DestinationAccount } from '../src/remittance';

// Invented accounts and amounts.
const yes: DestinationAccount = {
  assetId: 'yes',
  ownerId: 'r',
  institutionId: 'Y',
  openedAfter: null,
};
const idfc: DestinationAccount = {
  assetId: 'idfc',
  ownerId: 'r',
  institutionId: 'I',
  openedAfter: null,
};
const equitas: DestinationAccount = {
  assetId: 'eq',
  ownerId: 'r',
  institutionId: 'E',
  openedAfter: '2021-07-20',
};
const accounts = [yes, idfc, equitas];
const bal = (assetId: string, date: string, amount: number) => ({ assetId, date, amount });

describe('which account a transfer from Singapore reached', () => {
  it('the account whose balance rose by it between the records around the day', () => {
    const [d] = remittanceDestinations({
      transfers: [{ id: 't', date: '2020-11-19', amount: 1_100_000 }],
      accounts,
      balances: [
        bal('yes', '2020-11-01', 990),
        bal('yes', '2021-01-30', 2_025),
        bal('idfc', '2020-11-01', 434_577),
        bal('idfc', '2021-01-30', 1_708_571),
      ],
      deposits: [],
    });
    expect([d!.assetId, d!.basis]).toEqual(['idfc', 'balances']);
  });

  it('counts a deposit booked at the same bank in between, and two transfers cannot share one rise', () => {
    const ds = remittanceDestinations({
      transfers: [
        { id: 'a', date: '2020-11-19', amount: 1_100_000 },
        { id: 'b', date: '2020-12-30', amount: 1_100_000 },
      ],
      accounts,
      balances: [
        bal('yes', '2020-11-01', 990),
        bal('yes', '2021-01-30', 1_200_000),
        bal('idfc', '2020-11-01', 434_577),
        bal('idfc', '2021-01-30', 534_577),
      ],
      // 10 lakh went into a deposit at IDFC in December: IDFC took in 11 lakh in all
      deposits: [
        { ownerId: 'r', institutionId: 'I', bookedOn: '2020-12-29', principal: 1_000_000 },
      ],
    });
    expect(ds.map((d) => d.assetId).sort()).toEqual(['idfc', 'yes']);
  });

  it('an account not open yet is never chosen; the only one open is', () => {
    const [d] = remittanceDestinations({
      transfers: [{ id: 't', date: '2018-05-14', amount: 500_000 }],
      accounts: [yes, { ...idfc, openedAfter: '2019-01-01' }, equitas],
      balances: [],
      deposits: [],
    });
    expect([d!.assetId, d!.basis]).toEqual(['yes', 'only_open']);
  });

  it('an account whose statements do not show it is ruled out', () => {
    const [d] = remittanceDestinations({
      transfers: [{ id: 't', date: '2019-02-20', amount: 366_869 }],
      accounts: [yes, idfc, equitas],
      balances: [],
      deposits: [],
      ruledOut: (_t, a) => a === 'yes',
    });
    expect([d!.assetId, d!.basis]).toEqual(['idfc', 'only_open']);
  });

  it('leaves it open when no balance shows it, and names the accounts it could be', () => {
    const [d] = remittanceDestinations({
      transfers: [{ id: 't', date: '2021-04-19', amount: 1_117_973 }],
      accounts,
      balances: [
        bal('yes', '2021-04-05', 712_025),
        bal('yes', '2021-06-20', 529),
        bal('idfc', '2021-04-05', 25_300),
        bal('idfc', '2021-06-20', 25_300),
      ],
      deposits: [],
    });
    expect(d!.assetId).toBeNull();
    expect(d!.alternatives.sort()).toEqual(['idfc', 'yes']);
  });
});
