import { buildLedger, type PersonStyle } from '@fwos/core';
import type { LedgerEntry } from '@/components/invest/Ledger';
import type { FundEditRow } from './fund-edit';
import type { FundRow, InvestmentView } from './investments';

/** Every transaction of every fund shown, each with the fund and the person, for the household ledger. */
export function householdLedger(
  view: InvestmentView,
  styles: Record<string, PersonStyle>,
): LedgerEntry[] {
  return view.groups.flatMap((g) =>
    g.funds.flatMap((f) =>
      buildLedger({
        txns: f.txns,
        navs: [],
        navNow: f.nav,
        today: view.today,
        holdingMonths: f.taxClass === 'equity' ? view.holdingMonths : null,
        gapDays: view.config.navGapDays,
      }).map((r): LedgerEntry => ({
        ...r,
        assetId: f.assetId,
        fund: f.label || f.name,
        owner: g.name,
        ownerColour: styles[g.ownerId]?.colour ?? '',
      })),
    ),
  );
}

/** What the edit panel needs to know about a fund. */
export function fundEditRow(f: FundRow, ownerName: string): FundEditRow {
  return {
    id: f.assetId,
    name: f.name,
    label: f.label ?? '',
    ownerId: f.ownerId,
    ownerName,
    units: f.units,
    nav: f.nav,
    value: f.value,
    invested: f.invested,
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    startedOn: f.startedOn ?? '',
    plan: f.plan,
    goalIds: f.goalIds,
    closed: f.status === 'closed',
    exitLoadPct: f.exitLoadPct,
    exitLoadDays: f.exitLoadDays,
    amfiCode: f.amfiCode,
    hasStatement: f.hasStatement,
  };
}

export const fundEditRows = (view: InvestmentView): FundEditRow[] =>
  view.groups.flatMap((g) => g.funds.map((f) => fundEditRow(f, g.name)));
