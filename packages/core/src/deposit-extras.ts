/**
 * Two of the extras under the Deposits headline (money words v6, "Also on this page"): the interest of the running deposits in this
 * financial year, earned and still to come (what the tax return needs), and each deposit's rate against today's best offer for the
 * same term. Pure: the deposits and the offers are passed in.
 */
import type { Compounding } from './fd';
import { depositPeriod, spanBetween } from './period-gains';
import { afterTaxRate, rankOffers } from './rates';
import type { RateOffer } from './rates';
import { fyBoundsOf, fyOf } from './tax';

export interface RunningDeposit {
  id: string;
  principal: number;
  /** contract rate, decimal */
  rate: number;
  kind: 'NRE' | 'NRO' | null;
  bookedOn: string;
  maturityOn: string;
  maturityAmount: number;
  compounding: Compounding;
}

const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The interest the running deposits add in the financial year of `today`: what is already earned (1 April to today) and the whole
 * year (earned plus what is still to come before 31 March). The same per-deposit figure as Reports' "Interest in each financial year".
 */
export function depositInterestThisFy(
  deposits: RunningDeposit[],
  today: string,
): { fy: string; earned: number; total: number } {
  const fy = fyOf(today);
  const b = fyBoundsOf(fy)!;
  const end = addDays(b.to, 1);
  let earned = 0;
  let total = 0;
  for (const d of deposits) {
    const held = [{ assetId: d.id, ...d, held: true }];
    total += depositPeriod(held, spanBetween(b.from, end, b.to), today).profit;
    if (today > b.from)
      earned += depositPeriod(held, spanBetween(b.from, today, today), today).profit;
  }
  return { fy, earned, total };
}

/** Whole months between two dates, the way a deposit's term is quoted ("12 months"). */
export function termMonths(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0));
}

export interface DepositsVsBest {
  /** running deposits that could be compared (an offer exists for their kind and term) */
  compared: number;
  /** of those, how many earn less after tax than today's best offer for the same term */
  below: number;
  /** what the deposits below would earn more a year at today's best, after tax */
  moreAYear: number;
  /** the largest gap after tax, in rate points (decimal), with its bank */
  largestGap: { gap: number; bank: string } | null;
}

/**
 * Each running deposit against today's best offer for its own kind (NRE/NRO) and term, both after tax (NRE tax-free, NRO at the
 * tax rate in Settings). Offers come from the Rates page. A deposit with no matching offer is left out, not counted as fine.
 */
export function depositsVsBest(
  deposits: (RunningDeposit & { bank: string })[],
  offers: RateOffer[],
  nroTaxRate: number,
): DepositsVsBest {
  let compared = 0;
  let below = 0;
  let moreAYear = 0;
  let largestGap: DepositsVsBest['largestGap'] = null;
  for (const d of deposits) {
    const best = rankOffers(
      offers,
      { product: 'fd', kind: d.kind, tenureMonths: termMonths(d.bookedOn, d.maturityOn) },
      { nroTaxRate },
    )[0];
    if (!best) continue;
    compared++;
    const gap = best.net - afterTaxRate(d.rate, d.kind, nroTaxRate);
    if (gap > 0) {
      below++;
      moreAYear += d.principal * gap;
      if (!largestGap || gap > largestGap.gap) largestGap = { gap, bank: best.bank };
    }
  }
  return { compared, below, moreAYear, largestGap };
}
