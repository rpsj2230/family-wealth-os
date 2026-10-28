/**
 * A small in-memory stand-in for the database client, for the tests of the code that reads and writes a few tables. It keeps rows,
 * applies `eq`, `is`, `in`, `ilike` and `or` (for the ISIN lookups) filters, `update` and `select`, counts, and the named database
 * functions (`rpc`) the test gives it. Tests only; nothing else imports it.
 */
type Row = Record<string, unknown>;
type Filter = (r: Row) => boolean;

export interface TestDb {
  from(table: string): unknown;
  rpc(fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
}

export interface TestDbOptions {
  tables: Record<string, Row[]>;
  /** database functions; return an error object to fail */
  rpcs?: Record<
    string,
    (
      args: Record<string, unknown>,
      tables: Record<string, Row[]>,
    ) => { data?: unknown; error?: { message: string; code?: string } | null }
  >;
  /** tables whose columns the database does not have yet: a read that names one fails */
  missingColumns?: Record<string, string[]>;
}

const like = (pattern: string) =>
  new RegExp('^' + pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i');

export function testDb(opts: TestDbOptions) {
  const tables = opts.tables;
  const log: { table: string; op: string; args: unknown[] }[] = [];
  const rpcLog: { fn: string; args: Record<string, unknown> }[] = [];

  function from(table: string) {
    const filters: Filter[] = [];
    let mode: 'select' | 'update' = 'select';
    let patch: Row = {};
    let cols = '*';
    let head = false;
    let count = false;
    let max = Infinity;
    let single = false;
    const q: Record<string, unknown> = {
      select(c = '*', o?: { count?: string; head?: boolean }) {
        cols = c;
        head = !!o?.head;
        count = !!o?.count;
        log.push({ table, op: mode === 'update' ? 'update.select' : 'select', args: [c, o] });
        return q;
      },
      update(p: Row) {
        mode = 'update';
        patch = p;
        log.push({ table, op: 'update', args: [p] });
        return q;
      },
      eq(c: string, v: unknown) {
        filters.push((r) => r[c] === v);
        return q;
      },
      is(c: string, v: unknown) {
        filters.push((r) => (r[c] ?? null) === v);
        return q;
      },
      in(c: string, v: unknown[]) {
        filters.push((r) => v.includes(r[c]));
        return q;
      },
      ilike(c: string, v: string) {
        const re = like(v);
        filters.push((r) => re.test(String(r[c] ?? '')));
        return q;
      },
      or(expr: string) {
        // isin_growth.in.(A,B),isin_reinvest.in.(A,B)  /  isin_growth.eq.A,isin_reinvest.eq.A
        const parts = expr.split(/,(?=[a-z_]+\.(?:in|eq)\.)/);
        const tests = parts.map((p) => {
          const m = /^([a-z_]+)\.(in|eq)\.(.*)$/.exec(p)!;
          const vals = m[2] === 'in' ? m[3]!.replace(/^\(|\)$/g, '').split(',') : [m[3]!];
          return (r: Row) => vals.includes(String(r[m[1]!] ?? ''));
        });
        filters.push((r) => tests.some((t) => t(r)));
        return q;
      },
      order() {
        return q;
      },
      maybeSingle() {
        single = true;
        return q;
      },
      limit(n: number) {
        max = n;
        return q;
      },
      then(ok: (v: unknown) => unknown) {
        const named = cols
          .split(',')
          .map((c) => c.trim())
          .filter((c) => c && c !== '*');
        const missing = opts.missingColumns?.[table] ?? [];
        if (
          named.some((c) => missing.includes(c)) ||
          (mode === 'update' && Object.keys(patch).some((c) => missing.includes(c)))
        )
          return ok({
            data: null,
            error: { code: '42703', message: `column ${table}.${named[0] ?? ''} does not exist` },
            count: null,
          });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        if (mode === 'update') {
          for (const r of rows) Object.assign(r, patch);
          return ok({
            data: cols === '*' && !head ? null : rows.map((r) => pick(r, named)),
            error: null,
            count: null,
          });
        }
        const out = rows.slice(0, max);
        if (single)
          return ok({ data: out[0] ? pick(out[0], named) : null, error: null, count: null });
        return ok({
          data: head ? null : out.map((r) => pick(r, named)),
          error: null,
          count: count ? rows.length : null,
        });
      },
    };
    return q;
  }

  const pick = (r: Row, named: string[]): Row =>
    named.length === 0 ? { ...r } : Object.fromEntries(named.map((c) => [c, r[c]]));

  const db: TestDb = {
    from(table) {
      return from(table);
    },
    async rpc(fn, args) {
      rpcLog.push({ fn, args });
      const h = opts.rpcs?.[fn];
      if (!h)
        return {
          data: null,
          error: { code: 'PGRST202', message: `Could not find the function ${fn}` },
        };
      const r = h(args, tables);
      return { data: r.data ?? null, error: r.error ?? null };
    },
  };
  return { db: db as never, tables, log, rpcLog };
}
