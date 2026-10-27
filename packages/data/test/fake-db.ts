import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

/**
 * A small in-memory stand-in for the Supabase client: just the calls the rate sync makes (select, insert, update and delete with
 * eq / in / like / order / limit). Rows are plain objects per table. Not a database: it exists so the sync logic can be tested
 * without one.
 */
export function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = Object.fromEntries(
    Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]),
  );
  let seq = 0;
  const log: { table: string; op: string; value?: unknown }[] = [];
  const rows = (t: string) => (tables[t] ??= []);

  class Query implements PromiseLike<{ data: Row[] | null; error: null }> {
    private filters: Filter[] = [];
    private cap = Infinity;
    private op: 'select' | 'insert' | 'update' | 'delete' = 'select';
    private payload: unknown;
    constructor(private readonly table: string) {}
    select() {
      return this;
    }
    insert(v: Row | Row[]) {
      this.op = 'insert';
      this.payload = v;
      return this;
    }
    update(v: Row) {
      this.op = 'update';
      this.payload = v;
      return this;
    }
    delete() {
      this.op = 'delete';
      return this;
    }
    eq(col: string, val: unknown) {
      this.filters.push((r) => r[col] === val);
      return this;
    }
    in(col: string, vals: unknown[]) {
      this.filters.push((r) => vals.includes(r[col]));
      return this;
    }
    like(col: string, pattern: string) {
      const re = new RegExp(
        `^${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*')}$`,
      );
      this.filters.push((r) => typeof r[col] === 'string' && re.test(r[col] as string));
      return this;
    }
    order() {
      return this;
    }
    limit(n: number) {
      this.cap = n;
      return this;
    }
    private run(): { data: Row[] | null; error: null } {
      const t = rows(this.table);
      const hit = () => t.filter((r) => this.filters.every((f) => f(r)));
      log.push({ table: this.table, op: this.op, value: this.payload });
      if (this.op === 'insert') {
        const add = (Array.isArray(this.payload) ? this.payload : [this.payload]) as Row[];
        for (const r of add) t.push({ id: `${this.table}-${++seq}`, ...r });
        return { data: null, error: null };
      }
      if (this.op === 'update') {
        for (const r of hit()) Object.assign(r, this.payload as Row);
        return { data: null, error: null };
      }
      if (this.op === 'delete') {
        const gone = new Set(hit());
        tables[this.table] = t.filter((r) => !gone.has(r));
        return { data: [...gone], error: null };
      }
      return {
        data: hit()
          .slice(0, this.cap)
          .map((r) => ({ ...r })),
        error: null,
      };
    }
    then<A, B>(
      ok?: ((v: { data: Row[] | null; error: null }) => A | PromiseLike<A>) | null,
      bad?: ((e: unknown) => B | PromiseLike<B>) | null,
    ) {
      return Promise.resolve(this.run()).then(ok, bad);
    }
  }

  const db = { from: (t: string) => new Query(t) } as unknown as SupabaseClient;
  return { db, tables, rows, log };
}
