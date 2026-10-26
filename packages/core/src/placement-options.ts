/**
 * New money: five ways to place an amount, each with its reasoning, and a recommendation.
 *
 * Money is placed where it earns most after tax, across savings and fixed deposits of several terms, but inside guardrails:
 *  - deposit insurance: never more at a bank, for one ownership name, than the limit less a buffer for interest that will be
 *    added, counting what is already there (savings and deposits of the bank together);
 *  - spread: no option other than "Highest return" puts more than a set share in one bank;
 *  - liquidity: part is kept in savings, available any time, and the report says how much is free within a year.
 * Every number (terms, shares, buffer, smallest piece) is a setting. Pure functions: the page only draws what this returns.
 */
import {
  afterTaxRate,
  exposureByBank,
  offerAge,
  offerFits,
  rankOffers,
  rateBankKey,
  type RateHolding,
  type RateKind,
  type RateOffer,
  type RatePrefs,
} from './rates';
import { capacityKeyFor } from './dicgc';

export type OptionKey = 'highest' | 'balanced' | 'ladder' | 'safest' | 'flexible';

export interface OptionLine {
  bank: string;
  product: 'savings' | 'fd';
  kind: RateKind;
  /** months for a deposit; null for savings */
  termMonths: number | null;
  rate: number;
  /** after Indian tax (NRE interest is not taxed, NRO is) */
  net: number;
  amount: number;
  annual: number;
  /** insurance room left at this bank for this name after this line */
  roomLeft: number;
  ageDays: number;
  conditions: string | null;
}

export interface PlacementOption {
  key: OptionKey;
  title: string;
  /** one line: who this suits */
  tagline: string;
  lines: OptionLine[];
  placed: number;
  unplaced: number;
  totalAnnual: number;
  /** what the same money would earn in savings at the usual rate, and the difference */
  uplift: number;
  banks: number;
  /** the largest share of what was placed that sits in one bank (0 to 1) */
  topShare: number;
  topBank: string | null;
  /** in savings: can be withdrawn any time */
  liquidNow: number;
  /** liquid now plus deposits of 12 months or less */
  within12m: number;
  longestTerm: number | null;
  /** weighted average of the rates, after tax (0 to 1) */
  blendedNet: number;
  why: string[];
  cautions: string[];
  /** each guardrail and whether this option meets it */
  checks: { insured: boolean; spread: boolean; liquid: boolean; allPlaced: boolean };
  recommended: boolean;
}

export interface OptionsResult {
  options: PlacementOption[];
  recommendedKey: OptionKey;
  headline: string;
  reasoning: string[];
  /** what is missing from the rates on file, which limits every option */
  gaps: string[];
  baselineAnnual: number;
}

interface Cand {
  bank: string;
  product: 'savings' | 'fd';
  kind: RateKind;
  term: number | null;
  rate: number;
  net: number;
  age: number;
  conditions: string | null;
}

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pct = (r: number) => `${(r * 100).toFixed(2).replace(/0$/, '')}%`;
const share = (r: number) => `${Math.round(r * 100)}%`;

