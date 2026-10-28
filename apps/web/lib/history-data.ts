import {
  addDaysIso,
  capitalLedger,
  historyReview,
  type AppConfig,
  type HistoryReview,
} from '@fwos/core';
import { capitalDays, capitalStart, ledgerMovesOf, loadPositionInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { loadPortfolio } from './portfolio-data';

/** An answer you gave for an earlier month (a confirmed movement with a `hist:` key), so it can be shown and undone. */
export interface HistoryAnswer {
  key: string;
  on: string;
  amount: number;
  kind: string;
  assetId: string | null;
}

/**
 * Explain movements > Earlier months: the capital ledger from the opening date (the same one Home shows), the months whose money is
 * not yet explained, largest first, and the answers already given. Months inside the recent window are left to the recent list.
 */
export async function loadHistoryReview(
  supabase: SupabaseClient,
  loaded: Awaited<ReturnType<typeof loadPortfolio>>,
  config: AppConfig,
  recentDays: number,
): Promise<{ review: HistoryReview; answers: HistoryAnswer[]; opening: string | null }> {
  const today = loaded.today.toISOString().slice(0, 10);
  const position = await loadPositionInput(supabase, loaded, {
    config,
    days: capitalDays(capitalStart(loaded, config), today, config.home.changeDays),
  });
  const ledger = capitalLedger({
    position,
    moves: ledgerMovesOf(loaded.engine.moves),
    openingDate: config.capital.openingDate || null,
  });
  const review = historyReview({
    ledger,
    position,
    minimum: config.capital.reviewMinimum,
    pairMonths: config.capital.reviewPairMonths,
    before: addDaysIso(today, -recentDays),
    limit: 20,
  });
  const answers = loaded.engine.moves
    .filter((m) => m.status === 'confirmed' && m.idemKey?.startsWith('hist:'))
    .map((m) => ({
      key: m.idemKey!,
      on: m.movedOn,
      amount: m.amount,
      kind: m.kind,
      assetId: m.toAssetId ?? m.fromAssetId,
    }))
    .sort((a, b) => b.on.localeCompare(a.on));
  return { review, answers, opening: ledger.opening?.date ?? null };
}
