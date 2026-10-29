import { describe, expect, it } from 'vitest';
import { mergeSavingsTxns, sipDebits } from '../src/sip-debits';
import { savingsOn } from '../src/savings-accrual';

const plan = { monthly: 5000, startedOn: '2026-07-05', stopped: false };

describe('sipDebits: a SIP takes its instalments out of the account it is paid from', () => {
  it('one debit on each instalment date up to today', () => {
    const d = sipDebits([{ fundId: 'f', accountId: 'acc', plan }], [], '2026-10-29');
    expect(d.acc).toEqual([
      { date: '2026-07-05', amount: -5000 },
      { date: '2026-08-05', amount: -5000 },
      { date: '2026-09-05', amount: -5000 },
      { date: '2026-10-05', amount: -5000 },
    ]);
  });

  it('follows the dated history: a raise, and a pause with nothing taken while it runs', () => {
    const d = sipDebits(
      [
        {
          fundId: 'f',
          accountId: 'acc',
          plan: {
            ...plan,
            changes: [
              { from: '2026-07-05', monthly: 5000 },
              { from: '2026-08-01', monthly: 8000 },
              { from: '2026-09-01', monthly: 0 },
              { from: '2026-10-01', monthly: 8000 },
            ],
          },
        },
      ],
      [],
      '2026-10-29',
    );
    expect(d.acc!.map((x) => [x.date, x.amount])).toEqual([
      ['2026-07-05', -5000],
      ['2026-08-05', -8000],
      ['2026-10-05', -8000],
    ]);
  });

  it('a stopped SIP with no history takes nothing', () => {
    expect(
      sipDebits(
        [{ fundId: 'f', accountId: 'acc', plan: { ...plan, stopped: true } }],
        [],
        '2026-10-29',
      ),
    ).toEqual({});
  });

  it('an instalment already on a bank statement (a recorded movement into the fund) is not taken twice', () => {
    const d = sipDebits(
      [{ fundId: 'f', accountId: 'acc', plan }],
      [
        { date: '2026-08-06', amount: 5000, fromAssetId: 'acc', toAssetId: 'f' },
        // a movement to something else is not the instalment
        { date: '2026-09-05', amount: 5000, fromAssetId: 'acc', toAssetId: 'other' },
      ],
      '2026-10-29',
    );
    expect(d.acc!.map((x) => x.date)).toEqual(['2026-07-05', '2026-09-05', '2026-10-05']);
  });

  it('the savings estimate takes off only the instalments after its last recorded balance', () => {
    const debits = sipDebits([{ fundId: 'f', accountId: 'acc', plan }], [], '2026-10-29');
    const moves = mergeSavingsTxns({ acc: [{ date: '2026-09-20', amount: 1000 }] }, debits);
    const terms = {
      schedule: [
        {
          from: '0000-01-01',
          slabs: [{ upTo: null, rate: 0 }],
          method: 'whole' as const,
          source: 'assumed' as const,
        },
      ],
      tds: 0,
      credit: 'quarterly' as const,
    };
    // the balance recorded on 15 Sep already has the July, August and September instalments in it
    const s = savingsOn({ date: '2026-09-15', amount: 100_000 }, moves.acc!, terms, '2026-10-29');
    expect(s.balance).toBe(100_000 + 1000 - 5000);
  });
});
