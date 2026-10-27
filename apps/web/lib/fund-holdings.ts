import { isEstimatedTxn, type FundHolding, type PerfFundIn, type PosFund } from '@fwos/core';
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

/**
 * A fund as the position engine reads it when there is no price list to read (the public sample): its ledger lines and cash flows, and
 * its value on every day the fund series was worked out for, as the values on file. The signed-in page reads the prices themselves
 * (packages/data position.ts) and values the units on each day.
 */
export function posFundOfRow(f: FundRow): PosFund {
  const byDay = new Map<string, number>();
  for (const p of [...f.perf, ...f.periodPoints, ...f.history]) byDay.set(p.date, p.value);
  return {
    txns: f.txns.map((t) => ({
      date: t.date,
      units: t.units,
      amount: t.amount,
      estimated: t.source === 'estimate' || isEstimatedTxn(t),
    })),
    navs: [],
    units: null,
    snapshots: [...byDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, value]) => ({ date, value })),
    flows: f.flows,
    hasStatement: f.hasStatement,
    estimatedSince: fundHoldingOf(f).estimatedSince,
  };
}
