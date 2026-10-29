import {
  classifyLines,
  LINE_CLASS_LABEL,
  moneyTrail,
  type Classified,
  type Hop,
  trailLines,
  type Trail,
  type TrailAsset,
  type TrailLine,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';
import {
  classifyContext,
  loadStatements,
  stmtLinesOf,
  type StoredBankStatement,
  type StoredLine,
} from './statement-store';

export interface MoneyTrailData {
  trails: Map<string, Trail>;
  /** each holding's owner and whether it has statements (its trail is complete) or only transfers from Singapore */
  holdings: {
    id: string;
    ownerId: string;
    kind: 'account' | 'deposit' | 'fund';
    statements: boolean;
  }[];
  remittances: { count: number; amount: number; proven: number; placed: number };
  ownershipFrom: string;
  /** every statement line, and what the rules make of each */
  lines: StoredLine[];
  statements: StoredBankStatement[];
  classified: Map<string, Classified>;
  /** the transfers from Singapore on file, by id */
  remitById: Map<string, { receivedOn: string; amount: number }>;
}

/**
 * Everything the money trail is worked out from: the statement lines as the rules read them, the transfers from Singapore (for an
 * account with no statements, they are its only known source), the deposits on file and each account's balance before its first
 * statement.
 */
export async function loadMoneyTrail(
  db: SupabaseClient,
  householdId?: string,
  /** what the page already loaded, so it is not read twice */
  preloaded?: LoadedPortfolio,
): Promise<MoneyTrailData> {
  // the portfolio, the settings, the statement lines and the transfers are read at once
  const remitsP = pageAll<{
    id: string;
    received_on: string;
    amount_inr: number;
    to_asset_id: string | null;
    to_basis: string | null;
    from_asset_id: string | null;
  }>((a, b) => {
    const q = db
      .from('remittances')
      .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id')
      .order('id');
    return (householdId ? q.eq('household_id', householdId) : q).range(a, b);
  });
  const [loaded, { config }, stored, remits] = await Promise.all([
    preloaded ?? loadPortfolioData(db, householdId ? { householdId } : {}),
    loadSettings(db, householdId),
    loadStatements(db, householdId),
    remitsP,
  ]);
  const lines = stmtLinesOf(stored.lines, loaded);
  const classified = classifyLines(lines, classifyContext(loaded, config, stored.remittances));
  const tl: TrailLine[] = trailLines(lines, classified);

  // transfers from Singapore into an account with no statement: the only movements known for it
  const withLines = new Set(stored.lines.map((l) => l.asset_id));
  for (const r of remits)
    if (r.to_asset_id && !withLines.has(r.to_asset_id))
      tl.push({
        id: `remit:${r.id}`,
        assetId: r.to_asset_id,
        date: r.received_on,
        amount: Number(r.amount_inr),
        cls: 'own_transfer',
        counterpart: r.from_asset_id,
        narration: 'Transfer from Singapore (Wise)',
      });

  // each account's balance before its first statement
  const openings = new Map<string, number>();
  for (const s of [...stored.statements].sort((a, b) => a.from_on.localeCompare(b.from_on)))
    if (!openings.has(s.asset_id) && s.opening !== null)
      openings.set(s.asset_id, Number(s.opening));

  const kindOf = {
    bank_account: 'account',
    fixed_deposit: 'deposit',
    mutual_fund: 'fund',
  } as const;
  const assets: TrailAsset[] = loaded.assetRows
    .filter((a) => a.type in kindOf)
    .map((a) => ({
      id: a.id,
      ownerId: a.owner_id,
      kind: kindOf[a.type as keyof typeof kindOf],
      ...(a.type === 'bank_account' && a.currency !== 'INR' ? { abroad: true } : {}),
    }));
  const trails = moneyTrail({
    lines: tl,
    assets,
    openings,
    ownershipFrom: config.capital.ownershipFrom,
  });
  const holdings = assets
    .filter((a) => !a.abroad && trails.has(a.id))
    .map(({ id, ownerId, kind }) => ({ id, ownerId, kind, statements: withLines.has(id) }));
  return {
    trails,
    holdings,
    remittances: {
      count: remits.length,
      amount: remits.reduce((s, r) => s + Number(r.amount_inr), 0),
      proven: remits.filter((r) => r.to_basis === 'statement').length,
      placed: remits.filter((r) => r.to_asset_id).length,
    },
    ownershipFrom: config.capital.ownershipFrom,
    lines: stored.lines,
    statements: stored.statements,
    classified: new Map(classified.map((c) => [c.id, c])),
    remitById: new Map(
      remits.map((r) => [r.id, { receivedOn: r.received_on, amount: Number(r.amount_inr) }]),
    ),
  };
}

/** A statement line as the account page lists it. */
export interface AccountLine {
  id: string;
  date: string;
  amount: number;
  balance: number | null;
  narration: string;
  /** what the rules make of it, in a few words */
  kind: string;
  /** still waiting for an answer */
  toAnswer: boolean;
}

/** Every statement line of one account, newest first. */
export function accountLines(t: MoneyTrailData, assetId: string): AccountLine[] {
  return t.lines
    .filter((l) => l.asset_id === assetId)
    .map((l) => {
      const c = t.classified.get(l.id);
      return {
        id: l.id,
        date: l.txn_on,
        amount: Number(l.amount),
        balance: l.balance === null ? null : Number(l.balance),
        narration: l.narration,
        kind: c ? LINE_CLASS_LABEL[c.cls] : 'Not sorted yet',
        toAnswer: !c || c.cls === 'ask_in' || c.cls === 'ask_out',
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

/** One statement line in full: what it is, why the rules say so, and its trail. */
export interface LineDetail {
  line: AccountLine & { assetId: string };
  reason: string;
  /** the account, deposit or fund on the other side, when known */
  counterpart: string | null;
  /** the person named on the other side */
  person: string | null;
  /** the statement file it came from */
  statement: { from: string; to: string; label: string | null } | null;
  /** the transfer from Singapore it is, when it is one */
  remittance: { receivedOn: string; amount: number } | null;
  /** its movement in the trail: what it brought in, or what it took out */
  hop: Hop | null;
  /** the line on the other side of the transfer, when both sides are statement lines */
  pair: (AccountLine & { assetId: string }) | null;
  /** for money out: the money that came into the account in the weeks before, which it was made of */
  before: Hop[];
}

export function lineDetail(t: MoneyTrailData, lineId: string): LineDetail | null {
  const l = t.lines.find((x) => x.id === lineId);
  if (!l) return null;
  const asLine = (x: StoredLine) => ({
    ...accountLines(t, x.asset_id).find((a) => a.id === x.id)!,
    assetId: x.asset_id,
  });
  const c = t.classified.get(l.id);
  const tr = t.trails.get(l.asset_id);
  const hop = (Number(l.amount) >= 0 ? tr?.hops : tr?.outs)?.find((h) => h.lineId === l.id) ?? null;
  const pairLine = hop?.pairLineId ? t.lines.find((x) => x.id === hop.pairLineId) : undefined;
  const st = t.statements.find((s) => s.id === l.statement_id);
  return {
    line: asLine(l),
    reason: c?.reason ?? '',
    counterpart: c?.counterpart ?? null,
    person: c?.person ?? null,
    statement: st ? { from: st.from_on, to: st.to_on, label: st.file_label } : null,
    remittance: c?.remittanceId ? (t.remitById.get(c.remittanceId) ?? null) : null,
    hop,
    pair: pairLine ? asLine(pairLine) : null,
    before:
      Number(l.amount) < 0
        ? (tr?.hops ?? []).filter((h) => h.date <= l.txn_on && h.lineId !== l.id).slice(0, 8)
        : [],
  };
}
