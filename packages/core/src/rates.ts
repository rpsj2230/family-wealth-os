/**
 * Comparing interest rates and deciding where money should sit. Pure functions.
 *
 * Rules that matter:
 *  - Rates are compared AFTER tax: NRE interest is not taxed in India, NRO interest is (the tax rate is a setting).
 *  - Deposit insurance covers a limited amount per bank and per ownership name as written (a single name, or joint names in a given order). New money is spread so
 *    each bank stays inside the limit, counting what is already there including interest.
 *  - A running deposit is never suggested to be broken early (penalties differ by bank and are not known here); moves are
 *    suggested at maturity.
 *  - Every figure says how old the rate is.
 */
import type { AppConfig } from './config';
import { capacityKeyFor } from './dicgc';

export type RateKind = 'NRE' | 'NRO' | 'resident' | 'any';

export interface RateOffer {
  id: string;
  bank: string;
  product: 'savings' | 'fd';
  accountKind: RateKind;
  tenureFrom: number;
  tenureTo: number;
  rate: number;
  conditions: string | null;
  sourceKind: 'manual' | 'ai';
  checkedOn: string;
}

export type RatePrefs = AppConfig['rates'];

/** Interest after Indian tax: NRO is taxed at the configured rate, NRE is not. */
export const afterTaxRate = (rate: number, kind: RateKind | null, nroTaxRate: number) =>
  kind === 'NRO' ? rate * (1 - nroTaxRate) : rate;

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const bankKey = (b: string) =>
  b
    .toLowerCase()
    .replace(/\b(bank|small finance|sfb|ltd|limited|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
export const sameBank = (a: string, b: string) => {
  const x = bankKey(a);
  const y = bankKey(b);
  return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x)));
};

export function offerFits(
  o: RateOffer,
  q: { product: 'savings' | 'fd'; kind: RateKind | null; tenureMonths?: number },
): boolean {
  if (o.product !== q.product) return false;
  if (q.kind && q.kind !== 'any' && o.accountKind !== 'any' && o.accountKind !== q.kind)
    return false;
  if (q.product === 'fd' && q.tenureMonths !== undefined) {
    const lo = o.tenureFrom;
    const hi = o.tenureTo || o.tenureFrom;
    if (q.tenureMonths < lo || q.tenureMonths > hi) return false;
  }
  return true;
}

export const offerAge = (o: RateOffer, today: string) => daysBetween(o.checkedOn, today);

/** The best offer per bank for a product, ranked by after-tax rate. */
export function rankOffers(
  offers: RateOffer[],
  q: { product: 'savings' | 'fd'; kind: RateKind | null; tenureMonths?: number },
  prefs: RatePrefs,
): (RateOffer & { net: number })[] {
  const best = new Map<string, RateOffer & { net: number }>();
  for (const o of offers) {
    if (!offerFits(o, q)) continue;
    const net = afterTaxRate(
      o.rate,
      q.kind ?? (o.accountKind === 'any' ? null : o.accountKind),
      prefs.nroTaxRate,
    );
    const key = bankKey(o.bank);
    const cur = best.get(key);
    if (!cur || net > cur.net) best.set(key, { ...o, net });
  }
  return [...best.values()].sort((a, b) => b.net - a.net);
}

export interface RateHolding {
  assetId: string;
  ownerId: string;
  ownerName: string;
  bank: string;
  product: 'savings' | 'fd';
  kind: 'NRE' | 'NRO' | null;
  joint: boolean;
  /** the second name on a joint account (the owner is the first); null when not joint or not recorded */
  jointHolderId?: string | null;
  /** today's value in INR, including interest */
  current: number;
  /** the rate it earns: the deposit's rate, or the account's own or assumed savings rate */
  rate: number;
  maturityOn: string | null;
  needsConfirmation: boolean;
}

const capacityKey = (ownerId: string, joint: boolean, jointHolderId?: string | null) =>
  capacityKeyFor({ ownerId, isJoint: joint, jointHolderId: jointHolderId ?? null });

