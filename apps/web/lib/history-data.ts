import {
  addDaysIso,
  capitalLedger,
  historyReview,
  type AppConfig,
  type HistoryReview,
} from '@fwos/core';
import {
  ALERTS_FILE,
  capitalDays,
  capitalStart,
  ledgerMovesOf,
  loadPositionInput,
} from '@fwos/data';
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
    reinvestDays: config.harvest.reinvestDays,
  });
  // the days each account's bank statements cover: a month they cover for every account that moved is decided by its lines
  const { data: stmts } = await supabase
    .from('bank_statements')
    .select('asset_id, from_on, to_on')
    // the bank's alerts are one running file from the first alert to the last: they cover no month in full
    .neq('file_label', ALERTS_FILE);
  const review = historyReview({
    ledger,
    position,
    coverage: (stmts ?? []).map((x) => ({
      assetId: x.asset_id as string,
      from: x.from_on as string,
      to: x.to_on as string,
    })),
    minimumPct: config.capital.reviewMinimumPct,
    minimum: config.capital.reviewMinimum,
    pairMonths: config.capital.reviewPairMonths,
    before: addDaysIso(today, -recentDays),
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
