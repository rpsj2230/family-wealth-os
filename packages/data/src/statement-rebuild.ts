import { positionInputFrom, type AppConfig, type PositionInput } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData, type LoadedPortfolio } from './index';
import { savingsMovesOf } from './ledger';
import { loadSettings } from './settings';
import { placeRemittances, syncRemittanceMoves } from './remittance-store';
import { loadStatements, statementPicture, syncStatementMoves } from './statement-store';

/** An interest correction (from statements or the AIS): earnings the estimate missed, never part of what the estimate is made from. */
export const isInterestCorrection = (idemKey: string | null) =>
  !!idemKey && (/^stmt:[^:]+:int:/.test(idemKey) || /^ais:/.test(idemKey));

/**
 * The position the engine values everything from, built from what is loaded (the same one Explain movements uses). With
 * `forEstimate`, the interest corrections are left out of the accounts' movements, so an estimate never depends on the corrections
 * made from it.
 */
export function positionFor(
  loaded: LoadedPortfolio,
  config: AppConfig,
  forEstimate = false,
): PositionInput {
  const moves = forEstimate
    ? savingsMovesOf(
        loaded.engine.moves.filter((m) => !isInterestCorrection(m.idemKey)),
        new Set(loaded.assetRows.filter((a) => a.type === 'bank_account').map((a) => a.id)),
      )
    : loaded.engine.extras.moves;
  return positionInputFrom({
    assets: loaded.assetRows,
    observations: [...loaded.obsRows, ...loaded.sheetObs],
    fds: loaded.fdRows,
    config,
    today: loaded.today.toISOString().slice(0, 10),
    ...(moves ? { moves } : {}),
    ...(loaded.engine.extras.rates ? { rates: loaded.engine.extras.rates } : {}),
    ...(loaded.engine.extras.placements ? { placements: loaded.engine.extras.placements } : {}),
  });
}

/**
 * Sorts every statement line again and makes the movements that come from statements match: after a statement is imported or
 * deleted, a line is answered, or a rule in Settings changed.
 */
export async function rebuildStatementMoves(
  supabase: SupabaseClient,
  householdId: string,
): Promise<{ added: number; removed: number; toAnswer: number }> {
  const loaded = await loadPortfolioData(supabase, { householdId });
  const { config } = await loadSettings(supabase, householdId);
  const stored = await loadStatements(supabase, householdId);
  const picture = statementPicture(stored, loaded, config, positionFor(loaded, config, true));
  const r = await syncStatementMoves(supabase, householdId, picture.moves);
  // the transfers from Singapore the statements show, and the movements that follow from where they went
  await placeRemittances(
    supabase,
    householdId,
    picture.classified,
    new Map(stored.lines.map((l) => [l.id, l.asset_id])),
  );
  await syncRemittanceMoves(supabase, householdId);
  return {
    ...r,
    toAnswer: picture.classified.filter((c) => c.cls === 'ask_in' || c.cls === 'ask_out').length,
  };
}
