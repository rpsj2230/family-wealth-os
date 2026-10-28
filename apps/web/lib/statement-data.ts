import {
  addDaysIso,
  classifyLines,
  statementInterest,
  statementInterestMoves,
  statementMoves,
  type AppConfig,
  type Classified,
  type ClassifyContext,
  type LineAnswer,
  type PositionInput,
  type StatementInterestRow,
  type StatementMove,
  type StmtLine,
} from '@fwos/core';
import { pageAll, type LoadedPortfolio } from '@fwos/data';
import type { BankStatement, StatementLine } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

/** A statement line as it is stored. */
export interface StoredLine {
  id: string;
  statement_id: string;
  asset_id: string;
  txn_on: string;
  amount: number;
  balance: number | null;
  narration: string;
  answer: LineAnswer | null;
}

/** An imported statement file. */
export interface StoredStatement {
  id: string;
  asset_id: string;
  from_on: string;
  to_on: string;
  opening: number | null;
  closing: number | null;
  line_count: number;
  breaks: number;
  layout: string;
  file_label: string | null;
  uploaded_at: string;
}

const cents = (n: number | null) => (n === null ? '' : String(Math.round(n * 100)));

/**
 * The key that makes a line unique within its account: its date, its signed amount, the balance after it and its place among
 * identical ones in the file. Two statements that overlap give the same lines the same keys, so the second adds nothing twice; the
 * narration is left out because an Excel export and a PDF of the same month word it differently.
 */
