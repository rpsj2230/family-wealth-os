/**
 * Reads what the position engine (core position.ts) needs for a household and arranges it: every dated value, each deposit's terms,
 * each fund's ledger, prices and statement values, and the exchange-rate history. The signed-in page, the daily summary and the
 * history rebuild all start here, so they work from the same input.
 *
 * Prices are the heavy part. A page that only looks at a few days (the period starts and ends) reads the prices around those days;
 * the history rebuild reads them all (`allPrices`).
 */
import {
  gainDays,
  dataStarts,
  positionInputFrom,
  posFundFrom,
  type AppConfig,
  type PosFund,
  type PositionInput,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedPortfolio } from './index';
import { liveLinesFilter } from './columns';
import { loadNavHistory } from './nav-history';
import { pageAll } from './paging';

type Row = Record<string, unknown>;

const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

export interface PositionLoadOptions {
  /** required for a service-role client (it bypasses Row Level Security) */
  householdId?: string;
  config: AppConfig;
  /** read every price there is (the history rebuild); otherwise only those around the days the period figures look at */
  allPrices?: boolean;
  /** the days to read prices around when not reading them all; default: the days of the period figures */
  days?: string[];
}

/**
 * The input of the position engine for the household that `loaded` was read for. Funds come with their ledger lines, prices around the
 * days that matter, statement values and the unit count on file; the rest comes from `loaded` as it is.
 */
