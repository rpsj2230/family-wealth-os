/**
 * What the central engine needs beyond the holdings' own rows: the confirmed money movements (core capital ledger, savings estimates,
 * maturity proceeds) and each savings account's rates by effective date. Read once per page or job and handed to both today's portfolio
 * and the history, so the two can never differ.
 *
 * A table that is not there yet (a deploy that reached the app before the database update) reads as empty: every figure then falls back
 * to the holdings' own rows, never to an error page.
 */
import {
  addDaysIso,
  gainDays,
  ledgerMoveOf,
  savingsSchedule,
  type LedgerMove,
  abroadIncomeMoves,
  type PositionInput,
  rateOfferFromRow,
  type AssetRow,
  type AppConfig,
  type RateKind,
  type RateStep,
  type SavingsTxn,
  type SlabMethod,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedPortfolio } from './index';
import { pageAll } from './paging';

export interface MoneyMove {
  id: string;
  movedOn: string;
  amount: number;
  currency: string;
  fromAssetId: string | null;
  toAssetId: string | null;
  kind: string;
  status: 'confirmed' | 'suggested' | 'rejected';
  source: string;
  note: string | null;
  idemKey: string | null;
}

type Row = Record<string, unknown>;

const missingTable = (e: { code?: string; message?: string } | null | undefined) =>
  !!e &&
  (e.code === '42P01' ||
    e.code === 'PGRST205' ||
    /does not exist|could not find the table/i.test(e.message ?? ''));

/** Every money movement of the household (confirmed, suggested and rejected), oldest first. */
export async function loadMoneyMoves(
  db: SupabaseClient,
  householdId?: string,
): Promise<MoneyMove[]> {
  try {
    const rows = await pageAll<Row>((from, to) => {
      const q = db
        .from('money_moves')
        .select(
          'id, moved_on, amount, currency, from_asset_id, to_asset_id, kind, status, source, note, idem_key',
        )
        .order('moved_on')
        .order('id')
        .range(from, to);
      return householdId ? q.eq('household_id', householdId) : q;
    });
    return rows.map((r) => ({
      id: r.id as string,
      movedOn: r.moved_on as string,
      amount: Number(r.amount),
      currency: (r.currency as string) ?? 'INR',
      fromAssetId: (r.from_asset_id as string | null) ?? null,
      toAssetId: (r.to_asset_id as string | null) ?? null,
      kind: r.kind as string,
      status: r.status as MoneyMove['status'],
      source: r.source as string,
      note: (r.note as string | null) ?? null,
      idemKey: (r.idem_key as string | null) ?? null,
    }));
  } catch (e) {
    if (missingTable(e as { code?: string; message?: string })) return [];
    // pageAll throws the API error; a missing table is the only one that is expected
    const msg = String((e as Error)?.message ?? e);
    if (/money_moves/.test(msg) && /exist|find/i.test(msg)) return [];
    throw e;
  }
}

