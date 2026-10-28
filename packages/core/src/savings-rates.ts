/**
 * A savings account's rates by effective date (`RateStep`s for savings-accrual.ts), from what is on file:
 *  - the account's own rate and its history (every change is dated by the day it was made; before the first change, the rate it replaced);
 *  - else the bank's rate list for the account's kind (NRE, NRO, resident), with its balance slabs, and the dated changes the rate log
 *    recorded (a rate changed on the bank's page applies from the day the change was read; the rate before it applies before);
 *  - else the assumed rate in Settings.
 * A correction you made to a rate the reader got wrong is not a change of the bank's rate: it applies to the whole history.
 *
 * Pure: no I/O.
 */
import { offerFits, sameBank, type RateKind, type RateOffer } from './rates';
import type { RateStep, SavingsSlab, SlabMethod } from './savings-accrual';

export interface OwnRateChange {
  effectiveOn: string;
  oldRate: number | null;
  newRate: number | null;
}

export interface SavingsRateEvent {
  /** when the change was read (timestamp or date) */
  at: string;
  bank: string;
  accountKind: string;
  balanceFrom: number | null;
  balanceTo: number | null;
  kind: string;
  oldRate: number | null;
  newRate: number | null;
}

const BEGIN = '0000-01-01';
const day = (at: string) => at.slice(0, 10);

/** The bank's savings slabs for an account's kind: an offer for the exact kind wins over one for any kind on the same slab. */
export function listedSlabs(
  offers: RateOffer[],
  bank: string,
  kind: RateKind | null,
): (SavingsSlab & { from: number })[] {
  const fit = offers.filter(
    (o) =>
      o.product === 'savings' &&
      sameBank(o.bank, bank) &&
      offerFits(o, { product: 'savings', kind }),
  );
  const bySlab = new Map<string, RateOffer>();
  for (const o of fit) {
    const key = `${o.balanceFrom ?? 0}|${o.balanceTo ?? ''}`;
    const have = bySlab.get(key);
    if (!have || (have.accountKind === 'any' && o.accountKind !== 'any')) bySlab.set(key, o);
  }
  return [...bySlab.values()]
    .map((o) => ({ from: o.balanceFrom ?? 0, upTo: o.balanceTo ?? null, rate: o.rate }))
    .sort((a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity));
}

const slabKey = (from: number | null, to: number | null) => `${from ?? 0}|${to ?? ''}`;

export function savingsSchedule(args: {
  own: number | null;
  ownHistory?: OwnRateChange[];
  offers: RateOffer[];
  events?: SavingsRateEvent[];
  bank: string | null;
  kind: RateKind | null;
  method: SlabMethod;
  assumed: number;
}): RateStep[] {
  const listed = args.bank ? listedSlabs(args.offers, args.bank, args.kind) : [];
  const flat = (from: string, rate: number, source: RateStep['source']): RateStep => ({
    from,
    slabs: [{ upTo: null, rate }],
    method: 'whole',
    source,
  });

  // 1. the account's own rate, with its dated changes
  const hist = [...(args.ownHistory ?? [])].sort((a, b) =>
    a.effectiveOn.localeCompare(b.effectiveOn),
  );
  if (args.own !== null || hist.some((h) => h.newRate !== null || h.oldRate !== null)) {
    const listedStep = (from: string): RateStep =>
      listed.length
        ? {
            from,
            slabs: listed.map(({ upTo, rate }) => ({ upTo, rate })),
            method: args.method,
            source: 'rates_list',
          }
        : flat(from, args.assumed, 'assumed');
    const first = hist[0];
    const steps: RateStep[] = [];
    const startRate = first ? first.oldRate : args.own;
    steps.push(startRate !== null ? flat(BEGIN, startRate, 'account') : listedStep(BEGIN));
    for (const h of hist)
      steps.push(
        h.newRate !== null ? flat(h.effectiveOn, h.newRate, 'account') : listedStep(h.effectiveOn),
      );
    return steps;
  }

  // 2. the bank's rate list, slab by slab, with the changes the rate log recorded
  if (listed.length) {
    const events = (args.events ?? [])
      .filter(
        (e) =>
          e.kind === 'changed' &&
          args.bank !== null &&
          sameBank(e.bank, args.bank) &&
          (e.accountKind === 'any' || !args.kind || e.accountKind === args.kind),
      )
      .sort((a, b) => a.at.localeCompare(b.at));
    const rateAsOf = (slab: SavingsSlab & { from: number }, on: string): number => {
      const own = events.filter(
        (e) => slabKey(e.balanceFrom, e.balanceTo) === slabKey(slab.from, slab.upTo),
      );
      const before = own.filter((e) => day(e.at) <= on).pop();
      if (before && before.newRate !== null) return before.newRate;
      const after = own.find((e) => day(e.at) > on);
      if (after && after.oldRate !== null) return after.oldRate;
      return slab.rate;
    };
    const dates = [BEGIN, ...new Set(events.map((e) => day(e.at)))];
    return dates.map((from) => ({
      from,
      slabs: listed.map((s) => ({
        upTo: s.upTo,
        rate: rateAsOf(s, from === BEGIN ? '0000-01-01' : from),
      })),
      method: args.method,
      source: 'rates_list' as const,
    }));
  }

  // 3. nothing on file: the assumed rate
  return [flat(BEGIN, args.assumed, 'assumed')];
}
