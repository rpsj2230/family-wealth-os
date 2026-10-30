import {
  DEFAULT_CONFIG,
  DEFAULT_SETTINGS,
  bankGrowth,
  bankPosition,
  DEFAULT_HOME_RANGE,
  openingDateOf,
  settingsFromJson,
  type AppConfig,
  type BankGrowth,
} from '@fwos/core';
import { capitalDays, capitalStart, ledgerMovesOf, loadPositionInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { demoHomeInput } from './demo-home';
import type { loadPortfolio } from './portfolio-data';

const BANK_TYPES = new Set(['bank_account', 'fixed_deposit']);

/** A row of the bank blocks, as far as the growth figures need it. */
export interface GrowthRow {
  status: string;
  current: number | null;
  accountKind?: string | null;
  fd: { principal: number; bookedOn: string; rate: number; needsConfirmation?: boolean } | null;
}

/** The running deposits as Home counts them: active, and not waiting to be confirmed after their date. */
export function runningOf(rows: GrowthRow[]) {
  return rows.filter((r) => r.fd && r.status === 'active' && !r.fd.needsConfirmation);
}

/**
 * How the money in banks is growing (core bank-growth.ts), for Accounts and Deposits: the capital ledger over the bank holdings of the
 * household, or of one person, valued on the same days Home values them. Null when it cannot be worked out, so the page still draws.
 */
export async function loadBankGrowth(
  supabase: SupabaseClient,
  loaded: Awaited<ReturnType<typeof loadPortfolio>>,
  config: AppConfig,
  opts: { owner: string | null; rows: GrowthRow[]; fdNow: number; cashNow: number },
): Promise<BankGrowth | null> {
  try {
    const today = loaded.today.toISOString().slice(0, 10);
    const banks = {
      ...loaded,
      assetRows: loaded.assetRows.filter(
        (a) => BANK_TYPES.has(a.type) && (opts.owner === null || a.owner_id === opts.owner),
      ),
    };
    const start = capitalStart(loaded, config);
    const position = await loadPositionInput(supabase, banks, {
      config,
      days: capitalDays(start, today, config.home.changeDays),
    });
    return bankGrowth({
      position: bankPosition(position, opts.owner),
      moves: ledgerMovesOf(loaded.engine.moves),
      openingDate: start,
      reinvestDays: config.harvest.reinvestDays,
      deposits: runningOf(opts.rows).map((r) => ({
        principal: r.fd!.principal,
        bookedOn: r.fd!.bookedOn,
        value: r.current ?? 0,
      })),
      fdNow: opts.fdNow,
      cashNow: opts.cashNow,
      rateRows: runningOf(opts.rows).map((r) => ({
        principal: r.fd!.principal,
        rate: r.fd!.rate,
        kind: r.accountKind ?? null,
      })),
      nroTaxRate: config.rates.nroTaxRate,
    });
  } catch {
    return null;
  }
}

/** The retirement plan's inflation, the mark on the growth strip; null when it cannot be read. */
export async function loadInflation(supabase: SupabaseClient): Promise<number | null> {
  try {
    const { data } = await supabase.from('plan_settings').select('settings').maybeSingle();
    return settingsFromJson((data as { settings?: unknown } | null)?.settings).assumptions
      .inflation;
  } catch {
    return null;
  }
}

/**
 * The same figures for the public sample: the ledger over the sample Home values (demo-home.ts), narrowed to the bank holdings, from
 * the household's own opening day, so the sample's Accounts and Deposits show exactly the rates its Home shows.
 */
export function demoBankGrowth(opts: {
  owner: string | null;
  rows: GrowthRow[];
  fdNow: number;
  cashNow: number;
}): BankGrowth {
  const position = demoHomeInput(DEFAULT_HOME_RANGE).position;
  const running = runningOf(opts.rows);
  return bankGrowth({
    position: bankPosition(position, opts.owner),
    openingDate: openingDateOf(position),
    moves: [],
    deposits: running.map((r) => ({
      principal: r.fd!.principal,
      bookedOn: r.fd!.bookedOn,
      value: r.current ?? 0,
    })),
    fdNow: opts.fdNow,
    cashNow: opts.cashNow,
    rateRows: running.map((r) => ({
      principal: r.fd!.principal,
      rate: r.fd!.rate,
      kind: r.accountKind ?? null,
    })),
    nroTaxRate: DEFAULT_CONFIG.rates.nroTaxRate,
  });
}

/** The sample's inflation mark: the retirement plan's default. */
export const DEMO_INFLATION = DEFAULT_SETTINGS.assumptions.inflation;