/** A savings account's confirmed money in (+) and out (−), from the movements touching it. */
export function savingsMovesOf(
  moves: MoneyMove[],
  accountIds: Set<string>,
): Record<string, SavingsTxn[]> {
  const out: Record<string, SavingsTxn[]> = {};
  for (const m of moves) {
    if (m.status !== 'confirmed') continue;
    if (m.toAssetId && accountIds.has(m.toAssetId))
      (out[m.toAssetId] ??= []).push({ date: m.movedOn, amount: m.amount });
    if (m.fromAssetId && accountIds.has(m.fromAssetId))
      (out[m.fromAssetId] ??= []).push({ date: m.movedOn, amount: -m.amount });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

/** Where each deposit's maturity proceeds went: the confirmed movements out of it. */
export function placementsOf(
  moves: MoneyMove[],
  depositIds: Set<string>,
): Record<string, { on: string; amount: number }[]> {
  const out: Record<string, { on: string; amount: number }[]> = {};
  for (const m of moves)
    if (m.status === 'confirmed' && m.fromAssetId && depositIds.has(m.fromAssetId))
      (out[m.fromAssetId] ??= []).push({ on: m.movedOn, amount: m.amount });
  return out;
}

/**
 * Each INR savings account's rates by effective date: its own rate and the dated changes of it, else its bank's slabs (for its kind) and
 * the changes the rate log recorded, else the assumed rate. The slab method is the bank's own, else the household's setting.
 */
export async function loadSavingsSchedules(
  db: SupabaseClient,
  assets: AssetRow[],
  config: AppConfig,
  householdId?: string,
): Promise<Record<string, RateStep[]>> {
  const accounts = assets.filter(
    (a) => a.type === 'bank_account' && a.currency === 'INR' && a.status !== 'gifted',
  );
  if (accounts.length === 0) return {};
  const sel = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return householdId ? q.eq('household_id', householdId) : q;
  };
  const [inst, offers, events, history] = await Promise.all([
    sel('institutions', '*'),
    sel('rate_offers', '*').eq('product', 'savings'),
    sel(
      'rate_events',
      'at, bank, product, account_kind, balance_from, balance_to, kind, old_rate, new_rate',
    ).eq('product', 'savings'),
    sel('asset_rate_history', 'asset_id, effective_on, old_rate, new_rate').order('effective_on'),
  ]);
  const banks = new Map(
    ((inst.data ?? []) as unknown as Row[]).map((i) => [
      i.id as string,
      {
        name: i.name as string,
        method: (i.savings_slab_method as SlabMethod | null | undefined) ?? null,
      },
    ]),
  );
  const offerList = ((offers.data ?? []) as unknown as Row[]).map(rateOfferFromRow);
  const eventList = ((events.data ?? []) as unknown as Row[]).map((e) => ({
    at: String(e.at),
    bank: e.bank as string,
    accountKind: e.account_kind as string,
    balanceFrom: e.balance_from === null ? null : Number(e.balance_from),
    balanceTo: e.balance_to === null ? null : Number(e.balance_to),
    kind: e.kind as string,
    oldRate: e.old_rate === null ? null : Number(e.old_rate),
    newRate: e.new_rate === null ? null : Number(e.new_rate),
  }));
  // a history table that is not there yet reads as no history
  const histBy = new Map<
    string,
    { effectiveOn: string; oldRate: number | null; newRate: number | null }[]
  >();
  if (!history.error)
    for (const h of (history.data ?? []) as unknown as Row[])
      (
        histBy.get(h.asset_id as string) ??
        histBy.set(h.asset_id as string, []).get(h.asset_id as string)!
      ).push({
        effectiveOn: h.effective_on as string,
        oldRate: h.old_rate === null ? null : Number(h.old_rate),
        newRate: h.new_rate === null ? null : Number(h.new_rate),
      });
  const defaultMethod: SlabMethod = config.estimates.savingsSlabIncremental
    ? 'incremental'
    : 'whole';
  const out: Record<string, RateStep[]> = {};
  for (const a of accounts) {
    const bank = a.institution_id ? (banks.get(a.institution_id) ?? null) : null;
    const kind: RateKind | null =
      a.account_kind === 'NRE' || a.account_kind === 'NRO' ? a.account_kind : null;
    out[a.id] = savingsSchedule({
      own: a.interest_rate ?? null,
      ownHistory: histBy.get(a.id) ?? [],
      offers: offerList,
      events: eventList,
      bank: bank?.name ?? null,
      kind,
      method: bank?.method ?? defaultMethod,
      assumed: config.estimates.savingsRate,
    });
  }
  return out;
}

/** The first day the household's figures can be measured from: Settings > capital, else the earliest dated record on file. */
export function capitalStart(
  loaded: Pick<LoadedPortfolio, 'obsRows' | 'sheetObs' | 'fdRows' | 'engine'>,
  config: AppConfig,
): string | null {
  if (config.capital.openingDate) return config.capital.openingDate;
  const dates = [
    ...loaded.obsRows.filter((o) => !o.superseded_by).map((o) => o.as_of),
    ...loaded.fdRows.map((f) => f.booked_on),
    ...[...(loaded.engine?.fundLines.values() ?? [])].flatMap((l) =>
      l.map((x) => x.txn_on as string),
    ),
  ].filter((d): d is string => !!d);
  return dates.sort()[0] ?? null;
}

/**
 * The days the position engine must price funds on for the capital ledger (the day before each calendar month starts and its last day,
 * from the opening date to today) together with the days of the period figures, so one read of prices serves both.
 */
export function capitalDays(start: string | null, today: string, recentDays: number): string[] {
  const days = new Set<string>(gainDays(today, recentDays, start));
  if (start) {
    let y = Number(start.slice(0, 4));
    let m = Number(start.slice(5, 7));
    days.add(start);
    for (let guard = 0; guard < 1200; guard++) {
      const first = `${y}-${String(m).padStart(2, '0')}-01`;
      if (first > today) break;
      if (first >= start) {
        days.add(first);
        days.add(addDaysIso(first, -1));
      }
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
  }
  return [...days].filter((d) => d < today).sort();
}

/** The family ledger's reading of the stored movements (transfers between own holdings drop out). */
export const ledgerMovesOf = (moves: MoneyMove[]): LedgerMove[] =>
  moves.map((m) => ledgerMoveOf(m)).filter((m): m is LedgerMove => m !== null);

/**
 * The family ledger's movements with what the rules add: money in or out of the accounts abroad that no transfer explains, as money
 * from outside (Settings: capital.abroadIsIncome). The one place every ledger takes its movements from.
 */
export const ledgerMovesFor = (
  moves: MoneyMove[],
  position: PositionInput,
  config: Pick<AppConfig, 'capital'>,
): LedgerMove[] => [
  ...ledgerMovesOf(moves),
  ...(config.capital.abroadIsIncome ? abroadIncomeMoves(position, moves) : []),
];
