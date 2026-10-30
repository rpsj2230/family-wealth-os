/**
 * Booked profit this financial year, split short- and long-term by the same clock the lots use (a sale is
 * long-term only the day AFTER the holding period ends), so the yearly tax-free allowance left is worked out with the same rule
 * that decides whether a unit is ready to sell. Pure.
 */
import { addDaysIso, addMonthsIso } from './harvest-lots';

export interface SoldLot {
  soldOn: string;
  acquiredOn: string;
  proceeds: number;
  /** null when the purchase is not on file: the gain cannot be stated, so the sale is left out */
  cost: number | null;
}

/** Net short- and long-term gain from sales since `fyStart`, for equity-oriented units held `holdingMonths` or more to be long-term. */
export function realisedSince(args: { sold: SoldLot[]; fyStart: string; holdingMonths: number }): {
  stcg: number;
  ltcg: number;
} {
  let stcg = 0;
  let ltcg = 0;
  for (const x of args.sold) {
    if (x.soldOn < args.fyStart || x.cost === null) continue;
    const longFrom = addDaysIso(addMonthsIso(x.acquiredOn, args.holdingMonths), 1);
    if (x.soldOn >= longFrom) ltcg += x.proceeds - x.cost;
    else stcg += x.proceeds - x.cost;
  }
  return { stcg, ltcg };
}

/**
 * The long-term gain that already uses up this year's tax-free allowance: a short-term loss is set off against long-term gain first,
 * and a net loss uses none.
 */
export const allowanceUsed = (y: { stcg: number; ltcg: number }): number =>
  Math.max(0, Math.round(Math.max(0, y.ltcg + Math.min(0, y.stcg))));
