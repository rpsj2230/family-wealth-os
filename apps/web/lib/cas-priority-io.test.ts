import { describe, expect, it } from 'vitest';
import { casIo } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The statement importer's database side, against a recording stand-in for the database: lines a statement replaces are set aside
 * through the database function (never deleted), a statement's own line brings an earlier set-aside copy back, an app export does
 * not, lines are stored under the source they came from, and what is read back leaves out the lines that were set aside.
 */
interface Rec {
  table?: string;
  ops: [string, unknown[]][];
}
function fakeDb(tables: Record<string, unknown[]> = {}) {
  const queries: Rec[] = [];
  const rpcs: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    from(table: string) {
      const rec: Rec = { table, ops: [] };
      queries.push(rec);
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop: string) {
            if (prop === 'then')
              return (ok: (v: unknown) => unknown) =>
                ok({ data: tables[table] ?? [], error: null });
            return (...args: unknown[]) => {
              rec.ops.push([prop, args]);
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      return { data: 1, error: null };
    },
  };
  return { db: db as unknown as SupabaseClient, queries, rpcs };
}
const opsOf = (q: Rec[], table: string, op: string) =>
  q.filter((r) => r.table === table).flatMap((r) => r.ops.filter(([o]) => o === op));

const line = (key: string) => ({
  key,
  date: '2026-01-05',
  kind: 'purchase',
  description: 'Purchase',
  amount: 1000,
  units: 10,
  nav: 100,
  balance: 10,
});
const save = (over: Record<string, unknown>) => ({
  assetId: 'a1',
  transactions: [],
  lineSource: 'cas' as const,
  replace: null,
  position: {},
  valuation: null,
  closed: false,
  sip: [],
  ...over,
});

describe('saving what a statement decided', () => {
  it('sets the replaced lines aside through the database function, in chunks, and deletes nothing', async () => {
    const { db, rpcs, queries } = fakeDb();
    const keys = Array.from({ length: 450 }, (_, i) => `k${i}`);
    await casIo(db, 'h1').save(
      save({
        replace: {
          keys,
          reason: 'Replaced by the fund statement dated 27 Oct 2026',
          statementRef: 'upload:abc',
          statementOn: '2026-10-27',
        },
      }),
    );
    const set = rpcs.filter((r) => r.fn === 'supersede_fund_lines');
    expect(set).toHaveLength(3);
    expect((set[0]!.args.p_refs as string[]).length).toBe(200);
    expect(set.flatMap((r) => r.args.p_refs as string[])).toEqual(keys);
    expect(set[0]!.args).toMatchObject({
      p_household: 'h1',
      p_asset: 'a1',
      p_statement_ref: 'upload:abc',
      p_statement_on: '2026-10-27',
    });
    expect(opsOf(queries, 'mf_transactions', 'delete')).toHaveLength(0);
  });

  it('brings back a set-aside copy of a line the statement itself has, but only for a statement', async () => {
    const a = fakeDb();
    await casIo(a.db, 'h1').save(save({ transactions: [line('x1'), line('x2')] }));
    const restore = a.rpcs.filter((r) => r.fn === 'restore_fund_lines');
    expect(restore).toHaveLength(1);
    expect(restore[0]!.args.p_refs).toEqual(['x1', 'x2']);
    const b = fakeDb();
    await casIo(b.db, 'h1').save(save({ transactions: [line('x1')], lineSource: 'csv' }));
    expect(b.rpcs.filter((r) => r.fn === 'restore_fund_lines')).toHaveLength(0);
  });

  it('stores each line under the source it came from', async () => {
    for (const source of ['cas', 'csv'] as const) {
      const { db, queries } = fakeDb();
      await casIo(db, 'h1').save(save({ transactions: [line('x1')], lineSource: source }));
      const [, args] = opsOf(queries, 'mf_transactions', 'upsert')[0]!;
      expect((args[0] as { source: string }[])[0]!.source).toBe(source);
      expect(args[1]).toMatchObject({ ignoreDuplicates: true });
    }
  });

  it('records the period the statement decided on the fund', async () => {
    const { db, queries } = fakeDb({ mf_positions: [{ units_as_of: null }] });
    await casIo(db, 'h1').save(
      save({ position: { casAsOf: '2026-10-27', coverFrom: '1986-10-01', coverTo: '2026-10-27' } }),
    );
    const upd = opsOf(queries, 'mf_positions', 'update')[0]![1][0] as Record<string, unknown>;
    expect(upd).toMatchObject({ cas_detail_from: '1986-10-01', cas_detail_to: '2026-10-27' });
  });

  it('writes nothing for a save that carries nothing', async () => {
    const { db, queries, rpcs } = fakeDb();
    await casIo(db, 'h1').save(save({}));
    expect(queries).toHaveLength(0);
    expect(rpcs).toHaveLength(0);
  });
});

describe('reading what is on file', () => {
  it('leaves out lines a statement replaced, and reads the period the last statement decided', async () => {
    const { db, queries } = fakeDb({
      assets: [{ id: 'a1', nickname: 'Fund', status: 'active' }],
      mf_positions: [
        {
          asset_id: 'a1',
          fund_name: 'Fund',
          amfi_code: null,
          isin: null,
          folio_last4: null,
          units_as_of: '2026-10-27',
          started_on: '2025-01-05',
          units: 10,
          invested: 1000,
          sip_monthly: null,
          sip_stopped: false,
          cas_detail_from: '1986-10-01',
          cas_detail_to: '2026-10-27',
        },
      ],
    });
    const funds = await casIo(db, 'h1').funds('o1', { dates: [] });
    expect(funds[0]!.state!.cover).toEqual({ from: '1986-10-01', to: '2026-10-27' });
    // the column is probed once (it can be missing until the database update has run), then the lines are read without the set-aside ones
    const reads = queries.filter((r) => r.table === 'mf_transactions');
    expect(
      reads.some((r) => r.ops.some(([o, a]) => o === 'or' && a[0] === 'superseded_on.is.null')),
    ).toBe(true);
  });
  it('has no period for a fund no detailed statement has decided yet', async () => {
    const { db } = fakeDb({
      assets: [{ id: 'a1', nickname: 'Fund', status: 'active' }],
      mf_positions: [
        { asset_id: 'a1', fund_name: 'Fund', units: 1, invested: 1, cas_detail_to: null },
      ],
    });
    const funds = await casIo(db, 'h1').funds('o1', { dates: [] });
    expect(funds[0]!.state!.cover).toBeNull();
  });
});