export function planOptions(args: {
  amount: number;
  kind: 'NRE' | 'NRO';
  ownerId: string;
  holdings: RateHolding[];
  offers: RateOffer[];
  prefs: RatePrefs;
  limit: number;
  today: string;
  baselineRate: number;
}): OptionsResult {
  const { amount, kind, prefs, limit, today } = args;
  const exposure = exposureByBank(args.holdings);
  const capKey = capacityKeyFor({ ownerId: args.ownerId, isJoint: false, jointHolderId: null });
  const usable = limit * (1 - prefs.insuranceBuffer);
  const outside = args.holdings.filter((h) => h.insured === false).map((h) => h.bank);
  const insuredBank = (bank: string) => !outside.some((b) => rateBankKey(b) === rateBankKey(bank));
  const offers = args.offers.filter((o) => insuredBank(o.bank));

  const fdPool = (maxTerm: number, minTerm = 1): Cand[] => {
    const best = new Map<string, Cand>();
    for (const o of offers) {
      if (o.product !== 'fd' || !offerFits(o, { product: 'fd', kind })) continue;
      const hi = o.tenureTo || o.tenureFrom;
      const term = Math.max(o.tenureFrom, minTerm);
      if (term > hi || term > maxTerm || term < 1) continue;
      const net = afterTaxRate(o.rate, kind, prefs.nroTaxRate);
      const k = `${rateBankKey(o.bank)}|${term}`;
      const cur = best.get(k);
      if (!cur || net > cur.net)
        best.set(k, {
          bank: o.bank,
          product: 'fd',
          kind,
          term,
          rate: o.rate,
          net,
          age: offerAge(o, today),
          conditions: o.conditions,
        });
    }
    return [...best.values()].sort((a, b) => b.net - a.net);
  };
  const savingsPool = (balance: number): Cand[] =>
    rankOffers(offers, { product: 'savings', kind, balance: Math.max(1, balance) }, prefs).map(
      (o) => ({
        bank: o.bank,
        product: 'savings' as const,
        kind,
        term: null,
        rate: o.rate,
        net: o.net,
        age: offerAge(o, today),
        conditions: o.conditions,
      }),
    );

  /** Places money greedily, best rate first, inside the insurance room and the share cap of each bank. */
  const build = (
    steps: { pool: Cand[]; budget: number }[],
    capShare: number | null,
  ): { lines: OptionLine[]; placed: number } => {
    const at = new Map<string, number>();
    const lines: OptionLine[] = [];
    let placed = 0;
    for (const step of steps) {
      let todo = Math.min(step.budget, amount - placed);
      for (const c of step.pool) {
        if (todo <= 0) break;
        const k = rateBankKey(c.bank);
        const have = at.get(k) ?? 0;
        const room = usable - (exposure.get(`${k}|${capKey}`) ?? 0) - have;
        const cap = capShare === null ? Infinity : capShare * amount - have;
        let take = Math.min(todo, room, cap);
        if (take < Math.min(prefs.minPiece, todo)) continue;
        take = Math.floor(take);
        if (take < 1) continue;
        const found = lines.find(
          (l) => rateBankKey(l.bank) === k && l.product === c.product && l.termMonths === c.term,
        );
        at.set(k, have + take);
        todo -= take;
        placed += take;
        const roomLeft = Math.max(0, limit - (exposure.get(`${k}|${capKey}`) ?? 0) - (have + take));
        if (found) {
          found.amount += take;
          found.annual = found.amount * found.net;
          found.roomLeft = roomLeft;
        } else
          lines.push({
            bank: c.bank,
            product: c.product,
            kind: c.kind,
            termMonths: c.term,
            rate: c.rate,
            net: c.net,
            amount: take,
            annual: take * c.net,
            roomLeft,
            ageDays: c.age,
            conditions: c.conditions,
          });
      }
    }
    return { lines, placed };
  };

  const liquid = Math.round(amount * prefs.liquidShare);
  const fdAll = fdPool(prefs.maxTermMonths);
  const fdBalanced = fdPool(prefs.balancedTermMonths);
  const fdShort = fdPool(prefs.flexibleTermMonths);
  const hasFd = fdAll.length > 0;

  const gaps: string[] = [];
  if (!hasFd)
    gaps.push(
      `No ${kind} fixed-deposit rates are on file, so every option below can only use savings accounts. Fixed deposits usually pay clearly more: add them on the Rates page, or check why a bank page cannot be read in Settings > Bank rate pages.`,
    );
  else {
    const fdBanks = new Set(fdAll.map((c) => rateBankKey(c.bank))).size;
    if (fdBanks < 3)
      gaps.push(
        `Fixed-deposit rates are on file for only ${fdBanks} bank${fdBanks === 1 ? '' : 's'}, which limits how far the money can be spread.`,
      );
  }
  if (savingsPool(amount).length === 0 && hasFd)
    gaps.push('No savings rates are on file, so no part can be kept in a savings account.');

  // five designs
  const designs: {
    key: OptionKey;
    title: string;
    tagline: string;
    make: () => { lines: OptionLine[]; placed: number };
  }[] = [
    {
      key: 'highest',
      title: 'Highest return',
      tagline: 'The most interest, whatever the term, as long as it stays inside insurance.',
      make: () =>
        build(
          [
            {
              pool: [...fdAll, ...savingsPool(amount)].sort((a, b) => b.net - a.net),
              budget: amount,
            },
          ],
          null,
        ),
    },
    {
      key: 'balanced',
      title: 'Balanced',
      tagline: `Good rates, no bank above ${share(prefs.maxBankShare)}, ${share(prefs.liquidShare)} free any time.`,
      make: () =>
        build(
          [
            { pool: savingsPool(liquid), budget: liquid },
            {
              pool: [...fdBalanced, ...savingsPool(amount)].sort((a, b) => b.net - a.net),
              budget: amount,
            },
          ],
          prefs.maxBankShare,
        ),
    },
    {
      key: 'ladder',
      title: 'Ladder',
      tagline: `A part falls due at each of ${prefs.ladderTermsMonths.join(', ')} months, so money keeps coming free.`,
      make: () => {
        const rungs = prefs.ladderTermsMonths.filter((t) => t <= prefs.maxTermMonths);
        const usableRungs = rungs.filter((t) => fdPool(t, t).some((c) => c.term === t));
        const rest = Math.max(0, amount - liquid);
        const each = usableRungs.length > 0 ? rest / usableRungs.length : 0;
        const steps = [
          { pool: savingsPool(liquid), budget: liquid },
          ...usableRungs.map((t) => ({
            pool: fdPool(t, t).filter((c) => c.term === t),
            budget: each,
          })),
          {
            pool: [...fdBalanced, ...savingsPool(amount)].sort((a, b) => b.net - a.net),
            budget: amount,
          },
        ];
        return build(steps, prefs.maxBankShare);
      },
    },
    {
      key: 'safest',
      title: 'Safest spread',
      tagline: `Spread widest: no bank above ${share(prefs.safeBankShare)}, ${share(prefs.liquidShare)} free any time.`,
      make: () =>
        build(
          [
            { pool: savingsPool(liquid), budget: liquid },
            {
              pool: [...fdBalanced, ...savingsPool(amount)].sort((a, b) => b.net - a.net),
              budget: amount,
            },
          ],
          prefs.safeBankShare,
        ),
    },
    {
      key: 'flexible',
      title: 'Stay flexible',
      tagline: `Half stays in savings and the rest in deposits of ${prefs.flexibleTermMonths} months or less, for when plans change.`,
      make: () => {
        const sav = Math.round(amount * prefs.flexibleLiquidShare);
        return build(
          [
            { pool: savingsPool(sav), budget: sav },
            {
              pool: [...fdShort, ...savingsPool(amount)].sort((a, b) => b.net - a.net),
              budget: amount,
            },
          ],
          prefs.maxBankShare,
        );
      },
    },
  ];

  const baselineNet = afterTaxRate(args.baselineRate, kind, prefs.nroTaxRate);
  const options: PlacementOption[] = designs.map((d) => {
    const { lines, placed } = d.make();
    const totalAnnual = lines.reduce((s, l) => s + l.annual, 0);
    const byBank = new Map<string, number>();
    for (const l of lines) byBank.set(l.bank, (byBank.get(l.bank) ?? 0) + l.amount);
    const top = [...byBank.entries()].sort((a, b) => b[1] - a[1])[0];
    const liquidNow = lines
      .filter((l) => l.product === 'savings')
      .reduce((s, l) => s + l.amount, 0);
    const within12m =
      liquidNow +
      lines
        .filter((l) => l.product === 'fd' && (l.termMonths ?? 0) <= 12)
        .reduce((s, l) => s + l.amount, 0);
    const terms = lines.filter((l) => l.termMonths !== null).map((l) => l.termMonths as number);
    const topShare = placed > 0 && top ? top[1] / placed : 0;
    const wantsLiquid =
      d.key === 'highest'
        ? 0
        : d.key === 'flexible'
          ? prefs.flexibleLiquidShare
          : prefs.liquidShare;
    const spreadCap = d.key === 'safest' ? prefs.safeBankShare : prefs.maxBankShare;
    const opt: PlacementOption = {
      key: d.key,
      title: d.title,
      tagline: d.tagline,
      lines,
      placed,
      unplaced: Math.max(0, amount - placed),
      totalAnnual,
      uplift: totalAnnual - placed * baselineNet,
      banks: byBank.size,
      topShare,
      topBank: top?.[0] ?? null,
      liquidNow,
      within12m,
      longestTerm: terms.length > 0 ? Math.max(...terms) : null,
      blendedNet: placed > 0 ? totalAnnual / placed : 0,
      why: [],
      cautions: [],
      checks: {
        insured: true, // by construction: no line goes past the room left at its bank
        spread:
          d.key === 'highest'
            ? true
            : topShare <= spreadCap + 1e-9 || byBank.size >= Math.ceil(1 / spreadCap),
        liquid: liquidNow + 1 >= wantsLiquid * amount * 0.999 || !hasFd,
        allPlaced: placed + 1 >= amount,
      },
      recommended: false,
    };
    return opt;
  });

  // recommend: among options that meet every guardrail, the one that earns most; "Highest return" is never the pick, it ignores spread
  const passes = (o: PlacementOption) =>
    o.key !== 'highest' &&
    o.checks.insured &&
    o.checks.spread &&
    o.checks.liquid &&
    o.checks.allPlaced;
  const ranked = options.filter(passes).sort((a, b) => b.totalAnnual - a.totalAnnual);
  const pick =
    ranked[0] ??
    [...options]
      .filter((o) => o.key !== 'highest')
      .sort((a, b) => b.placed - a.placed || b.totalAnnual - a.totalAnnual)[0] ??
    options[0]!;
  pick.recommended = true;
  const highest = options.find((o) => o.key === 'highest')!;

  // reasoning for each option, from its own numbers
  for (const o of options) {
    const top = [...o.lines].sort((a, b) => b.net - a.net)[0];
    const fds = o.lines.filter((l) => l.product === 'fd');
    const sav = o.lines.filter((l) => l.product === 'savings');
    if (o.placed === 0) {
      o.cautions.push('Nothing could be placed with the rates on file.');
      continue;
    }
    if (top)
      o.why.push(
        `Best rate used: ${top.bank} ${top.product === 'fd' ? `${top.termMonths}-month deposit` : 'savings'} at ${pct(top.rate)}${kind === 'NRO' ? ` (${pct(top.net)} after tax)` : ''}.`,
      );
    if (fds.length > 0 && sav.length > 0)
      o.why.push(
        `${share(fds.reduce((s, l) => s + l.amount, 0) / o.placed)} in fixed deposits at ${pct(
          fds.reduce((s, l) => s + l.amount * l.net, 0) / fds.reduce((s, l) => s + l.amount, 0),
        )} on average, ${share(o.liquidNow / o.placed)} in savings you can withdraw any time.`,
      );
    else if (fds.length > 0)
      o.why.push(`All in fixed deposits, ${pct(o.blendedNet)} on average after tax.`);
    else
      o.why.push(`All in savings, ${pct(o.blendedNet)} on average: it can be withdrawn any time.`);
    o.why.push(
      `${o.banks} bank${o.banks === 1 ? '' : 's'}; the largest, ${o.topBank}, holds ${share(o.topShare)}. ${inr(o.within12m)} is free within a year.`,
    );
    if (o.key === 'highest') {
      o.cautions.push(
        o.topShare > prefs.maxBankShare
          ? `${share(o.topShare)} sits in ${o.topBank}. A bank problem would hold up most of it, beyond what insurance repays.`
          : 'It ignores how the money is spread and how soon it is needed.',
      );
      if ((o.longestTerm ?? 0) > prefs.balancedTermMonths)
        o.cautions.push(
          `Money is locked for up to ${o.longestTerm} months; breaking a deposit early costs a penalty on the rate.`,
        );
    }
    if (o.key === 'ladder')
      o.why.push(
        'Rates differ by term, so each rung uses the bank that pays most for that term; as one falls due it can be renewed at the then rate.',
      );
    if (o.key === 'safest')
      o.why.push(
        `Cuts the harm of any one bank failing or freezing: at most ${share(prefs.safeBankShare)} in one place.`,
      );
    if (o.key === 'flexible')
      o.cautions.push(
        `Earns ${inr(highest.totalAnnual - o.totalAnnual)} a year less than Highest return, the price of keeping money free.`,
      );
    if (o.unplaced > 0)
      o.cautions.push(
        `${inr(o.unplaced)} could not be placed inside the limits at the banks with rates on file. Add rates for more banks, or accept that part is not insured.`,
      );
    const stale = o.lines.filter((l) => l.ageDays > prefs.staleDays);
    if (stale.length > 0)
      o.cautions.push(
        `${stale.length} of the rates used ${stale.length === 1 ? 'was' : 'were'} checked over ${prefs.staleDays} days ago: confirm with the bank.`,
      );
  }

  const reasoning: string[] = [];
  const gap = highest.totalAnnual - pick.totalAnnual;
  reasoning.push(
    `${pick.title} earns about ${inr(pick.totalAnnual)} a year after tax, ${inr(pick.uplift)} more than the same money in a savings account at the usual rate.`,
  );
  if (pick.key !== 'highest' && highest.placed > 0)
    reasoning.push(
      gap > 1
        ? `It gives up ${inr(gap)} a year (${share(highest.totalAnnual > 0 ? gap / highest.totalAnnual : 0)}) against Highest return, and in return uses ${pick.banks} bank${pick.banks === 1 ? '' : 's'} instead of ${highest.banks}, keeps no more than ${share(pick.topShare)} in one, and has ${inr(pick.within12m)} free within a year.`
        : 'It earns as much as Highest return while also spreading the money and keeping part free.',
    );
  reasoning.push(
    `Every line stays inside the ${inr(limit)} deposit-insurance limit for this name at its bank, leaving ${share(prefs.insuranceBuffer)} free for the interest that will be added, and counts what is already there (savings and deposits of the bank together).`,
  );
  if (kind === 'NRO')
    reasoning.push('Rates are after Indian tax: interest on an NRO account is taxed here.');
  if (!hasFd)
    reasoning.push(
      'Fixed-deposit rates are missing, so this is a savings-only plan and understates what the money could earn.',
    );

  return {
    options,
    recommendedKey: pick.key,
    headline: `Park it as “${pick.title}”: about ${inr(pick.totalAnnual)} a year after tax.`,
    reasoning,
    gaps,
    baselineAnnual: pick.placed * baselineNet,
  };
}
