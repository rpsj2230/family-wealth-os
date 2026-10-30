import { describe, expect, it } from 'vitest';
import { SHARED_TABLES, householdClient } from '../src/household-client';
import { fakeDb } from './fake-db';

describe('householdClient: a service-role client that reads one household, as Row Level Security does', () => {
  const { db, tables } = fakeDb({
    assets: [
      { id: 'a1', household_id: 'H1', nickname: 'Ours' },
      { id: 'a2', household_id: 'H2', nickname: 'Theirs' },
    ],
    observations: [
      { asset_id: 'a1', household_id: 'H1', amount: 10 },
      { asset_id: 'a2', household_id: 'H2', amount: 20 },
    ],
    mf_navs: [
      { amfi_code: '1', nav: 10 },
      { amfi_code: '2', nav: 20 },
    ],
  });
  const one = householdClient(db, 'H1');

  it('reads only the household’s rows, whatever filters the caller adds', async () => {
    const a = await one.from('assets').select('id, nickname');
    expect(a.data).toEqual([{ id: 'a1', household_id: 'H1', nickname: 'Ours' }]);
    const o = await one
      .from('observations')
      .select('asset_id, amount')
      .in('asset_id', ['a1', 'a2']);
    expect(o.data?.map((r) => r.asset_id)).toEqual(['a1']);
  });

  it('reads the shared market tables whole', async () => {
    expect(SHARED_TABLES.has('mf_navs')).toBe(true);
    const n = await one.from('mf_navs').select('amfi_code, nav');
    expect(n.data).toHaveLength(2);
  });

  it('refuses every write and database function, and needs a household', () => {
    expect(() => one.from('assets').insert({ id: 'x' })).toThrow(/read-only/);
    expect(() => one.from('assets').update({ nickname: 'x' })).toThrow(/read-only/);
    expect(() => one.from('assets').delete()).toThrow(/read-only/);
    expect(() => one.rpc('save_snapshot')).toThrow(/read-only/);
    expect(tables.assets).toHaveLength(2);
    expect(() => householdClient(db, '')).toThrow(/household/);
  });
});
