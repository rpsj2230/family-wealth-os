import {
  buildNewMoneyExplain,
  buildRatesExplain,
  insuranceRoom,
  offerAge,
  type ExplainSet,
  type OptionsResult,
  type RateHolding,
  type RateOffer,
} from '@fwos/core';

/** How many rates are on file, the dates they were checked between and how many are older than the limit. */
export function offerFacts(offers: RateOffer[], today: string, staleDays: number) {
  const dates = offers.map((o) => o.checkedOn).sort();
  return {
    count: offers.length,
    newest: dates.at(-1) ?? null,
    oldest: dates[0] ?? null,
    stale: offers.filter((o) => offerAge(o, today) > staleDays).length,
    staleDays,
  };
}

/** The "?" explainers of the Rates page. */
export function ratesExplain(a: {
  offers: RateOffer[];
  today: string;
  staleDays: number;
  unreadable: number;
  banks: number;
  sample: boolean;
}): ExplainSet<'rates'> {
  return buildRatesExplain({
    today: a.today,
    offers: offerFacts(a.offers, a.today, a.staleDays),
    unreadable: a.unreadable,
    banks: a.banks,
    links: { settings: a.sample ? '/demo/settings' : '/settings#rates' },
  });
}

/** The "?" explainers of New money. */
export function newMoneyExplain(a: {
  offers: RateOffer[];
  holdings: RateHolding[];
  today: string;
  staleDays: number;
  limit: number;
  baselineRate: number;
  amount: number;
  kind: 'NRE' | 'NRO';
  result: OptionsResult | null;
  suggestions: { count: number; totalGain: number };
  ratesHref: string;
  depositsHref: string;
}): ExplainSet<'newmoney'> {
  const pick = a.result?.options.find((o) => o.recommended) ?? null;
  const room = insuranceRoom(a.holdings, a.limit);
  return buildNewMoneyExplain({
    today: a.today,
    offers: offerFacts(a.offers, a.today, a.staleDays),
    limit: a.limit,
    baselineRate: a.baselineRate,
    amount: a.amount,
    kind: a.kind,
    pick: pick
      ? {
          title: pick.title,
          totalAnnual: pick.totalAnnual,
          uplift: pick.uplift,
          blendedNet: pick.blendedNet,
          topShare: pick.topShare,
          liquidNow: pick.liquidNow,
          longestTerm: pick.longestTerm ?? 0,
          banks: pick.banks,
        }
      : null,
    suggestions: a.suggestions,
    room: {
      names: room.rows.length,
      over: room.rows.filter((r) => r.total > a.limit).length,
      outside: room.outside.length,
    },
    links: { rates: a.ratesHref, deposits: a.depositsHref },
  });
}
