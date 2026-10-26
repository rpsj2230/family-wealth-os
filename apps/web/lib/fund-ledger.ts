import { BEFORE_STATEMENT, type StatLot, type StatRealised } from '@fwos/core';
import { fifoLots, type CasTxn } from '@fwos/ingest';

export interface Ledger {
  /** units still held, each purchase on its own line, oldest first */
  lots: StatLot[];
  /** every sale and the purchases it used, oldest units first */
  realised: StatRealised[];
  /** the lots add up to the units held, so they can be relied on */
  reconciled: boolean;
}

/**
 * Lots and sales from a fund's statement transactions (oldest units sold first). The lots count as reliable when they add up to the
 * closing balance on the statement or, when the statement gives none, to the units held that the fund records.
 */
export function fundLedger(args: {
  txns: CasTxn[];
  /** the cost of the units held, to give the units from before the statement their share of it */
  costValue: number | null;
  unitsHeld: number | null;
}): Ledger {
  if (args.txns.length === 0) return { lots: [], realised: [], reconciled: false };
  const sorted = [...args.txns].sort((a, b) => a.date.localeCompare(b.date));
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  const res = fifoLots({
    transactions: sorted,
    openingUnits: first.balance !== null ? Math.max(0, first.balance - first.units) : 0,
    closingUnits: last.balance,
    costValue: args.costValue,
  });
  const held = res.lots.reduce((a, l) => a + l.units, 0);
  const reconciled =
    res.reconciled ||
    (last.balance === null && args.unitsHeld !== null && Math.abs(held - args.unitsHeld) <= 0.01);
  return {
    lots: res.lots.map((l) => ({
      acquiredOn: l.acquiredOn === '1900-01-01' ? BEFORE_STATEMENT : l.acquiredOn,
      units: l.units,
      cost: l.cost,
    })),
    realised: res.realised.map((r) => ({
      soldOn: r.soldOn,
      acquiredOn: r.acquiredOn,
      units: r.units,
      proceeds: r.proceeds,
      cost: r.cost,
    })),
    reconciled,
  };
}
