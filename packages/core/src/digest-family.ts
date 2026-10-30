/**
 * The family figures of the daily summary (money words v6): net worth, today's change and what this financial year earned; own money,
 * lifetime profit, XIRR on own money and the earning rate now; each kind of holding with its profit and XIRR; and what matures in the
 * next 30 days. They are not worked out here: they are read off Home's model (`buildHome` in the web app), so the e-mail, the WhatsApp
 * text and Home show the same numbers. Pure.
 */
import type { CapitalLedger } from './capital';
import type { DigestInput } from './digest';
import { inrExact, MINUS, plainPct, signedPct } from './digest-format';
import type { DigestWealth } from './digest-wealth';
import type { ClassCard, HomeExtras, HomeGrowth } from './home';
import { PERCENT_KIND, TERMS } from './terms';

/** The part of Home's model the summary reads. `HomeModel` (web) satisfies it. */
export interface HomeFigures {
  total: number;
  change: { today: DigestWealth['today'] };
  money: { invested: number; profit: number; profitPct: number | null; estimated: boolean };
  classes: ClassCard[];
  capital: {
    totals: Pick<CapitalLedger['totals'], 'ownMoney' | 'profit' | 'profitPct'>;
    opening: CapitalLedger['opening'];
  };
  growth: Pick<HomeGrowth, 'all' | 'fd' | 'funds' | 'savings' | 'own'>;
  extras: Pick<HomeExtras, 'earnedFy' | 'maturing30'>;
}

/** A kind of holding as the summary's third line shows it. */
export interface DigestHolding {
  current: number;
  profit: number;
  /** XIRR, a yearly rate; null when it cannot be worked out */
  xirr: number | null;
}

export interface DigestFamily {
  /** Earned this FY; null before the ledger reaches this financial year */
  earnedFy: { amount: number; pct: number | null } | null;
  /** Own money and Lifetime profit; null until the ledger has an opening day (Home shows dashes then) */
  own: { ownMoney: number; lifetimeProfit: number; profitPct: number | null } | null;
  xirrOwn: number | null;
  earningRate: number | null;
  fd: DigestHolding | null;
  funds: DigestHolding | null;
  /** savings and cash, with the rate they earned this financial year */
  savings: { current: number; rate: number | null } | null;
  maturing30: { count: number; principal: number };
}

/** Home's family figures, as the summary carries them. */
export function familyFromHome(h: HomeFigures): DigestFamily {
  const card = (k: ClassCard['key']) => {
    const c = h.classes.find((x) => x.key === k);
    return c && c.current > 0 ? c : null;
  };
  const fd = card('fd');
  const funds = card('funds');
  const cash = card('cash');
  const ef = h.extras.earnedFy;
  const t = h.capital.totals;
  return {
    earnedFy: ef ? { amount: ef.total, pct: ef.pct } : null,
    own: h.capital.opening
      ? { ownMoney: t.ownMoney, lifetimeProfit: t.profit, profitPct: t.profitPct }
      : null,
    xirrOwn: h.growth.own.rate,
    earningRate: h.growth.all?.rate ?? null,
    fd: fd ? { current: fd.current, profit: fd.profit, xirr: h.growth.fd } : null,
    funds: funds ? { current: funds.current, profit: funds.profit, xirr: h.growth.funds } : null,
    savings: cash ? { current: cash.current, rate: h.growth.savings?.rate ?? null } : null,
    maturing30: { count: h.extras.maturing30.count, principal: h.extras.maturing30.principal },
  };
}

/** Home's headline (net worth, today's change, the profit of the holdings and the four kinds), as the summary's tiles read it. */
export function wealthFromHome(h: HomeFigures): DigestWealth {
  return {
    total: h.total,
    today: { ...h.change.today },
    overall: {
      invested: h.money.invested,
      profit: h.money.profit,
      profitPct: h.money.profitPct,
      estimated: h.money.estimated,
    },
    classes: h.classes,
  };
}