export function lineKeys(lines: StatementLine[]): string[] {
  const seen = new Map<string, number>();
  return lines.map((l) => {
    const base = `${l.date}|${cents(l.credit - l.debit)}|${cents(l.balance)}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return `${base}|${n}`;
  });
}

/**
 * The balances a statement proves: the one before its first line, and the one at the end of each calendar month it covers (or on its
 * last day, for a month it ends in). These become the account's recorded balances, so each month's own money and profit start from
 * what the bank really held.
 */
export function monthBalances(s: BankStatement): { date: string; amount: number }[] {
  const out: { date: string; amount: number }[] = [];
  if (!s.from || !s.to || s.lines.some((l) => l.balance === null)) return out;
  if (s.opening !== null) out.push({ date: addDaysIso(s.from, -1), amount: s.opening });
  const byMonth = new Map<string, number>();
  for (const l of s.lines) byMonth.set(l.date.slice(0, 7), l.balance!);
  for (const [month, amount] of byMonth) {
    const y = Number(month.slice(0, 4));
    const m = Number(month.slice(5, 7));
    const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
    out.push({ date: last < s.to ? last : s.to, amount });
  }
  return out;
}

/** The balance a statement shows at the end of a day it covers: the balance after the last line on or before it. */
export function balanceOn(s: BankStatement, date: string): number | null {
  if (!s.from || date < addDaysIso(s.from, -1) || (s.to && date > s.to)) return null;
  let b = s.opening;
  for (const l of s.lines) {
    if (l.date > date) break;
    b = l.balance;
  }
  return b;
}

/** Every stored line and statement of the household, read in pages (ten years are thousands of lines). */
export async function loadStatements(
  supabase: SupabaseClient,
): Promise<{ lines: StoredLine[]; statements: StoredStatement[] }> {
  const [lines, statements] = await Promise.all([
    pageAll<StoredLine>((from, to) =>
      supabase
        .from('statement_lines')
        .select('id, statement_id, asset_id, txn_on, amount, balance, narration, answer')
        .order('txn_on')
        .order('id')
        .range(from, to),
    ),
    pageAll<StoredStatement>((from, to) =>
      supabase
        .from('bank_statements')
        .select(
          'id, asset_id, from_on, to_on, opening, closing, line_count, breaks, layout, file_label, uploaded_at',
        )
        .order('from_on')
        .range(from, to),
    ),
  ]);
  return {
    lines: lines.map((l) => ({
      ...l,
      amount: Number(l.amount),
      balance: l.balance === null ? null : Number(l.balance),
    })),
    statements,
  };
}

/** What the rules need to know about the holdings on file: accounts, deposits and the purchases and sales in the CAS. */
export function classifyContext(loaded: LoadedPortfolio, config: AppConfig): ClassifyContext {
  const owner = new Map(loaded.assetRows.map((a) => [a.id, a.owner_id]));
  const fundTxns: ClassifyContext['fundTxns'] = [];
  for (const [assetId, rows] of loaded.engine?.fundLines ?? new Map()) {
    const ownerId = owner.get(assetId);
    if (!ownerId) continue;
    for (const r of rows) {
      const kind = String(r.kind ?? '');
      const amount = Math.abs(Number(r.amount));
      if (!(amount > 0)) continue;
      const side =
        kind === 'purchase' || kind === 'sip'
          ? 'buy'
          : kind === 'redeem' || kind === 'dividend_payout'
            ? 'sell'
            : null;
      if (side) fundTxns.push({ ownerId, date: String(r.txn_on), amount, side });
    }
  }
  return {
    accounts: loaded.assetRows
      .filter((a) => a.type === 'bank_account')
      .map((a) => ({ assetId: a.id, ownerId: a.owner_id, last4: a.identifier_last4 ?? null })),
    deposits: loaded.fdRows.map((f) => ({
      assetId: f.asset_id,
      ownerId: owner.get(f.asset_id) ?? '',
      principal: Number(f.principal),
      bookedOn: f.booked_on,
      maturityOn: f.maturity_on,
      endedOn: f.ended_on ?? null,
      maturityAmount: f.bank_maturity_amount === null ? null : Number(f.bank_maturity_amount),
    })),
    fundTxns,
    rentWords: config.statements.rentWords,
    remittanceWords: config.statements.remittanceWords,
    reviewAbove: config.statements.reviewAbove,
    pairDays: config.estimates.transferPairDays,
    fundDays: config.statements.fundMatchDays,
  };
}

/** The stored lines as the rules read them. */
export function stmtLinesOf(lines: StoredLine[], loaded: LoadedPortfolio): StmtLine[] {
  const owner = new Map(loaded.assetRows.map((a) => [a.id, a.owner_id]));
  return lines.map((l) => ({
    id: l.id,
    assetId: l.asset_id,
    ownerId: owner.get(l.asset_id) ?? '',
    date: l.txn_on,
    amount: l.amount,
    narration: l.narration,
    answer: l.answer,
  }));
}

export interface StatementPicture {
  lines: StmtLine[];
  classified: Classified[];
  interest: StatementInterestRow[];
  moves: StatementMove[];
}

/** Every line sorted, the yearly interest compared, and the movements that follow. */
export function statementPicture(
  stored: { lines: StoredLine[]; statements: StoredStatement[] },
  loaded: LoadedPortfolio,
  config: AppConfig,
  position: PositionInput,
): StatementPicture {
  const lines = stmtLinesOf(stored.lines, loaded);
  const classified = classifyLines(lines, classifyContext(loaded, config));
  const interest = statementInterest({
    lines,
    classified,
    coverage: stored.statements.map((s) => ({ assetId: s.asset_id, from: s.from_on, to: s.to_on })),
    position,
  });
  return {
    lines,
    classified,
    interest,
    moves: [...statementMoves(lines, classified), ...statementInterestMoves(interest)],
  };
}

/**
 * Makes the stored movements that come from statements (idem keys starting `stmt:`) match `moves` exactly: removes the ones no longer
 * there or changed, and adds the new ones. Every other movement is left alone.
 */
export async function syncStatementMoves(
  supabase: SupabaseClient,
  householdId: string,
  moves: StatementMove[],
): Promise<{ added: number; removed: number }> {
  const existing = await pageAll<{
    id: string;
    idem_key: string;
    amount: number;
    moved_on: string;
  }>((from, to) =>
    supabase
      .from('money_moves')
      .select('id, idem_key, amount, moved_on')
      .eq('household_id', householdId)
      .like('idem_key', 'stmt:%')
      .range(from, to),
  );
  const want = new Map(moves.map((m) => [m.idemKey, m]));
  const keep = new Set<string>();
  const drop: string[] = [];
  for (const e of existing) {
    const w = want.get(e.idem_key);
    if (w && Math.abs(Number(e.amount) - w.amount) < 0.005 && e.moved_on === w.movedOn)
      keep.add(e.idem_key);
    else drop.push(e.id);
  }
  for (let i = 0; i < drop.length; i += 200) {
    const { error } = await supabase
      .from('money_moves')
      .delete()
      .in('id', drop.slice(i, i + 200));
    if (error) throw new Error(error.message);
  }
  const add = moves
    .filter((m) => !keep.has(m.idemKey))
    .map((m) => ({
      household_id: householdId,
      moved_on: m.movedOn,
      amount: m.amount,
      from_asset_id: m.fromAssetId,
      to_asset_id: m.toAssetId,
      kind: m.kind,
      status: 'confirmed',
      source: 'statement',
      note: m.note,
      idem_key: m.idemKey,
    }));
  for (let i = 0; i < add.length; i += 500) {
    const { error } = await supabase.from('money_moves').insert(add.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  return { added: add.length, removed: drop.length };
}
