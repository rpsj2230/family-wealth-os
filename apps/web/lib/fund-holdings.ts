import { isEstimatedTxn, type FundHolding, type PerfFundIn } from '@fwos/core';
import type { FundRow } from './investments';

/**
 * A fund as the shared period-gain figures read it: its value on each day that is measured and its cash flows, exactly the two things
 * the Investments performance tab is built from, so the same period gives the same rupees on both. The flows are the statement's, or
 * (marked estimated) rebuilt from the start date and SIP plan.
 *
 * The figures rest on estimates from the first day of the history when there is no statement or the flows come from the plan, and
 * from the first instalment assumed from the SIP plan when the ledger has one.
 */
export function fundHoldingOf(f: FundRow): FundHolding {
  const assumed = f.txns
    .filter((t) => t.source === 'estimate' || isEstimatedTxn(t))
    .map((t) => t.date)
    .sort()[0];
  const planned = f.flowsEstimated || !f.hasStatement;
  return {
    assetId: f.assetId,
    name: f.name,
    value: f.value,
    points: f.periodPoints.map((p) => ({ date: p.date, value: p.value })),
    flows: f.flows,
    hasStatement: f.hasStatement,
    estimatedSince: planned ? (f.perf[0]?.date ?? f.startedOn ?? '0000-01-01') : (assumed ?? null),
  };
}

/**
 * The same fund as the Investments performance and profit-and-loss figures read it: its values over time and cash flows, with the
 * same estimated-since day as the shared period figures, so a period carries the same est. mark on both.
 */
export const perfFundIn = (f: FundRow): PerfFundIn => ({
  assetId: f.assetId,
  perf: f.perf,
  flows: f.flows,
  flowsEstimated: f.flowsEstimated,
  estimatedSince: fundHoldingOf(f).estimatedSince,
  value: f.value,
});