/** Money already at each bank for one person and capacity. */
export function exposureByBank(holdings: RateHolding[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const h of holdings) {
    if (h.needsConfirmation) continue;
    const k = `${bankKey(h.bank)}|${capacityKey(h.ownerId, h.joint, h.jointHolderId)}`;
    m.set(k, (m.get(k) ?? 0) + h.current);
  }
  return m;
}

export interface Suggestion {
  assetId: string;
  ownerName: string;
  from: string;
  to: string;
  product: 'savings' | 'fd';
  amount: number;
  currentRate: number;
  newRate: number;
  /** after-tax difference in percentage points, e.g. 0.011 */
  gap: number;
  annualGain: number;
  when: 'now' | 'at_maturity' | 'matured';
  on: string | null;
  text: string;
  offerAgeDays: number;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (r: number) => `${(r * 100).toFixed(2).replace(/0$/, '')}%`;

/** Where holdings earn clearly less than what is on offer elsewhere, with the gain and a safe moment to act. */
export function compareHoldings(
  holdings: RateHolding[],
  offers: RateOffer[],
  prefs: RatePrefs,
  today: string,
  limit: number,
): Suggestion[] {
  const out: Suggestion[] = [];
  const exposure = exposureByBank(holdings);
  for (const h of holdings) {
    if (h.current <= 0) continue;
    const tenure = prefs.defaultTenureMonths;
    const ranked = rankOffers(
      offers,
      h.product === 'fd'
        ? { product: 'fd', kind: h.kind, tenureMonths: tenure }
        : { product: 'savings', kind: h.kind },
      prefs,
    );
    const mine = afterTaxRate(h.rate, h.kind, prefs.nroTaxRate);
    let when: Suggestion['when'] = 'now';
    let on: string | null = null;
    if (h.product === 'fd') {
      if (h.needsConfirmation) when = 'matured';
      else if (h.maturityOn) {
        const left = daysBetween(today, h.maturityOn);
        if (left < 0) when = 'matured';
        else if (left <= prefs.fdLookaheadDays) {
          when = 'at_maturity';
          on = h.maturityOn;
        } else continue; // far from maturity: nothing to do yet, and no early-break advice
      }
    }
    const moveable =
      h.product === 'savings' ? Math.max(0, h.current - prefs.savingsBuffer) : h.current;
    if (moveable <= 0) continue;
    for (const o of ranked) {
      if (sameBank(o.bank, h.bank)) continue;
      const gap = o.net - mine;
      if (gap < prefs.minRateGap) break; // ranked best first: nothing further down will be better
      const used =
        exposure.get(`${bankKey(o.bank)}|${capacityKey(h.ownerId, h.joint, h.jointHolderId)}`) ?? 0;
      const room = Math.max(0, limit - used);
      const amount = Math.min(moveable, room);
      if (amount <= 0) continue; // that bank is already at the insurance limit for this person
      const gain = amount * gap;
      if (gain < prefs.minAnnualGain) continue;
      const age = offerAge(o, today);
      out.push({
        assetId: h.assetId,
        ownerName: h.ownerName,
        from: h.bank,
        to: o.bank,
        product: h.product,
        amount,
        currentRate: mine,
        newRate: o.net,
        gap,
        annualGain: gain,
        when,
        on,
        offerAgeDays: age,
        text:
          `${h.ownerName}: ${h.kind ?? ''} ${h.product === 'fd' ? 'deposit' : 'savings'} at ${h.bank} earns ${pct(mine)}${h.kind === 'NRO' ? ' after tax' : ''}; ${o.bank} offers ${pct(o.net)}${h.kind === 'NRO' ? ' after tax' : ''}. ` +
          (when === 'at_maturity'
            ? `When it matures on ${on}, `
            : when === 'matured'
              ? 'Now that it has matured, '
              : '') +
          `moving ${inr(amount)} would earn about ${inr(gain)} more a year` +
          (amount < moveable ? ` (limited by the insurance limit at ${o.bank})` : '') +
          '.',
      });
      break; // best usable alternative only
    }
  }
  return out.sort((a, b) => b.annualGain - a.annualGain);
}

export interface Placement {
  bank: string;
  product: 'savings' | 'fd';
  kind: RateKind | null;
  tenureNote: string;
  rate: number;
  net: number;
  amount: number;
  annualInterest: number;
  insuredAfter: boolean;
  headroomLeft: number;
  offerAgeDays: number;
  conditions: string | null;
}

export interface PlacementPlan {
  placements: Placement[];
  /** could not be placed inside the insurance limit at any bank with an offer */
  unplaced: number;
  totalAnnual: number;
  /** what the same money would earn kept in savings at the household's usual rate */
  baselineAnnual: number;
  uplift: number;
  notes: string[];
}

/**
 * Where to put new money: best after-tax offers first, never more than a bank's remaining insurance room for that person and
 * capacity, some kept liquid in savings if asked. Anything that cannot be placed inside the limit is reported, not hidden.
 */
export function placeNewMoney(args: {
  amount: number;
  kind: 'NRE' | 'NRO';
  ownerId: string;
  joint: boolean;
  /** the second name when the new money goes into a joint account */
  jointHolderId?: string | null;
  tenureMonths: number;
  keepLiquid: number;
  holdings: RateHolding[];
  offers: RateOffer[];
  prefs: RatePrefs;
  limit: number;
  today: string;
  baselineRate: number;
}): PlacementPlan {
  const { amount, kind, prefs, limit, today } = args;
  const notes: string[] = [];
  const exposure = exposureByBank(args.holdings);
  const room = (bank: string) =>
    Math.max(
      0,
      limit -
        (exposure.get(
          `${bankKey(bank)}|${capacityKey(args.ownerId, args.joint, args.jointHolderId)}`,
        ) ?? 0),
    );
  const placements: Placement[] = [];
  let left = Math.max(0, amount);

  const fill = (product: 'savings' | 'fd', budget: number) => {
    let todo = Math.min(budget, left);
    const ranked = rankOffers(
      args.offers,
      product === 'fd' ? { product, kind, tenureMonths: args.tenureMonths } : { product, kind },
      prefs,
    );
    for (const o of ranked) {
      if (todo <= 0) break;
      const r = room(o.bank);
      const take = Math.min(todo, r);
      if (take < 1) continue;
      exposure.set(
        `${bankKey(o.bank)}|${capacityKey(args.ownerId, args.joint, args.jointHolderId)}`,
        limit - r + take,
      );
      todo -= take;
      left -= take;
      placements.push({
        bank: o.bank,
        product,
        kind,
        tenureNote:
          product === 'fd'
            ? `${o.tenureFrom}${o.tenureTo && o.tenureTo !== o.tenureFrom ? `–${o.tenureTo}` : ''} months`
            : 'withdraw any time',
        rate: o.rate,
        net: o.net,
        amount: take,
        annualInterest: take * o.net,
        insuredAfter: true,
        headroomLeft: room(o.bank),
        offerAgeDays: offerAge(o, today),
        conditions: o.conditions,
      });
    }
  };

  if (args.keepLiquid > 0) fill('savings', args.keepLiquid);
  fill('fd', left);
  if (left > 0) fill('savings', left); // whatever deposits could not take, if a savings account has room

  const totalAnnual = placements.reduce((s, p) => s + p.annualInterest, 0);
  const placed = amount - left;
  const baselineAnnual = placed * afterTaxRate(args.baselineRate, kind, prefs.nroTaxRate);
  if (left > 0)
    notes.push(
      `${inr(left)} does not fit inside the insurance limit at any bank with a rate on file. Spread it over another bank, or accept that part is uninsured.`,
    );
  if (args.offers.length === 0)
    notes.push(
      'No rates are on file yet. Add them on this page or let the weekly refresh read your banks’ rate pages.',
    );
  if (kind === 'NRO')
    notes.push('Rates are shown after tax: interest on NRO accounts is taxed in India.');
  return {
    placements,
    unplaced: left,
    totalAnnual,
    baselineAnnual,
    uplift: totalAnnual - baselineAnnual,
    notes,
  };
}
