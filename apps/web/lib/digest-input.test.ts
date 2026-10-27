import { describe, expect, it } from 'vitest';
import { buildDigest } from '@fwos/core';
import { buildDigestInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/**
 * A stand-in for Supabase: tables are arrays, and the query builder understands only what the loaders use (select, eq, in, lt,
 * lte, gte, not null, is null, order, range, limit, single). A table that is not given reads as empty.
 */
function fakeDb(tables: Record<string, Row[]>): SupabaseClient {
  const from = (name: string) => {
    let rows = [...(tables[name] ?? [])];
    let head = false;
    const api: Record<string, unknown> = {};
    const run = () => {
      const out = { data: rows, error: null as null, count: rows.length };
      return head ? { ...out, data: null } : out;
    };
    const chain = (f: (r: Row) => boolean) => {
      rows = rows.filter(f);
      return api;
    };
    Object.assign(api, {
      select: (_c?: string, o?: { head?: boolean }) => {
        head = !!o?.head;
        return api;
      },
      eq: (c: string, v: unknown) => chain((r) => r[c] === v),
      neq: (c: string, v: unknown) => chain((r) => r[c] !== v),
      in: (c: string, v: unknown[]) => chain((r) => v.includes(r[c])),
      lt: (c: string, v: string) => chain((r) => String(r[c]) < v),
      lte: (c: string, v: string) => chain((r) => String(r[c]) <= v),
      gte: (c: string, v: string) => chain((r) => String(r[c]) >= v),
      is: (c: string, v: unknown) => chain((r) => (r[c] ?? null) === v),
      not: (c: string, _op: string, v: unknown) => chain((r) => (r[c] ?? null) !== v),
      order: (c: string, o?: { ascending?: boolean }) => {
        rows.sort(
          (a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending === false ? -1 : 1),
        );
        return api;
      },
      range: (a: number, b: number) => {
        rows = rows.slice(a, b + 1);
        return api;
      },
      limit: (n: number) => {
        rows = rows.slice(0, n);
        return api;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) =>
        Promise.resolve(run()).then(ok, bad),
    });
    return api;
  };
  return { from } as unknown as SupabaseClient;
}

const asset = (o: Row) => ({
  owner_id: 'p1',
  status: 'active',
  currency: 'INR',
  account_kind: null,
  expected_freshness_days: 35,
  institution_id: null,
  ...o,
});
const obs = (id: string, asset_id: string, amount: number, as_of = '2026-10-25') => ({
  id,
  asset_id,
  kind: 'balance',
  amount,
  currency: 'INR',
  fx_rate: null,
  as_of,
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: `${as_of}T00:00:00Z`,
  superseded_by: null,
});

const tables = (o: Record<string, Row[]> = {}): Record<string, Row[]> => ({
  owners: [
    { id: 'p1', display_name: 'Anil', dob: '1982-04-10', plan_role: 'primary' },
    { id: 'p2', display_name: 'Beena', dob: '1984-01-01', plan_role: 'spouse' },
  ],
  institutions: [{ id: 'eq', name: 'Equitas', deposit_insured: true }],
  assets: [
    asset({
      id: 'cash',
      type: 'bank_account',
      nickname: 'Savings',
      institution_id: 'eq',
      account_kind: 'NRE',
    }),
    asset({ id: 'fd', type: 'fixed_deposit', nickname: 'FD', institution_id: 'eq' }),
    asset({ id: 'mf', type: 'mutual_fund', nickname: 'Index fund' }),
    asset({ id: 'flat', type: 'property', nickname: 'Flat', owner_id: 'p2' }),
  ],
  observations: [
    obs('o1', 'cash', 400_000),
    obs('o2', 'mf', 1_900_000),
    obs('o3', 'flat', 5_000_000),
  ],
  fixed_deposits: [
    {
      asset_id: 'fd',
      principal: 800_000,
      rate: 0.075,
      booked_on: '2026-01-10',
      maturity_on: '2026-11-12',
      compounding: 'quarterly',
      bank_maturity_amount: null,
    },
  ],
  mf_positions: [
    {
      asset_id: 'mf',
      invested: 1_500_000,
      sip_monthly: 30_000,
      sip_stopped: false,
      started_on: '2022-01-01',
    },
  ],
  mf_transactions: [{ asset_id: 'mf', source: 'cas', description: 'Purchase' }],
  goals: [
    {
      id: 'g1',
      name: 'Education',
      kind: 'education',
      target_amount: 1_500_000,
      target_date: '2032-06-01',
      inflation_rate: null,
    },
    {
      id: 'g2',
      name: 'Holiday',
      kind: 'other',
      target_amount: null,
      target_date: null,
      inflation_rate: null,
    },
  ],
  goal_allocations: [{ goal_id: 'g1', asset_id: 'mf', method: 'percent', value: 50 }],
  plan_settings: [
    {
      settings: {
        monthlySpendingToday: 90_000,
        retireAtAge: 58,
        planningEndAge: 90,
      },
    },
  ],
  snapshots: [
    {
      taken_on: '2026-09-20',
      total: 7_600_000,
      by_type: {
        bank_account: 400_000,
        fixed_deposit: 780_000,
        mutual_fund: 1_500_000,
        property: 4_900_000,
      },
      by_owner: { p1: 2_700_000, p2: 4_900_000 },
    },
    { taken_on: '2026-10-26', total: 8_090_000, by_type: {}, by_owner: {} },
  ],
  tasks: [{ title: 'Pay the premium', due_on: '2026-10-30', status: 'open' }],
  ...o,
});

const opts = {
  date: '2026-10-27',
  householdName: 'The Sharmas',
  appUrl: 'https://wealth.example.test',
};

describe('buildDigestInput (with a stand-in database)', () => {
  it('reads the household and puts together the money figures, goals and retirement', async () => {
    const i = await buildDigestInput(fakeDb(tables()), opts);
    const w = i.wealth!;
    expect(w.total).toBe(i.netWorth.total);
    expect(w.classes.reduce((a, c) => a + c.current, 0)).toBeCloseTo(w.total, 4);
    expect(w.classes.find((c) => c.key === 'funds')!.current).toBe(1_900_000);
    expect(w.classes.find((c) => c.key === 'funds')!.invested).toBe(1_500_000);
    expect(w.classes.find((c) => c.key === 'funds')!.estimated).toBe(false);
    // the balance is carried forward at the savings rate since it was recorded, so a little over the figure entered
    expect(w.classes.find((c) => c.key === 'cash')!.current).toBeGreaterThanOrEqual(400_000);
    expect(w.classes.find((c) => c.key === 'cash')!.current).toBeLessThan(402_000);
    expect(i.asOf).toBe('2026-10-25');
    expect(i.previous).toEqual({ date: '2026-10-26', total: 8_090_000 });
    expect(i.goals!.map((g) => [g.name, g.state])).toEqual([
      ['Education', expect.stringMatching(/on_track|ahead|behind/)],
      ['Holiday', 'no_data'],
    ]);
    expect(i.retirement?.card?.name).toBe('Retirement at 58');
    expect(i.needsYou!.some((n) => /task due/.test(n.text))).toBe(true);
    expect(i.changes!.since).toBe('2026-09-20');
    expect(i.changes!.maturities[0]!.name).toContain('Equitas');
    expect(i.attention.maturingSoon[0]!.amount).toBeGreaterThan(800_000);
  });

  it('honours the two switches, and a setting that is absent behaves as on', async () => {
    const off = await buildDigestInput(fakeDb(tables()), {
      ...opts,
      includeGoals: false,
      includeRetirement: false,
    });
    expect(off.goals).toBeNull();
    expect(off.retirement).toBeNull();
    const absent = await buildDigestInput(fakeDb(tables()), opts);
    expect(absent.goals).not.toBeNull();
    expect(absent.retirement).not.toBeNull();
    const html = buildDigest(off).html;
    expect(html).not.toContain('are we on track');
    expect(html).not.toContain('Retirement at');
  });

  it('leaves retirement out when no plan was saved, and says there are no goals when none exist', async () => {
    const i = await buildDigestInput(
      fakeDb(tables({ plan_settings: [], goals: [], goal_allocations: [] })),
      opts,
    );
    expect(i.retirement).toBeNull();
    expect(i.goals).toEqual([]);
    expect(buildDigest(i).text).toContain('No goals set yet');
  });

  it('counts a household that is empty without failing', async () => {
    const i = await buildDigestInput(
      fakeDb({ owners: [], assets: [], observations: [], institutions: [] }),
      opts,
    );
    expect(i.wealth!.total).toBe(0);
    const e = buildDigest(i);
    expect(e.html).not.toMatch(/NaN|undefined|Infinity/);
    expect(e.subject).toContain('Family Wealth Summary · 27 Oct 2026');
  });

  it('works from only the household it is scoped to (a service-role client)', async () => {
    const db = fakeDb(
      tables({
        goals: [
          {
            id: 'g1',
            household_id: 'h1',
            name: 'Mine',
            kind: 'other',
            target_amount: 1_000_000,
            target_date: '2030-01-01',
            inflation_rate: null,
          },
          {
            id: 'g2',
            household_id: 'h2',
            name: 'Not mine',
            kind: 'other',
            target_amount: 1_000_000,
            target_date: '2030-01-01',
            inflation_rate: null,
          },
        ],
      }),
    );
    const i = await buildDigestInput(db, { ...opts, householdId: 'h1' });
    expect(i.goals!.map((g) => g.name)).toEqual(['Mine']);
  });

  it('the plain text and the e-mail carry the same key numbers', async () => {
    const i = await buildDigestInput(fakeDb(tables()), opts);
    const e = buildDigest(i);
    const total = i.netWorth.total;
    expect(e.subject).toContain('Net worth');
    expect(e.text).toContain(`(₹${new Intl.NumberFormat('en-IN').format(Math.round(total))})`);
    expect(e.whatsapp.split('\n')[0]).toBe('*Family Wealth Summary · 27 Oct 2026*');
    expect(e.text.length).toBeLessThan(4000);
  });
});