/** The summary with Home's figures in it: the headline and the four kinds, and the family figures. */
export function withHome(i: DigestInput, h: HomeFigures | null | undefined): DigestInput {
  return h ? { ...i, wealth: wealthFromHome(h), family: familyFromHome(h) } : i;
}

/** "+₹37,397" / "−₹3,400" / "₹0": the exact figure with its sign. */
export function signedExact(n: number): string {
  if (Math.round(Math.abs(n)) === 0) return '₹0';
  return `${n < 0 ? MINUS : '+'}${inrExact(Math.abs(n))}`;
}

/** A yearly rate as the summary writes it: 6.65%. */
const rate = (r: number) => plainPct(r, 2);

/** The kind names of the third line. */
export const FAMILY_KIND_LABEL = {
  fd: 'Fixed deposits',
  funds: 'Mutual funds',
  savings: 'Savings',
} as const;

/** The parts of each of the four lines, so the e-mail can lay them out and the text can join them. */
export interface FamilyLineParts {
  worth: string[];
  own: string[];
  kinds: string[];
  maturing: string;
}

export function familyParts(
  total: number,
  today: { amount: number; pct: number | null } | null,
  f: DigestFamily,
): FamilyLineParts {
  const worth = [`${TERMS.netWorth.label} ${inrExact(total)}`];
  if (today)
    worth.push(
      `${TERMS.todayChange.label} ${signedExact(today.amount)}${today.pct !== null ? ` (${signedPct(today.pct, 2)})` : ''}`,
    );
  if (f.earnedFy) worth.push(`${TERMS.earnedFy.label} ${signedExact(f.earnedFy.amount)}`);
  const own: string[] = [];
  if (f.own) {
    own.push(`${TERMS.ownMoney.label} ${inrExact(f.own.ownMoney)}`);
    own.push(
      `${TERMS.lifetimeProfit.label} ${signedExact(f.own.lifetimeProfit)}${f.own.profitPct !== null ? ` (${signedPct(f.own.profitPct, 1)} ${PERCENT_KIND.overall})` : ''}`,
    );
  }
  if (f.xirrOwn !== null) own.push(`${TERMS.xirrOwn.label} ${rate(f.xirrOwn)}`);
  if (f.earningRate !== null) own.push(`${TERMS.earningRate.label} ${rate(f.earningRate)}`);
  const holding = (label: string, h: DigestHolding) =>
    `${label} ${inrExact(h.current)} (${[
      `${TERMS.profit.label} ${signedExact(h.profit)}`,
      ...(h.xirr !== null ? [`${TERMS.xirr.label} ${rate(h.xirr)}`] : []),
    ].join(', ')})`;
  const kinds: string[] = [];
  if (f.fd) kinds.push(holding(FAMILY_KIND_LABEL.fd, f.fd));
  if (f.funds) kinds.push(holding(FAMILY_KIND_LABEL.funds, f.funds));
  if (f.savings)
    kinds.push(
      `${FAMILY_KIND_LABEL.savings} ${inrExact(f.savings.current)}${f.savings.rate !== null ? ` (${rate(f.savings.rate)})` : ''}`,
    );
  const maturing = `Maturing in the next 30 days: ${
    f.maturing30.principal > 0 ? inrExact(f.maturing30.principal) : 'nothing'
  }`;
  return { worth, own, kinds, maturing };
}

/**
 * The four lines at the top of the plain text and the WhatsApp message (money words v6):
 *   Net worth · Today's change · Earned this FY
 *   Own money · Lifetime profit (overall) · XIRR on own money · Earning rate now
 *   Fixed deposits (Profit, XIRR) · Mutual funds (Profit, XIRR) · Savings (rate earned)
 *   Maturing in the next 30 days
 * A line with nothing to say is left out.
 */
export function familyLines(
  total: number,
  today: { amount: number; pct: number | null } | null,
  f: DigestFamily,
): string[] {
  const p = familyParts(total, today, f);
  return [p.worth.join(' · '), p.own.join(' · '), p.kinds.join(' · '), p.maturing].filter(
    (l) => l.length > 0,
  );
}
