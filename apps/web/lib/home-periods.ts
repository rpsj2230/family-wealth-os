import {
  bankRowFigures,
  cashBlocks,
  type AssetRow,
  type BankBlock,
  type DepositTerms,
  type FdRow,
  type ObservationRow,
  type OverviewOptions,
  type SavingsAccount,
} from '@fwos/core';

/**
 * What the profit-by-period figures on Home need besides the funds: every fixed deposit with its terms and whether it is still held
 * (a deposit gifted away was never part of the wealth and is left out), and the recorded balances of every savings account that is
 * counted. A savings account earns at the rate it shows on Accounts: its own, else the Rates list, else the assumed rate in
 * Settings, after the tax taken at source; foreign-currency accounts are listed so they can be counted, with no balances to earn on.
 */
export function periodInputs(args: {
  assetRows: AssetRow[];
  fdRows: FdRow[];
  obsRows: ObservationRow[];
  blocks: BankBlock[];
  overview: Pick<OverviewOptions, 'savingsRates' | 'defaultSavingsRate' | 'tdsRate'>;
}): { deposits: DepositTerms[]; accounts: SavingsAccount[] } {
  const asset = new Map(args.assetRows.map((a) => [a.id, a]));
  const deposits: DepositTerms[] = args.fdRows.flatMap((f) => {
    const a = asset.get(f.asset_id);
    if (!a || a.status === 'gifted') return [];
    return [
      {
        assetId: f.asset_id,
        principal: f.principal,
        rate: f.rate,
        bookedOn: f.booked_on,
        maturityOn: f.maturity_on,
        compounding: f.compounding,
        // the same rule as the Deposits figures and net worth: a running deposit is held, even past its date
        held: a.status === 'active',
      },
    ];
  });

  const balances = new Map<string, { date: string; amount: number }[]>();
  // the same records the portfolio values an account from (any kind, newest wins on a day), oldest entered first
  const entered = [...args.obsRows].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const o of entered) {
    if (o.superseded_by) continue;
    const list = balances.get(o.asset_id) ?? balances.set(o.asset_id, []).get(o.asset_id)!;
    list.push({ date: o.as_of, amount: o.amount });
  }
  const accounts: SavingsAccount[] = cashBlocks(args.blocks).flatMap((b) =>
    b.sections.flatMap((s) =>
      s.rows
        .filter((r) => bankRowFigures(r).counted)
        .map((r) => ({
          assetId: r.assetId,
          currency: r.currency,
          rate: args.overview.savingsRates?.[r.assetId] ?? args.overview.defaultSavingsRate,
          tdsRate: args.overview.tdsRate ?? 0,
          balances: r.currency === 'INR' ? (balances.get(r.assetId) ?? []) : [],
        })),
    ),
  );
  return { deposits, accounts };
}
