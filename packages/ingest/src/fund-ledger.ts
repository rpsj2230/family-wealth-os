import {
  BEFORE_STATEMENT,
  DEFAULT_CONFIG,
  isEstimateLine,
  ledgerEnds,
  orderLines,
  type StatLot,
  type StatRealised,
} from '@fwos/core';
import { fifoLots, LOT_UNIT_TOLERANCE, type CasTxn } from './cas';

export interface Ledger {
  /** units still held, each purchase on its own line, oldest first; instalments assumed from the SIP plan are last and marked estimated */
  lots: StatLot[];
  /** every sale and the purchases it used, oldest units first */
  realised: StatRealised[];
  /** the lots add up to the units held, so they can be relied on */
  reconciled: boolean;
  /** instalments assumed from the SIP plan since the last real line, appended to the lots as estimates */
  estimatedLots: number;
}

type Line = CasTxn & { source?: string | null; folio?: string | null };

/**
 * Lots and sales from a fund's statement transactions (oldest units sold first). The lots count as reliable when they add up to the
 * closing balance on the statement or, when the statement gives none, to the units held that the fund records. Lines assumed from
 * the SIP plan (source "estimate") never decide that: they are added after the real lines as estimated lots. Lines of one day are
 * put in the order their running balance gives, so a sale and a purchase on the same day cannot swap places.
 */
export function fundLedger(args: {
  txns: Line[];
  /** the cost of the units held, to give the units from before the statement their share of it */
  costValue: number | null;
  unitsHeld: number | null;
  /** units a balance may be out by (Settings: funds.unitTolerance) */
  unitTolerance?: number;
}): Ledger {
  const tol = args.unitTolerance ?? DEFAULT_CONFIG.funds.unitTolerance;
  const sorted = orderLines(args.txns, tol);
  const real = sorted.filter((t) => !isEstimateLine(t));
  const est = sorted.filter((t) => isEstimateLine(t));
  if (real.length === 0) return { lots: [], realised: [], reconciled: false, estimatedLots: 0 };
  const ends = ledgerEnds(real, tol);
  const last = real[real.length - 1]!;
  const res = fifoLots({
    transactions: real,
    openingUnits: ends.opening ?? 0,
    closingUnits: ends.closing ?? last.balance,
    costValue: args.costValue,
  });
  const held = res.lots.reduce((a, l) => a + l.units, 0);
  const closing = ends.closing ?? last.balance;
  const reconciled =
    res.reconciled ||
    (closing === null &&
      args.unitsHeld !== null &&
      Math.abs(held - args.unitsHeld) <= LOT_UNIT_TOLERANCE);
  const lots: StatLot[] = res.lots.map((l) => ({
    acquiredOn: l.acquiredOn === '1900-01-01' ? BEFORE_STATEMENT : l.acquiredOn,
    units: l.units,
    cost: l.cost,
  }));
  const tail = reconciled
    ? est
        .filter((t) => t.units > 0)
        .map((t): StatLot => ({
          acquiredOn: t.date,
          units: t.units,
          cost: Math.abs(t.amount),
          estimated: true,
        }))
    : [];
  return {
    lots: [...lots, ...tail],
    realised: res.realised.map((r) => ({
      soldOn: r.soldOn,
      acquiredOn: r.acquiredOn,
      units: r.units,
      proceeds: r.proceeds,
      cost: r.cost,
    })),
    reconciled,
    estimatedLots: tail.length,
  };
}
