import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  positionConfig,
  type PositionAsset,
  type PositionInput,
  type SnapshotPayload,
} from '@fwos/core';
import { runRebuild, type RebuildIo } from '../src/snapshots';

const TODAY = '2026-10-27';

const rec = (date: string, amount: number) => ({
  date,
  amount,
  currency: 'INR',
  fxRate: null,
});

const asset = (
  over: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'o1',
  status: 'active',
  name: over.assetId,
  currency: 'INR',
  rate: { own: 0, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  ...over,
});

/** A savings account recorded in Jan, Mar and Jun 2026, and a deposit booked in Feb 2026. */
const input = (): PositionInput => ({
  config: positionConfig(DEFAULT_CONFIG, TODAY),
  assets: [
    asset({
      assetId: 's',
      type: 'bank_account',
      records: [rec('2026-01-10', 100_000), rec('2026-03-20', 120_000), rec('2026-06-15', 90_000)],
    }),
    asset({
      assetId: 'd',
      type: 'fixed_deposit',
      fd: {
        principal: 200_000,
        rate: 0.07,
        bookedOn: '2026-02-05',
        maturityOn: '2027-02-05',
        compounding: 'quarterly',
        bankMaturityAmount: null,
        endedOn: null,
      },
    }),
  ],
});

/** A fake store that behaves like the database function: a day recorded on the day is never overwritten. */
function fakeStore(initial: { takenOn: string; source: string; total?: number }[] = []) {
  const rows = new Map(initial.map((r) => [r.takenOn, { source: r.source, total: r.total ?? 0 }]));
  const io: RebuildIo = {
    position: async () => input(),
    existing: async () => [...rows].map(([takenOn, r]) => ({ takenOn, source: r.source })),
    save: async (payloads: SnapshotPayload[]) => {
      let n = 0;
      for (const p of payloads) {
        const cur = rows.get(p.takenOn);
        if (cur && cur.source !== 'rebuilt') continue;
        rows.set(p.takenOn, { source: 'rebuilt', total: p.total });
        n++;
      }
      return n;
    },
  };
  return { rows, io };
}

describe('rebuilding the net-worth history', () => {
  it('stores a point for every month end the records reach back to, before today', async () => {
    const s = fakeStore();
    const r = await runRebuild(s.io);
    expect(r.ok).toBe(true);
    expect(r.from).toBe('2026-01-10');
    // January to September: nine month ends; the 31 October month end is after today
    expect([...s.rows.keys()]).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
      '2026-05-31',
      '2026-06-30',
      '2026-07-31',
      '2026-08-31',
      '2026-09-30',
    ]);
    expect(r.written).toBe(9);
    expect([...s.rows.values()].every((x) => x.source === 'rebuilt')).toBe(true);
    // a month before the data starts has no point and no made-up figure
    expect(s.rows.has('2025-12-31')).toBe(false);
    // January: only the account; February: the account and the deposit just booked
    expect(s.rows.get('2026-01-31')!.total).toBeCloseTo(100_000, 2);
    expect(s.rows.get('2026-02-28')!.total).toBeGreaterThan(300_000);
  });

  it('is idempotent: a second run leaves the same rows', async () => {
    const s = fakeStore();
    await runRebuild(s.io);
    const before = JSON.stringify([...s.rows]);
    const again = await runRebuild(s.io);
    expect(again.ok).toBe(true);
    expect(JSON.stringify([...s.rows])).toBe(before);
    expect(s.rows.size).toBe(9);
  });

  it('never replaces a point recorded on the day, and says it kept it', async () => {
    const s = fakeStore([
      { takenOn: '2026-03-31', source: 'monthly_update', total: 999 },
      { takenOn: '2026-04-30', source: 'daily', total: 888 },
    ]);
    const r = await runRebuild(s.io);
    expect(r.keptRecorded).toBe(2);
    expect(r.written).toBe(7);
    expect(s.rows.get('2026-03-31')).toEqual({ source: 'monthly_update', total: 999 });
    expect(s.rows.get('2026-04-30')).toEqual({ source: 'daily', total: 888 });
  });

  it('never deletes: older rebuilt rows and rows outside the plan stay', async () => {
    const s = fakeStore([{ takenOn: '2020-01-31', source: 'rebuilt', total: 1 }]);
    await runRebuild(s.io);
    expect(s.rows.get('2020-01-31')).toEqual({ source: 'rebuilt', total: 1 });
  });

  it('says what happened when there is nothing to rebuild, and does not fail on an error', async () => {
    const none = await runRebuild({ ...fakeStore().io, position: async () => null });
    expect(none).toMatchObject({ ok: true, written: 0, planned: 0 });
    const bad = await runRebuild({
      ...fakeStore().io,
      save: async () => {
        throw new Error('database unavailable');
      },
    });
    expect(bad.ok).toBe(false);
    expect(bad.error).toBe('database unavailable');
  });
});
