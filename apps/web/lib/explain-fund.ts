import {
  buildFundExplain,
  valuationUnits,
  type ExplainSet,
  type FundExplainInput,
  type FundTaxPanel,
} from '@fwos/core';
import type { FundDetail } from './fund-detail-model';
import type { FundRow } from './investments';

/** The "?" explainers of a fund's page, from the same fund row, detail and tax panel the page draws. */
export function fundExplain(a: {
  fund: FundRow;
  detail: FundDetail;
  tax: FundTaxPanel;
  today: string;
  holdingMonths: number | null;
  /** this page's address with the tab removed (the data check sits on the Overview tab) */
  overviewHref: string;
  importHref: string;
  matchHref: string;
  taxHref: string;
  /** the XIRR of your payments and of the same payments in the benchmark, on the last valuation day */
  sameMoney?: FundExplainInput['sameMoney'];
  /** the fund's own price change over the last year */
  fundReturn1y?: FundExplainInput['fundReturn1y'];
}): ExplainSet<'fund'> {
  const f = a.fund;
  const d = a.detail;
  const v = f.ledger;
  const flowDates = f.flows.map((x) => x.date).sort();
  const sales = f.realised.map((r) => r.soldOn).sort();
  return buildFundExplain({
    today: a.today,
    name: f.label || f.name,
    value: f.value,
    invested: f.invested,
    units: f.units,
    nav: f.nav,
    navDate: f.navDate,
    livePrice: !!f.amfiCode,
    valueBasis: f.valueBasis,
    hasStatement: f.hasStatement,
    ledgerStatus: v.status,
    figuresEstimated: v.figuresEstimated,
    lotsBasis: f.lotsBasis,
    firstTxnOn: v.firstTxnOn,
    lastTxnOn: v.lastTxnOn,
    txnCount: v.txnCount,
    unitsFrom: valuationUnits(v).from,
    positionUnitsAsOf: v.positionUnitsAsOf,
    statementOn: v.statementOn,
    dayAmount: f.dayAmount,
    dayPct: f.dayPct,
    dayFrom: f.dayFrom,
    dayTo: f.dayTo,
    xirr: f.xirr,
    xirrEstimated: f.xirrEstimated,
    flowCount: f.flows.length,
    flowsFrom: flowDates[0] ?? null,
    flowsTo: flowDates.at(-1) ?? null,
    flowsEstimated: f.flowsEstimated,
    avgCost: d.avgCost,
    cagr: d.cagr !== null && d.cagrFrom ? { rate: d.cagr, from: d.cagrFrom } : null,
    sipMonthly: f.sipMonthly,
    sipStopped: f.sipStopped,
    sipNextOn: d.sip.nextOn,
    sipBasis: d.sip.basis,
    realised: {
      sales: d.realised.sales,
      stcg: d.realised.stcg,
      ltcg: d.realised.ltcg,
      other: d.realised.other,
      unknownCost: d.realised.unknownCost,
      proceeds: d.realised.proceeds,
    },
    saleFirst: sales[0] ?? null,
    saleLast: sales.at(-1) ?? null,
    returns: d.returns
      ? {
          basis: d.returns.basis,
          estimated: d.returns.estimated,
          from: d.returns.profile.from,
          to: d.returns.profile.to,
          benchName: d.returns.benchName,
        }
      : null,
    tax: {
      classLabel: a.tax.classLabel,
      classCertain: a.tax.classCertain,
      basis: a.tax.basis,
      estimated: a.tax.estimated,
      exitLoadHeadline: a.tax.exitLoad.headline,
      exitLoadRuleSet: a.tax.exitLoad.source === 'fund',
      lots: a.tax.rows.length,
      stcgUnits: a.tax.totals.stcgUnits,
      ltcgUnits: a.tax.totals.ltcgUnits,
      holdingMonths: a.holdingMonths,
    },
    sameMoney: a.sameMoney ?? null,
    fundReturn1y: a.fundReturn1y ?? null,
    longTerm: d.holding
      ? {
          longValue: d.holding.longValue,
          shortValue: d.holding.shortValue,
          longShare: d.holding.longShare,
          allLongOn: d.holding.allLongOn,
          basis: d.holding.basis,
        }
      : null,
    longTermNote: d.holdingNote,
    links: {
      dataCheck: `${a.overviewHref}#adds-up-h`,
      import: a.importHref,
      match: a.matchHref,
      tax: a.taxHref,
    },
  });
}
