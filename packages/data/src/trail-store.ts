import {
  classifyLines,
  moneyTrail,
  trailLines,
  type Trail,
  type TrailAsset,
  type TrailLine,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { pageAll } from './paging';
import { loadSettings } from './settings';
import { classifyContext, loadStatements, stmtLinesOf } from './statement-store';

export interface MoneyTrailData {
  trails: Map<string, Trail>;
  /** each holding's owner and whether it has statements (its trail is complete) or only transfers from Singapore */
  holdings: { id: string; ownerId: string; kind: 'account' | 'deposit'; statements: boolean }[];
  remittances: { count: number; amount: number; proven: number; placed: number };
  ownershipFrom: string;
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
  const loaded = preloaded ?? (await loadPortfolioData(db, householdId ? { householdId } : {}));
  const { config } = await loadSettings(db, householdId);
  const stored = await loadStatements(db, householdId);
  const lines = stmtLinesOf(stored.lines, loaded);
  const classified = classifyLines(lines, classifyContext(loaded, config, stored.remittances));
  const tl: TrailLine[] = trailLines(lines, classified);

  // transfers from Singapore into an account with no statement: the only movements known for it
  const withLines = new Set(stored.lines.map((l) => l.asset_id));
  const remits = await pageAll<{
    id: string;
    received_on: string;
    amount_inr: number;
    to_asset_id: string | null;
    to_basis: string | null;
    from_asset_id: string | null;
  }>((a, b) => {
    const q = db
      .from('remittances')
      .select('id, received_on, amount_inr, to_asset_id, to_basis, from_asset_id');
    return (householdId ? q.eq('household_id', householdId) : q).range(a, b);
  });
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

  const assets: TrailAsset[] = loaded.assetRows
    .filter((a) => a.type === 'bank_account' || a.type === 'fixed_deposit')
    .map((a) => ({
      id: a.id,
      ownerId: a.owner_id,
      kind: a.type === 'fixed_deposit' ? ('deposit' as const) : ('account' as const),
      ...(a.type === 'bank_account' && a.currency !== 'INR' ? { abroad: true } : {}),
    }));
  const trails = moneyTrail({ lines: tl, assets, openings });
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
  };
}
