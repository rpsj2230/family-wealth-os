import {
  allowanceUsed,
  effectiveRules,
  fundTaxPanel,
  fyStartOf,
  planHarvest,
  realisedSince,
  type FundTaxPanel,
  type HarvestPosition,
} from '@fwos/core';
import type { FundRow, InvestmentView } from './investments';

/**
 * The funds of a person as the harvest planner takes them. The lots, prices and exit loads are the ones the Investments page already
 * worked out, so the fund page and the Tax page rest on the same units.
 */
export function harvestPositionsOf(funds: FundRow[]): HarvestPosition[] {
  return funds
    .filter((f) => f.status !== 'closed')
    .map((f) => ({
      assetId: f.assetId,
      ownerId: f.ownerId,
      fund: f.name,
      value: f.value,
      invested: f.invested,
      startedOn: f.startedOn,
      sipActive: !!f.sipMonthly && !f.sipStopped,
      taxClass: f.taxClass,
      classCertain: f.taxInfo.certain,
      nav: f.nav,
      lockInMonths: f.taxInfo.lockInMonths,
      ...(f.exitLoadPct !== null && f.exitLoadDays !== null
        ? { exitLoad: { pct: f.exitLoadPct, days: f.exitLoadDays } }
        : {}),
      ...(f.lots.length > 0
        ? {
            lots: f.lots.map((l) => ({
              acquiredOn: l.acquiredOn,
              units: l.units,
              cost: l.cost,
              ...(l.estimated ? { estimated: true } : {}),
            })),
          }
        : {}),
    }));
}

/** The exit-load and tax panel of one fund: its lots, the exit load and the harvest advice for its owner this financial year. */
export function buildFundTax(view: InvestmentView, fund: FundRow): FundTaxPanel {
  const mine = view.groups.flatMap((g) => g.funds).filter((f) => f.ownerId === fund.ownerId);
  const eff = effectiveRules(view.today, view.tax.rules);
  const months = eff?.rules.equity.holdingMonthsLong ?? null;
  // gains already booked this year by this person's equity funds use up part of the tax-free allowance
  const booked =
    months === null
      ? { stcg: 0, ltcg: 0 }
      : realisedSince({
          sold: mine.filter((f) => f.taxClass === 'equity').flatMap((f) => f.realised),
          fyStart: fyStartOf(view.today),
          holdingMonths: months,
        });
  const plan = planHarvest(harvestPositionsOf(mine), view.today, {
    ytdRealised: { [fund.ownerId]: allowanceUsed(booked) },
    rules: view.tax.rules,
    config: view.tax.harvest,
  });
  const first = fund.ledger.firstTxnOn;
  return fundTaxPanel(
    {
      assetId: fund.assetId,
      ownerId: fund.ownerId,
      taxClass: fund.taxClass,
      classLabel: fund.taxInfo.label,
      classCertain: fund.taxInfo.certain,
      classNote: fund.taxInfo.note,
      lots: fund.lots,
      lotsBasis: fund.lotsBasis,
      nav: fund.nav,
      units: fund.units,
      value: fund.value,
      exitLoad:
        fund.exitLoadPct !== null && fund.exitLoadDays !== null
          ? { pct: fund.exitLoadPct, days: fund.exitLoadDays }
          : null,
      lockInMonths: fund.taxInfo.lockInMonths,
      firstTxnOn: first,
      ledgerStatus: fund.ledger.status,
    },
    {
      today: view.today,
      rules: view.tax.rules,
      config: view.tax.harvest,
      plan,
      setExitLoadHref: `?edit=${fund.assetId}`,
    },
  );
}