export async function loadPositionInput(
  db: SupabaseClient,
  loaded: LoadedPortfolio,
  opts: PositionLoadOptions,
): Promise<PositionInput> {
  const cfg = opts.config;
  const today = loaded.today.toISOString().slice(0, 10);
  const sel = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  const funds = loaded.assetRows.filter((a) => a.type === 'mutual_fund');
  const fundIds = new Set(funds.map((f) => f.id));
  const foreign = [...new Set(loaded.assetRows.map((a) => a.currency).filter((c) => c !== 'INR'))];

  // the ledger lines and statement values today's figures were built from (loadPortfolioData), so the history uses exactly the same ones
  const reuse = loaded.engine;
  const live = funds.length && !reuse ? await liveLinesFilter(db) : 'id.not.is.null';
  const [positions, lines, snaps, fxRows] = await Promise.all([
    funds.length
      ? sel(
          'mf_positions',
          'asset_id, invested, started_on, sip_monthly, sip_stopped, units, units_as_of',
        )
      : Promise.resolve({ data: [] as Row[] }),
    reuse
      ? Promise.resolve([...reuse.fundLines.values()].flat())
      : funds.length
        ? pageAll<Row>((from, to) =>
            sel(
              'mf_transactions',
              'id, asset_id, txn_on, kind, units, amount, nav, balance_units, description, source',
            )
              // a line a fund statement replaced is kept for the record only
              .or(live)
              .order('txn_on')
              .order('id')
              .range(from, to),
          )
        : Promise.resolve([] as Row[]),
    reuse
      ? Promise.resolve(
          [...reuse.fundSnaps.entries()].flatMap(([id, list]) =>
            list.map((x) => ({ asset_id: id, as_of: x.date, value: x.value }) as Row),
          ),
        )
      : funds.length
        ? pageAll<Row>((from, to) =>
            sel('mf_snapshots', 'asset_id, as_of, value').order('as_of').range(from, to),
          )
        : Promise.resolve([] as Row[]),
    foreign.length
      ? pageAll<Row>((from, to) =>
          db
            .from('fx_rates')
            .select('currency, rate_date, inr_per_unit')
            .in('currency', foreign)
            .order('rate_date')
            .range(from, to),
        )
      : Promise.resolve([] as Row[]),
  ]);

  const fx: Record<string, { date: string; rate: number }[]> = {};
  for (const r of fxRows) {
    const c = r.currency as string;
    (fx[c] ??= []).push({ date: r.rate_date as string, rate: Number(r.inr_per_unit) });
  }

  const posOf = new Map(
    ((positions.data ?? []) as unknown as Row[]).map((p) => [p.asset_id as string, p]),
  );
  const linesBy = new Map<string, Row[]>();
  for (const l of lines) {
    const id = l.asset_id as string;
    if (fundIds.has(id)) (linesBy.get(id) ?? linesBy.set(id, []).get(id)!).push(l);
  }
  const snapBy = new Map<string, { date: string; value: number }[]>();
  for (const s of snaps) {
    const id = s.asset_id as string;
    (snapBy.get(id) ?? snapBy.set(id, []).get(id)!).push({
      date: s.as_of as string,
      value: Number(s.value),
    });
  }

  // each fund as the engine reads it, still without prices (they come next, once it is known which days they are needed for)
  const posFunds: Record<string, PosFund> = {};
  for (const f of funds) {
    const p = posOf.get(f.id);
    const units =
      f.units !== null && f.units !== undefined && f.units_as_of && f.units_source !== 'plan'
        ? { units: f.units, asOf: f.units_as_of }
        : null;
    posFunds[f.id] = posFundFrom({
      lines: (linesBy.get(f.id) ?? []).map((l) => ({
        date: l.txn_on as string,
        kind: (l.kind as string | null) ?? null,
        units: Number(l.units),
        amount: Number(l.amount),
        nav: l.nav === null ? null : Number(l.nav),
        balance: l.balance_units === null ? null : Number(l.balance_units),
        source: (l.source as string | null) ?? null,
        description: (l.description as string | null) ?? null,
      })),
      navs: [],
      units,
      snapshots: snapBy.get(f.id) ?? [],
      plan: p
        ? {
            invested: Number(p.invested ?? 0),
            startedOn: (p.started_on as string | null) ?? null,
            sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
            sipStopped: !!p.sip_stopped,
          }
        : null,
      sip: f.sip ?? null,
      today,
      unitTolerance: cfg.funds.unitTolerance,
    });
  }
  const build = (): PositionInput =>
    positionInputFrom({
      assets: loaded.assetRows,
      observations: [...loaded.obsRows, ...loaded.sheetObs],
      fds: loaded.fdRows,
      funds: posFunds,
      config: cfg,
      today,
      fx,
      portfolio: loaded.portfolio,
      ...(reuse?.extras.moves ? { moves: reuse.extras.moves } : {}),
      ...(reuse?.extras.rates ? { rates: reuse.extras.rates } : {}),
      ...(reuse?.extras.placements ? { placements: reuse.extras.placements } : {}),
    });

  // the prices. A fund with no ledger is moved on from every value on file with its price and its plan's instalments, so it needs the
  // prices of every day from its first value on; the rest are valued on the days the period figures look at (or on all days when
  // reading them all). The days come from the same input the figures are worked out from, so a period that begins where the data does
  // has its prices.
  const codeOf = new Map(funds.map((f) => [f.id, f.amfi_code ?? null]));
  const codes = [...new Set([...codeOf.values()].filter((c): c is string => !!c))];
  const gap = cfg.funds.navGapDays;
  const rolledFrom = new Map<string, string>();
  for (const f of funds) {
    const code = codeOf.get(f.id);
    if (!code || (linesBy.get(f.id) ?? []).length > 0) continue;
    const first = [
      ...[...loaded.obsRows, ...loaded.sheetObs]
        .filter((o) => o.asset_id === f.id && !o.superseded_by)
        .map((o) => o.as_of),
      ...(snapBy.get(f.id) ?? []).map((s) => s.date),
      ...(f.units_as_of && f.units_source !== 'plan' ? [f.units_as_of] : []),
      ...(posOf.get(f.id)?.started_on ? [posOf.get(f.id)!.started_on as string] : []),
    ].sort()[0];
    if (first) {
      const cur = rolledFrom.get(code);
      if (!cur || first < cur) rolledFrom.set(code, first);
    }
  }
  const navs: Row[] = [];
  if (codes.length > 0) {
    if (opts.allPrices) {
      navs.push(
        ...(await pageAll<Row>((from, to) =>
          db
            .from('mf_navs')
            .select('amfi_code, nav_date, nav')
            .in('amfi_code', codes)
            .order('nav_date')
            .range(from, to),
        )),
      );
    } else {
      // funds with units rebuilt from a plan, or moved on from their values: every price from a little before the fund's start (kept in
      // memory once read, see nav-history.ts)
      if (rolledFrom.size > 0) {
        const hist = await loadNavHistory(
          db,
          [...rolledFrom].map(([code, first]) => ({ code, from: addDays(first, -gap) })),
        );
        for (const [code, rows] of hist)
          for (const r of rows) navs.push({ amfi_code: code, nav_date: r.date, nav: r.nav });
      }
      // the others: the prices around the days the period figures look at
      const rest = codes.filter((c) => !rolledFrom.has(c));
      if (rest.length > 0) {
        const start = dataStarts(build());
        const days = (opts.days ?? gainDays(today, cfg.home.changeDays, start)).filter(
          (d) => d < today,
        );
        // each day reads the prices from `gap` days before it up to it, and today's latest price is read by the portfolio already
        const ranges = days.map((d) => `and(nav_date.gte.${addDays(d, -gap)},nav_date.lte.${d})`);
        for (let i = 0; i < ranges.length; i += 12) {
          const part = ranges.slice(i, i + 12).join(',');
          navs.push(
            ...(await pageAll<Row>((from, to) =>
              db
                .from('mf_navs')
                .select('amfi_code, nav_date, nav')
                .in('amfi_code', rest)
                .or(part)
                .order('nav_date')
                .range(from, to),
            )),
          );
        }
      }
    }
  }
  const navBy = new Map<string, { date: string; nav: number }[]>();
  const seen = new Set<string>();
  for (const n of navs) {
    const key = `${n.amfi_code}|${n.nav_date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const code = n.amfi_code as string;
    (navBy.get(code) ?? navBy.set(code, []).get(code)!).push({
      date: n.nav_date as string,
      nav: Number(n.nav),
    });
  }
  for (const list of navBy.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  for (const f of funds) posFunds[f.id]!.navs = navBy.get(f.amfi_code ?? '') ?? [];

  return build();
}
