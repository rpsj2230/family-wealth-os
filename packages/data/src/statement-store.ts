import {
  addDaysIso,
  classifyLines,
  personNamed,
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
  type StatementRule,
  type StmtLine,
} from '@fwos/core';
import type { LoadedPortfolio } from './index';
import { pageAll } from './paging';
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
export interface StoredBankStatement {
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

/** What two copies of one bank line share whatever file they came from: the day, the signed amount and the words. */
export interface TwinLine {
  txn_on: string;
  amount: number;
  narration: string;
}

/**
 * Pairs lines saved without a balance (a download that prints none, kept "lines only") with the same lines from a statement that
 * has balances. Their keys differ because the balance is part of the key, so the second file would otherwise add every line again.
 * Lines pair on the same day and amount; within that, the same words first, then the rest in order (six deposits of ₹1 L booked on
 * one day are interchangeable). Each line is used once.
 */
export function balanceLessTwins<A extends TwinLine, B extends TwinLine>(
  bare: A[],
  full: B[],
): [A, B][] {
  const group = <T extends TwinLine>(ls: T[]) => {
    const m = new Map<string, T[]>();
    for (const l of ls) {
      const k = `${l.txn_on}|${cents(l.amount)}`;
      m.set(k, [...(m.get(k) ?? []), l]);
    }
    return m;
  };
  const fulls = group(full);
  const out: [A, B][] = [];
  for (const [k, bs] of group(bare)) {
    const left = [...(fulls.get(k) ?? [])];
    const rest: A[] = [];
    for (const b of bs) {
      const i = left.findIndex((f) => f.narration === b.narration);
      if (i >= 0) out.push([b, left.splice(i, 1)[0]!]);
      else rest.push(b);
    }
    for (const b of rest) if (left.length) out.push([b, left.shift()!]);
  }
  return out;
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
/** A transfer from Singapore on file (Wise), as the rules read it. */
export type StoredRemittance = NonNullable<ClassifyContext['remittances']>[number];

/** `householdId` is needed when the caller is not a signed-in member (a job); a member's reads are limited to the household anyway. */
export async function loadStatements(
  supabase: SupabaseClient,
  householdId?: string,
): Promise<{
  lines: StoredLine[];
  statements: StoredBankStatement[];
  remittances: StoredRemittance[];
  /** your rules for statement lines (statement_rules) */
  rules: StatementRule[];
}> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the query builders of three tables, narrowed alike
  const scoped = (q: any) => (householdId ? q.eq('household_id', householdId) : q);
  const [lines, statements, remits, rules] = await Promise.all([
    pageAll<StoredLine>((from, to) =>
      scoped(
        supabase
          .from('statement_lines')
          .select('id, statement_id, asset_id, txn_on, amount, balance, narration, answer'),
      )
        .order('txn_on')
        .order('id')
        .range(from, to),
    ),
    pageAll<StoredBankStatement>((from, to) =>
      scoped(
        supabase
          .from('bank_statements')
          .select(
            'id, asset_id, from_on, to_on, opening, closing, line_count, breaks, layout, file_label, uploaded_at',
          ),
      )
        .order('from_on')
        .range(from, to),
    ),
    pageAll<{
      id: string;
      received_on: string;
      amount_inr: number;
      to_asset_id: string | null;
      to_basis: string | null;
      from_asset_id: string | null;
    }>((from, to) =>
      scoped(
        supabase
          .from('remittances')
          .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id'),
      )
        .order('received_on')
        .range(from, to),
    ),
    // before the table existed (an older database) there are simply no rules
    (async () => {
      const { data, error } = await scoped(
        supabase
          .from('statement_rules')
          .select('id, name, match, action, asset_id, direction, interest')
          .order('created_at'),
      );
      return error ? [] : ((data ?? []) as Record<string, unknown>[]);
    })(),
  ]);
  return {
    remittances: remits.map((r) => ({
      id: r.id,
      date: r.received_on,
      amount: Number(r.amount_inr),
      // only a proven account limits which credit can be the transfer; a guess must not stop a statement correcting it
      toAssetId: r.to_basis === 'statement' || r.to_basis === 'person' ? r.to_asset_id : null,
      fromAssetId: r.from_asset_id,
    })),
    lines: lines.map((l) => ({
      ...l,
      amount: Number(l.amount),
      balance: l.balance === null ? null : Number(l.balance),
    })),
    statements,
    rules: rules.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      match: r.match === 'words' ? 'words' : 'name',
      action: r.action as StatementRule['action'],
      assetId: (r.asset_id as string | null) ?? null,
      direction: (r.direction as StatementRule['direction']) ?? 'any',
      interest: !!r.interest,
    })),
  };
}

/** The name an account is held in, when it is not one of the household's people (whose own names banks also print). */
function heldByOther(holder: string | null, loaded: LoadedPortfolio): string | null {
  if (!holder?.trim()) return null;
  const people = [...loaded.ownerName.values()].map((name) => ({ name }));
  return personNamed(holder, people) ? null : holder.trim();
}

/** The Singapore account money sent to India leaves: the one most transfers on file come from, else the only Singapore DBS account. */
function singaporeOf(loaded: LoadedPortfolio, remittances: StoredRemittance[]): string | null {
  const count = new Map<string, number>();
  for (const r of remittances)
    if (r.fromAssetId) count.set(r.fromAssetId, (count.get(r.fromAssetId) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1])[0];
  if (top) return top[0];
  const dbs = loaded.assetRows.filter(
    (a) =>
      a.type === 'bank_account' &&
      a.currency !== 'INR' &&
      /^dbs\b/i.test(loaded.institutionName?.get(a.institution_id ?? '') ?? ''),
  );
  return dbs.length === 1 ? dbs[0]!.id : null;
}

/** What the rules need to know about the holdings on file: accounts, deposits and the purchases and sales in the CAS. */
export function classifyContext(
  loaded: LoadedPortfolio,
  config: AppConfig,
  remittances: StoredRemittance[] = [],
  rules: StatementRule[] = [],
): ClassifyContext {
  const owner = new Map(loaded.assetRows.map((a) => [a.id, a.owner_id]));
  const bankOf = new Map(
    loaded.assetRows.map((a) => [
      a.id,
      a.institution_id ? (loaded.institutionName?.get(a.institution_id) ?? null) : null,
    ]),
  );
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
      if (side) fundTxns.push({ ownerId, assetId, date: String(r.txn_on), amount, side });
    }
  }
  return {
    accounts: loaded.assetRows
      .filter((a) => a.type === 'bank_account')
      .map((a) => ({
        assetId: a.id,
        ownerId: a.owner_id,
        last4: a.identifier_last4 ?? null,
        bank: a.institution_id ? (loaded.institutionName?.get(a.institution_id) ?? null) : null,
        // held in the name of someone outside the household (an account you use in a relative's name)
        heldBy: heldByOther(a.holder_name ?? null, loaded),
      })),
    // the household's people by their first names, as banks write them in narrations
    people: [...loaded.ownerName].map(([ownerId, name]) => ({
      ownerId,
      names: name.split(/\s+/).filter((n) => n.length >= 4),
    })),
    // the Singapore account money from abroad leaves: the one the transfers on file come from, else the only DBS account
    singaporeAssetId: singaporeOf(loaded, remittances),
    deposits: loaded.fdRows.map((f) => ({
      assetId: f.asset_id,
      ownerId: owner.get(f.asset_id) ?? '',
      bank: bankOf.get(f.asset_id) ?? null,
      principal: Number(f.principal),
      bookedOn: f.booked_on,
      maturityOn: f.maturity_on,
      endedOn: f.ended_on ?? null,
      maturityAmount: f.bank_maturity_amount === null ? null : Number(f.bank_maturity_amount),
    })),
    fundTxns,
    // the people money was lent to, by their "Loan to …" records (a gift is spending, not a loan)
    borrowers: loaded.assetRows
      .filter((a) => a.type === 'receivable' && a.status !== 'gifted' && a.status !== 'merged')
      .map((a) => ({ assetId: a.id, name: a.nickname.replace(/^(loan|money lent)\s+to\s+/i, '') })),
    rules,
    rentWords: config.statements.rentWords,
    remittanceWords: config.statements.remittanceWords,
    reviewAbove: config.statements.reviewAbove,
    pairDays: config.estimates.transferPairDays,
    fundDays: config.statements.fundMatchDays,
    remittances,
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
  stored: {
    lines: StoredLine[];
    statements: StoredBankStatement[];
    remittances: StoredRemittance[];
    rules?: StatementRule[];
  },
  loaded: LoadedPortfolio,
  config: AppConfig,
  position: PositionInput,
): StatementPicture {
  const lines = stmtLinesOf(stored.lines, loaded);
  const classified = classifyLines(
    lines,
    classifyContext(loaded, config, stored.remittances, stored.rules ?? []),
  );
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
