/**
 * The "?" explainers of the Investments overview and breakdown: the headline figures (value, money put in, profit and the two
 * percentages with their denominators, today's move, annual return, the ring, SIPs, long-term share, statements) and the cards
 * under them. Pure: the page passes the numbers and flags it already holds (the hero, the statistics block, the ledger verdicts,
 * lots basis, flows estimated); this file only puts them into words and never decides a figure differently.
 */
import { TERMS } from './terms';
import {
  explain,
  exDate,
  exInr,
  exPct,
  exPlural,
  exRange,
  exSigned,
  exSignedPct,
  levelOfShare,
  ratioHow,
  type Explain,
  type ExplainBasis,
  type ExplainInput,
  type ExplainLevel,
  type ExplainSet,
} from './explain';
import type { LedgerStatus, PersonLedgerSummary } from './ledger-check';
import type { Hero } from './invest-overview';
import type { LotsBasis, StatBlock } from './fund-stats';
import { formatInrCompact } from './money';
import type { PerfContext, PerfExplainSet } from './explain-perf';

/** Where a "?" sends the person: the places that fix or show the data behind a figure. */
export interface InvestLinks {
  dataCheck: string;
  import: string;
  match: string;
  performance: string;
  breakdown: string;
  transactions: string;
  funds: string;
  settings: string;
}

/** What the explainers need to know about one fund: all of it is already on the page's fund row. */
export interface InvestFundFact {
  assetId: string;
  name: string;
  owner: string;
  value: number;
  invested: number;
  units: number | null;
  nav: number | null;
  navDate: string | null;
  /** matched to an official scheme, so its price is fetched every day */
  livePrice: boolean;
  /** the words the page already uses for where today's value comes from ("units × live price", ...) */
  valueBasis: string;
  hasStatement: boolean;
  lotsBasis: LotsBasis;
  flowsEstimated: boolean;
  ledgerStatus: LedgerStatus;
  /** the plain reason the history needs something, '' when it reconciles */
  ledgerWhy: string;
  /** the fund's figures rest partly on an estimate (the "est." mark) */
  figuresEstimated: boolean;
  firstTxnOn: string | null;
  lastTxnOn: string | null;
  txnCount: number;
  startedOn: string | null;
  updatedOn: string | null;
  dayAmount: number | null;
  dayPct: number | null;
  dayFrom: string | null;
  dayTo: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** the cash flows the annual return uses for this fund */
  flowCount: number;
  flowsFrom: string | null;
  flowsTo: string | null;
  categoryCertain: boolean;
  plan: 'direct' | 'regular' | 'unknown';
}

export interface InvestExplainInput {
  today: string;
  /** "all funds" or "Anil's funds": whose funds the figures cover */
  scope: string;
  hero: Hero;
  stats: StatBlock;
  funds: InvestFundFact[];
  /** one per person shown */
  ledger: PersonLedgerSummary[];
  links: InvestLinks;
  holdingMonths: number | null;
  /** the tax rule the long-term period comes from */
  historyFrom: string;
  /** dates of the first and last sale on a statement */
  saleDates: { first: string | null; last: string | null };
  /** the projection behind "if you carry on" */
  pace: {
    rate: number;
    assumed: boolean;
    spread: number;
    cap: number;
    years: { years: number; expected: number; low: number; high: number }[];
  };
  goals: { withGoal: number; without: number; names: string[] };
  people: number;
}

// ------------------------------------------------------------------------------------------------
// Shared helpers
// ------------------------------------------------------------------------------------------------
const dated = (ds: (string | null | undefined)[]) => ds.filter((d): d is string => !!d).sort();
const maxDate = (ds: (string | null | undefined)[]) => dated(ds).at(-1) ?? null;
const minDate = (ds: (string | null | undefined)[]) => dated(ds)[0] ?? null;

/** "A, B and 3 more" */
export function nameList(names: string[], max = 3): string {
  if (names.length === 0) return 'none';
  if (names.length <= max)
    return names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}

const compactIfBig = (n: number) => (Math.abs(n) >= 1e5 ? formatInrCompact(n) : undefined);

/** The basis a value method maps to: the page's own words for where today's value comes from. */
export function valueMethodBasis(valueBasis: string): ExplainBasis {
  if (valueBasis === 'units × live price') return 'calculated';
  if (valueBasis.startsWith('last recorded')) return 'recorded';
  return 'estimated';
}

interface Coverage {
  total: number;
  withStatement: number;
  noStatement: number;
  /** figures rest partly on an estimate: the history does not add up, or there is no statement */
  unreconciled: number;
  reconciled: number;
  noLive: number;
  byStatus: Record<LedgerStatus, InvestFundFact[]>;
}

export function coverage(funds: InvestFundFact[]): Coverage {
  const byStatus: Record<LedgerStatus, InvestFundFact[]> = {
    complete: [],
    starts_midway: [],
    gap: [],
    mismatch: [],
    estimated: [],
    no_transactions: [],
  };
  for (const f of funds) byStatus[f.ledgerStatus].push(f);
  return {
    total: funds.length,
    withStatement: funds.filter((f) => f.hasStatement).length,
    noStatement: funds.filter((f) => !f.hasStatement).length,
    unreconciled: funds.filter((f) => f.figuresEstimated).length,
    reconciled: byStatus.complete.length,
    noLive: funds.filter((f) => !f.livePrice).length,
    byStatus,
  };
}

const STATUS_WORD: Record<LedgerStatus, string> = {
  complete: 'reconciled',
  starts_midway: 'starts midway (earlier history needed)',
  gap: 'lines missing',
  mismatch: 'does not match the unit count',
  estimated: 'only assumed instalments',
  no_transactions: 'no transactions on file',
};

/** The level of a figure that rests on the whole history of every fund: complete only when every fund reconciles. */
function historyLevel(c: Coverage): ExplainLevel {
  if (c.total === 0) return 'missing';
  return levelOfShare(c.unreconciled, c.total);
}

function historyText(c: Coverage): string {
  if (c.total === 0) return 'No funds are on file.';
  if (c.unreconciled === 0)
    return `Every one of the ${c.total} funds has a transaction history that adds up to its units.`;
  return `${c.reconciled} of ${exPlural(c.total, 'fund')} ${c.reconciled === 1 ? 'has' : 'have'} a history that adds up; ${c.unreconciled} ${c.unreconciled === 1 ? 'does' : 'do'} not (${c.noStatement} with no statement at all), so ${c.unreconciled === 1 ? 'its' : 'their'} part of this figure is marked estimated.`;
}

const fixFor = (c: Coverage, links: InvestLinks) =>
  c.unreconciled > 0
    ? { label: 'See which funds need history (data check)', href: links.dataCheck }
    : undefined;

const alsoImport = (c: Coverage, links: InvestLinks) =>
  c.unreconciled > 0 ? { label: 'Import a fund statement', href: links.import } : null;

// ------------------------------------------------------------------------------------------------
// The headline
// ------------------------------------------------------------------------------------------------
function valueExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  const live = i.funds.filter((f) => f.livePrice);
  const latest = maxDate(live.map((f) => f.navDate));
  const onLatest = live.filter((f) => f.navDate === latest).length;
  const older = live.filter((f) => f.navDate && f.navDate !== latest);
  const byMethod = new Map<string, InvestFundFact[]>();
  for (const f of i.funds) byMethod.set(f.valueBasis, [...(byMethod.get(f.valueBasis) ?? []), f]);
  const inputs: ExplainInput[] = [...byMethod.entries()]
    .sort((a, b) => b[1].reduce((x, f) => x + f.value, 0) - a[1].reduce((x, f) => x + f.value, 0))
    .map(([method, list]) => {
      const sum = list.reduce((a, f) => a + f.value, 0);
      return {
        label: method.charAt(0).toUpperCase() + method.slice(1),
        value: exInr(sum),
        basis: valueMethodBasis(method),
        from: minDate(list.map((f) => f.navDate ?? f.updatedOn)),
        to: maxDate(list.map((f) => f.navDate ?? f.updatedOn)),
        count: { n: list.length, of: c.total, noun: 'funds' },
      };
    });
  if (live.length > 0)
    inputs.push({
      label: 'Fund prices (NAV) used',
      value: latest ? `latest ${exDate(latest)}` : '–',
      basis: 'statement',
      from: minDate(live.map((f) => f.navDate)),
      to: latest,
      count: { n: onLatest, of: live.length, noun: 'funds on the latest price' },
      ...(older.length > 0
        ? {
            note: `${older.length} older: ${nameList(
              older.map((f) => `${f.name} (${exDate(f.navDate)})`),
              2,
            )}`,
          }
        : {}),
    });
  const methodEstimated = i.funds.filter((f) => valueMethodBasis(f.valueBasis) !== 'calculated');
  const weak = new Set(
    [...methodEstimated, ...i.funds.filter((f) => f.figuresEstimated)].map((f) => f.assetId),
  );
  return explain({
    id: 'invest.value',
    title: 'Current value of mutual funds',
    exact: exInr(h.value),
    shown: compactIfBig(h.value),
    what: `What ${i.scope} are worth today at their latest prices.`,
    how: `For each of ${exPlural(c.total, 'fund')}: units held × latest price (NAV) = ${exInr(h.value)} added together. ${
      byMethod.size > 1
        ? [...byMethod.entries()]
            .map(([m, l]) => `${exInr(l.reduce((a, f) => a + f.value, 0))} is ${m}`)
            .join('; ') + '.'
        : `All of it is ${[...byMethod.keys()][0] ?? 'recorded'}.`
    }`,
    inputs,
    level: c.total === 0 ? 'missing' : levelOfShare(weak.size, c.total),
    completeness:
      c.total === 0
        ? 'No funds are on file.'
        : weak.size === 0
          ? `All ${exPlural(c.total, 'fund')} are valued as units × a live price, and every history adds up. Prices run to ${exDate(latest)}.`
          : `${weak.size} of ${exPlural(c.total, 'fund')} ${weak.size === 1 ? 'rests' : 'rest'} on an estimate: a price moved on from the last record, SIPs assumed since, no live price, or a history that does not add up to the units.`,
    notes: [
      older.length > 0
        ? `${onLatest} of ${live.length} funds have the price of ${exDate(latest)}; ${older.length} ${older.length === 1 ? 'has' : 'have'} an older price because the fund house had not published a newer one.`
        : null,
      c.noLive > 0
        ? `${c.noLive} ${c.noLive === 1 ? 'fund has' : 'funds have'} no live price: ${nameList(i.funds.filter((f) => !f.livePrice).map((f) => f.name))}. Their value is the last one recorded.`
        : null,
      i.funds.some((f) => f.figuresEstimated)
        ? `The unit count of ${i.funds.filter((f) => f.figuresEstimated).length} fund(s) is not backed by a statement that adds up, so their value is only as good as the units recorded.`
        : null,
    ],
    fix:
      c.noLive > 0
        ? { label: 'Match funds to follow their price', href: i.links.match }
        : fixFor(c, i.links),
    also: [alsoImport(c, i.links)],
  });
}

function moneyInExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  const exact = i.funds.filter((f) => f.hasStatement && !f.figuresEstimated);
  const off = i.funds.filter((f) => f.hasStatement && f.figuresEstimated);
  const plain = i.funds.filter((f) => !f.hasStatement);
  const sum = (l: InvestFundFact[]) => l.reduce((a, f) => a + f.invested, 0);
  const inputs: ExplainInput[] = [];
  if (exact.length > 0)
    inputs.push({
      label: 'Cost of units held, from statement lines',
      value: exInr(sum(exact)),
      basis: 'statement',
      from: minDate(exact.map((f) => f.firstTxnOn)),
      to: maxDate(exact.map((f) => f.lastTxnOn)),
      count: { n: exact.length, of: c.total, noun: 'funds' },
    });
  if (off.length > 0)
    inputs.push({
      label: 'Cost of units held, history does not add up',
      value: exInr(sum(off)),
      basis: 'estimated',
      from: minDate(off.map((f) => f.firstTxnOn)),
      to: maxDate(off.map((f) => f.lastTxnOn)),
      count: { n: off.length, of: c.total, noun: 'funds' },
      note: nameList(off.map((f) => f.name)),
    });
  if (plain.length > 0)
    inputs.push({
      label: 'Amount entered by hand (no statement)',
      value: exInr(sum(plain)),
      basis: 'recorded',
      from: minDate(plain.map((f) => f.startedOn)),
      to: i.today,
      count: { n: plain.length, of: c.total, noun: 'funds' },
      note: nameList(plain.map((f) => f.name)),
    });
  if (c.total === 0) inputs.push({ label: 'Funds', value: 'none', basis: 'missing' });
  return explain({
    id: 'invest.moneyIn',
    title: 'Money put in (invested)',
    exact: exInr(h.invested),
    shown: compactIfBig(h.invested),
    what: 'What you paid for the units you still hold.',
    how: `Cost of the units still held, fund by fund (oldest units sold first): ${exInr(h.invested)} over ${exPlural(c.total, 'fund')}. Money that bought units you have since sold is not in it.`,
    inputs,
    level: historyLevel(c),
    completeness: historyText(c),
    notes: [
      'This is not the total of everything you ever paid in. It is the cost of what you still hold, so it is the figure value and profit are measured against.',
      plain.length > 0
        ? `For ${plain.length} ${plain.length === 1 ? 'fund' : 'funds'} with no statement, the amount is the one entered when the fund was added; it is not checked against a statement.`
        : null,
    ],
    fix: fixFor(c, i.links),
    also: [alsoImport(c, i.links)],
  });
}

function profitExplain(
  i: InvestExplainInput,
  c: Coverage,
  money: Explain,
  value: Explain,
): Explain {
  const h = i.hero;
  const pct = h.unrealisedPct;
  const sharePct = h.value > 0 ? h.unrealised / h.value : null;
  return explain({
    id: 'invest.profit',
    title: 'Profit on amount invested now (units held)',
    exact: exSigned(h.unrealised),
    shown: compactIfBig(h.unrealised),
    what: 'How much the units you still hold are worth above (or below) what you paid for them.',
    how:
      `${exInr(h.value)} value − ${exInr(h.invested)} money put in = ${exSigned(h.unrealised)}. ` +
      (pct === null
        ? 'No cost is recorded, so no percentage can be worked out.'
        : `As a share of the money put in: ${ratioHow({ label: 'profit', amount: h.unrealised }, { label: 'money put in', amount: h.invested })}.`) +
      (sharePct === null
        ? ''
        : ` As a share of today’s value (what the ring shows): ${ratioHow({ label: 'profit', amount: h.unrealised }, { label: 'today’s value', amount: h.value }, 1, false)}.`),
    inputs: [
      {
        label: 'Current value',
        value: exInr(h.value),
        basis: value.completeness.level === 'complete' ? 'calculated' : 'estimated',
        to: i.today,
        count: { n: c.total, noun: 'funds' },
      },
      {
        label: 'Money put in (cost of units held)',
        value: exInr(h.invested),
        basis: money.completeness.level === 'complete' ? 'statement' : 'estimated',
        from: minDate(i.funds.map((f) => f.firstTxnOn ?? f.startedOn)),
        to: i.today,
      },
    ],
    level: historyLevel(c),
    completeness:
      `${historyText(c)} ${value.completeness.level === 'complete' ? '' : 'Some prices are moved on from the last record or have no live price: see the value.'}`.trim(),
    notes: [
      'Gains already booked by selling are not in this figure; they are under “Booked by selling”, and the two together are the “Total gain”.',
      'The two percentages answer different questions: growth ÷ money put in is your return on your money; growth ÷ today’s value is how much of today’s value is growth.',
    ],
    fix: fixFor(c, i.links),
    also: [alsoImport(c, i.links)],
  });
}

function ringExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  if (!h.split)
    return explain({
      id: 'invest.ring',
      title: `${TERMS.invested.label} and ${TERMS.profit.label}`,
      what: 'How the current value splits between what was invested and the profit on it.',
      how: 'Not drawn: the amount invested is needed to split the value, and it is not recorded.',
      inputs: [{ label: TERMS.invested.label, value: 'not recorded', basis: 'missing' }],
      level: 'missing',
      completeness: 'Missing: the amount invested (cost of the units held).',
      fix: { label: 'Import a fund statement', href: i.links.import },
    });
  const profit = Math.max(0, h.value - h.invested);
  const loss = h.value < h.invested;
  return explain({
    id: 'invest.ring',
    title: loss
      ? `${TERMS.invested.label} and the loss`
      : `${TERMS.invested.label} and ${TERMS.profit.label}`,
    exact: exInr(Math.abs(h.value - h.invested)),
    shown: compactIfBig(Math.abs(h.value - h.invested)),
    what: `How the current value splits between what was invested and the profit on it. The two shares are of the current value; the figure in the centre is the ${TERMS.overall.label.toLowerCase()}: ${TERMS.overall.hint}`,
    how: loss
      ? `Invested ${exInr(h.invested)} is more than the current value ${exInr(h.value)}: a loss of ${exInr(h.invested - h.value)}. ${ratioHow({ label: 'current value', amount: h.value }, { label: 'invested', amount: h.invested }, 0, false)} of what was invested is left.`
      : `Profit: ${ratioHow({ label: 'profit', amount: profit }, { label: 'current value', amount: h.value }, 1, false)} of the current value. Invested: ${ratioHow({ label: 'invested', amount: h.invested }, { label: 'current value', amount: h.value }, 1, false)}. In the centre, the overall return: ${ratioHow({ label: 'profit', amount: profit }, { label: 'invested', amount: h.invested }, 1, false)} overall (${exSignedPct(h.unrealisedPct ?? 0, 1)}).`,
    inputs: [
      { label: TERMS.currentValue.label, value: exInr(h.value), basis: 'calculated', to: i.today },
      {
        label: TERMS.invested.label,
        value: exInr(h.invested),
        basis: historyLevel(c) === 'complete' ? 'statement' : 'estimated',
      },
      { label: TERMS.profit.label, value: exInr(profit), basis: 'calculated' },
    ],
    level: historyLevel(c),
    completeness: historyText(c),
    notes: ['The overall return is total growth, however long it took; XIRR is the yearly rate.'],
    fix: fixFor(c, i.links),
  });
}

function todayExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  const withDay = i.funds.filter((f) => f.dayPct !== null);
  const without = i.funds.filter((f) => f.dayPct === null);
  if (withDay.length === 0)
    return explain({
      id: 'invest.today',
      title: 'Today’s move',
      what: 'How much the funds gained or lost between their last two published prices.',
      how: 'Not worked out: no fund has two published prices yet.',
      inputs: [
        {
          label: 'Two prices per fund',
          value: 'none yet',
          basis: 'missing',
          count: { n: 0, of: c.total, noun: 'funds' },
        },
      ],
      level: 'missing',
      completeness:
        'Missing: a fund needs a live price and at least one earlier price to show a move.',
      fix: { label: 'Match funds to follow their price', href: i.links.match },
    });
  const prior = withDay.reduce((a, f) => a + f.value - (f.dayAmount ?? 0), 0);
  return explain({
    id: 'invest.today',
    title: 'Today’s move',
    exact: exSigned(h.dayAmount),
    shown: compactIfBig(h.dayAmount),
    what: 'How much the funds with a live price gained or lost between their last two published prices.',
    how: `Each fund’s units × (latest price − previous price), added over ${exPlural(withDay.length, 'fund')} = ${exSigned(h.dayAmount)}. As a share of what those funds were worth at the previous price: ${ratioHow({ label: 'move', amount: h.dayAmount }, { label: 'previous value', amount: prior })}.`,
    inputs: [
      {
        label: 'Price moves between two published prices',
        value: exSigned(h.dayAmount),
        basis: 'calculated',
        from: minDate(withDay.map((f) => f.dayFrom)),
        to: maxDate(withDay.map((f) => f.dayTo)),
        count: { n: withDay.length, of: c.total, noun: 'funds' },
      },
      ...(without.length > 0
        ? [
            {
              label: 'Funds with no move to show',
              value: exInr(without.reduce((a, f) => a + f.value, 0)),
              basis: 'missing' as const,
              count: { n: without.length, noun: 'funds' },
              note: nameList(without.map((f) => f.name)),
            },
          ]
        : []),
    ],
    level: without.length === 0 ? 'complete' : 'partly_estimated',
    completeness:
      without.length === 0
        ? `All ${exPlural(c.total, 'fund')} have two published prices.`
        : `${withDay.length} of ${exPlural(c.total, 'fund')} have two published prices; ${without.length} ${without.length === 1 ? 'is' : 'are'} left out of the move.`,
    notes: [
      'The two prices are the last two the fund house published, so “today” is the latest trading day, not necessarily today’s date. Weekends and holidays have no new price.',
      'The move uses today’s unit count; units bought or sold on the day itself are not separated out.',
    ],
    fix:
      without.length > 0
        ? { label: 'Match funds to follow their price', href: i.links.match }
        : undefined,
  });
}

function xirrExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  const used = i.funds.filter((f) => f.flowCount > 0);
  const fromStatement = used.filter((f) => !f.flowsEstimated);
  const fromPlan = used.filter((f) => f.flowsEstimated);
  const flowsStatement = fromStatement.reduce((a, f) => a + f.flowCount, 0);
  const flowsPlan = fromPlan.reduce((a, f) => a + f.flowCount, 0);
  const left = i.funds.filter((f) => f.flowCount === 0);
  const first = minDate(used.map((f) => f.flowsFrom));
  if (h.xirr === null)
    return explain({
      id: 'invest.xirr',
      title: 'Yearly return on amount invested (XIRR)',
      what: 'The single yearly rate that your money has grown at, given the dates each rupee went in or came out.',
      how: 'Not worked out: it needs at least one dated payment in and today’s value, from a statement or a start date.',
      inputs: [
        {
          label: 'Dated cash flows',
          value: 'none',
          basis: 'missing',
          count: { n: 0, of: c.total, noun: 'funds' },
        },
      ],
      level: 'missing',
      completeness: 'Missing: a fund statement, or a start date (and SIP) for each fund.',
      fix: { label: 'Import a fund statement', href: i.links.import },
    });
  const partly = h.xirrEstimated;
  const why: string[] = [];
  if (fromPlan.length > 0)
    why.push(
      `${exPlural(fromPlan.length, 'fund')} ${fromPlan.length === 1 ? 'has' : 'have'} no fund statement, so ${fromPlan.length === 1 ? 'its' : 'their'} ${exPlural(flowsPlan, 'payment')} ${flowsPlan === 1 ? 'is' : 'are'} worked out from the start date, the amount put in and the SIP`,
    );
  const unrec = i.funds.filter((f) => f.figuresEstimated && f.hasStatement);
  if (unrec.length > 0)
    why.push(
      `${exPlural(unrec.length, 'fund')} with a statement ${unrec.length === 1 ? 'does' : 'do'} not reconcile (${nameList(unrec.map((f) => f.name))}), so the lines may be incomplete`,
    );
  return explain({
    id: 'invest.xirr',
    title: 'Yearly return on amount invested (XIRR)',
    what: 'The single yearly rate that makes every payment you made, every payment you took out and today’s value balance, given the date of each.',
    how: `Find the rate r so that each payment in (−) and out (+), grown at r from its date, plus today’s value ${exInr(h.value)} on ${exDate(i.today)}, adds up to zero. Over ${exPlural(flowsStatement + flowsPlan, 'dated payment')} from ${exDate(first)} to ${exDate(i.today)} the answer is ${exSignedPct(h.xirr, 1)} a year. It is a money-weighted return: when you paid in matters.`,
    inputs: [
      ...(fromStatement.length > 0
        ? [
            {
              label: 'Payments from statements',
              value: exPlural(flowsStatement, 'payment'),
              basis: 'statement' as const,
              from: minDate(fromStatement.map((f) => f.flowsFrom)),
              to: maxDate(fromStatement.map((f) => f.flowsTo)),
              count: { n: fromStatement.length, of: c.total, noun: 'funds' },
            },
          ]
        : []),
      ...(fromPlan.length > 0
        ? [
            {
              label: 'Payments worked out from start date and SIP',
              value: exPlural(flowsPlan, 'payment'),
              basis: 'estimated' as const,
              from: minDate(fromPlan.map((f) => f.flowsFrom)),
              to: maxDate(fromPlan.map((f) => f.flowsTo)),
              count: { n: fromPlan.length, of: c.total, noun: 'funds' },
              note: nameList(fromPlan.map((f) => f.name)),
            },
          ]
        : []),
      {
        label: 'Today’s value as the last inflow',
        value: exInr(h.value),
        basis: 'calculated' as const,
        to: i.today,
      },
      ...(left.length > 0
        ? [
            {
              label: 'Left out: no start date or statement',
              value: exInr(left.reduce((a, f) => a + f.value, 0)),
              basis: 'missing' as const,
              count: { n: left.length, noun: 'funds' },
              note: nameList(left.map((f) => f.name)),
            },
          ]
        : []),
    ],
    level: partly
      ? fromPlan.length === used.length
        ? 'estimated'
        : 'partly_estimated'
      : 'complete',
    completeness: partly
      ? `Partly estimated: ${why.join('; ')}.`
      : `Every payment comes from a fund statement that adds up (${exPlural(flowsStatement, 'payment')} from ${exDate(first)}).`,
    notes: [
      'Units that were already held before the first line on a statement count as paid in on that first day at that day’s price, so they are not read as a gain.',
      'Units bought with a reinvested dividend are not a payment from your pocket and are not counted as one.',
      'A return worked out over less than a year can look extreme; the page shows the yearly rate only once there is enough history.',
    ],
    fix: partly
      ? { label: 'See which funds need history (data check)', href: i.links.dataCheck }
      : undefined,
    also: [
      partly ? { label: 'Import a fund statement', href: i.links.import } : null,
      { label: 'See returns by period', href: i.links.performance },
    ],
  });
}

function bookedExplain(i: InvestExplainInput, c: Coverage): Explain {
  const r = i.hero.realised;
  if (r.sales === 0)
    return explain({
      id: 'invest.booked',
      title: 'Profit booked by selling',
      what: 'The gain or loss already locked in by units you sold.',
      how: 'No sale is on the statements imported so far, so nothing is shown. Nothing has been booked, or the statements are not imported yet.',
      inputs: [
        {
          label: 'Sales on statements',
          value: '0',
          basis: c.withStatement > 0 ? 'statement' : 'missing',
          count: { n: c.withStatement, of: c.total, noun: 'funds with a statement' },
        },
      ],
      level: c.withStatement === c.total && c.total > 0 ? 'complete' : 'missing',
      completeness:
        c.withStatement === c.total && c.total > 0
          ? 'Every fund has a statement and none shows a sale.'
          : `${c.noStatement} of ${exPlural(c.total, 'fund')} ${c.noStatement === 1 ? 'has' : 'have'} no statement, so a sale there would not show.`,
      fix:
        c.noStatement > 0 ? { label: 'Import a fund statement', href: i.links.import } : undefined,
    });
  return explain({
    id: 'invest.booked',
    title: 'Profit booked by selling',
    exact: exSigned(r.total),
    shown: compactIfBig(r.total),
    what: 'The gain or loss already locked in by units you sold, from the sale lines on your statements.',
    how: `For each sale: money received − what those units cost (oldest units sold first). Short-term ${exSigned(r.stcg)} + long-term ${exSigned(r.ltcg)} + funds taxed another way ${exSigned(r.other)} = ${exSigned(r.total)} over ${exPlural(r.sales, 'sale line')}.`,
    inputs: [
      {
        label: 'Sale lines on statements',
        value: String(r.sales),
        basis: 'statement',
        from: i.saleDates.first,
        to: i.saleDates.last,
        count: { n: r.sales, noun: 'sale lines' },
      },
      ...(r.unknown > 0
        ? [
            {
              label: 'Sales whose purchase is not on the statement',
              value: String(r.unknown),
              basis: 'missing' as const,
              note: 'their gain is left out',
            },
          ]
        : []),
    ],
    level: r.unknown > 0 ? 'partly_estimated' : 'complete',
    completeness:
      r.unknown > 0
        ? `${r.unknown} of ${exPlural(r.sales, 'sale')} used units whose purchase is not on a statement, so ${r.unknown === 1 ? 'its gain is' : 'their gains are'} left out and the real figure differs.`
        : `Every sale line has its purchase cost on a statement.`,
    notes: ['These are gains, not tax. The tax and the filing schedule are on the Tax pages.'],
    fix: r.unknown > 0 ? { label: 'Import earlier history', href: i.links.import } : undefined,
  });
}

function totalGainExplain(i: InvestExplainInput, c: Coverage): Explain {
  const h = i.hero;
  return explain({
    id: 'invest.totalGain',
    title: 'Total profit (held and booked)',
    exact: exSigned(h.totalGain),
    shown: compactIfBig(h.totalGain),
    what: 'The gain on units you still hold plus the gain already booked by selling.',
    how: `Profit on units held ${exSigned(h.unrealised)} + booked by selling ${exSigned(h.realised.total)} = ${exSigned(h.totalGain)}.`,
    inputs: [
      {
        label: 'Profit or loss on units held',
        value: exSigned(h.unrealised),
        basis: historyLevel(c) === 'complete' ? 'calculated' : 'estimated',
        to: i.today,
      },
      {
        label: 'Booked by selling',
        value: exSigned(h.realised.total),
        basis: h.realised.sales > 0 ? 'statement' : 'missing',
        from: i.saleDates.first,
        to: i.saleDates.last,
        count: { n: h.realised.sales, noun: 'sale lines' },
      },
    ],
    level: worst2(historyLevel(c), h.realised.unknown > 0 ? 'partly_estimated' : 'complete'),
    completeness: `${historyText(c)}${h.realised.unknown > 0 ? ` ${h.realised.unknown} sale(s) have no purchase cost and are left out.` : ''}`,
    notes: ['No tax is deducted from either part.'],
    fix: fixFor(c, i.links),
  });
}

const RANK: Record<ExplainLevel, number> = {
  complete: 0,
  partly_estimated: 1,
  estimated: 2,
  missing: 3,
};
const worst2 = (a: ExplainLevel, b: ExplainLevel): ExplainLevel => (RANK[a] >= RANK[b] ? a : b);

function sipExplain(i: InvestExplainInput): Explain {
  const running = i.funds.filter((f) => f.sipMonthly && f.sipMonthly > 0 && !f.sipStopped);
  const stopped = i.funds.filter((f) => f.sipMonthly && f.sipMonthly > 0 && f.sipStopped);
  const total = running.reduce((a, f) => a + (f.sipMonthly ?? 0), 0);
  return explain({
    id: 'invest.sip',
    title: 'SIP a month',
    exact: exInr(i.hero.sipMonthly),
    what: 'The total monthly investment going into your funds through running SIPs.',
    how:
      running.length === 0
        ? 'No fund has a running SIP recorded.'
        : `Monthly amount of each running SIP added: ${running.map((f) => `${exInr(f.sipMonthly ?? 0)}`).join(' + ')} = ${exInr(total)} over ${exPlural(running.length, 'fund')}.`,
    inputs: [
      {
        label: 'Running SIPs',
        value: exInr(total),
        basis: 'recorded',
        count: { n: running.length, of: i.funds.length, noun: 'funds' },
        note: running.length > 0 ? nameList(running.map((f) => f.name)) : undefined,
      },
      ...(stopped.length > 0
        ? [
            {
              label: 'Stopped SIPs (not counted)',
              value: exInr(stopped.reduce((a, f) => a + (f.sipMonthly ?? 0), 0)),
              basis: 'recorded' as const,
              count: { n: stopped.length, noun: 'funds' },
              note: nameList(stopped.map((f) => f.name)),
            },
          ]
        : []),
    ],
    level: running.length === 0 ? (stopped.length > 0 ? 'complete' : 'missing') : 'complete',
    completeness:
      running.length === 0
        ? 'No SIP amount is recorded for any fund.'
        : 'The amounts are the monthly investment set on each fund; they are not read from the bank, so a change at the fund house shows only once you edit the fund or import a newer statement.',
    notes: ['A SIP marked stopped is left out, because its instalments no longer go in.'],
    fix: { label: 'See each fund’s monthly investment', href: i.links.funds },
  });
}

function longTermExplain(i: InvestExplainInput): Explain {
  const hold = i.stats.holding;
  const months = i.holdingMonths;
  if (months === null)
    return explain({
      id: 'invest.longTerm',
      title: 'Long-term share',
      what: 'The share of your equity-fund value held long enough to count as long-term for tax.',
      how: 'Not worked out: no long-term period is set in the tax rules.',
      inputs: [{ label: 'Long-term period (tax rules)', value: 'not set', basis: 'missing' }],
      level: 'missing',
      completeness: 'Missing: the long-term period in the tax rules in Settings.',
      fix: { label: 'Open the tax rules in Settings', href: i.links.settings },
    });
  if (hold.longShare === null)
    return explain({
      id: 'invest.longTerm',
      title: 'Long-term share',
      what: `The share of your equity-fund value held for over ${months} months.`,
      how: 'Not worked out: the purchase dates are needed, from a fund statement or from a start date with a live price.',
      inputs: [{ label: 'Purchase dates', value: 'not known', basis: 'missing' }],
      level: 'missing',
      completeness: 'Missing: purchase dates for the equity funds.',
      fix: { label: 'Import a fund statement', href: i.links.import },
    });
  const b = hold.fundsByBasis;
  const n = b.statement + b.estimated + b.none;
  return explain({
    id: 'invest.longTerm',
    title: 'Long-term share',
    what: `The share of your equity-fund value in units bought over ${months} months ago, which get the long-term tax rate.`,
    how: `Value of units held over ${months} months ${exInr(hold.longValue)} ÷ (that + units held for less ${exInr(hold.shortValue)}) = ${exPct(hold.longShare, 1)}. Only equity-oriented funds are counted; each unit is dated by its purchase.`,
    inputs: [
      {
        label: `Units held over ${months} months`,
        value: exInr(hold.longValue),
        basis: b.estimated > 0 ? 'estimated' : 'statement',
        to: i.today,
      },
      {
        label: 'Units held for less',
        value: exInr(hold.shortValue),
        basis: b.estimated > 0 ? 'estimated' : 'statement',
        to: i.today,
      },
      ...(b.statement > 0
        ? [
            {
              label: 'Purchases from statements',
              value: exPlural(b.statement, 'fund'),
              basis: 'statement' as const,
              count: { n: b.statement, of: n, noun: 'equity funds' },
            },
          ]
        : []),
      ...(b.estimated > 0
        ? [
            {
              label: 'Purchases rebuilt from SIP plan and prices',
              value: exPlural(b.estimated, 'fund'),
              basis: 'estimated' as const,
              count: { n: b.estimated, of: n, noun: 'equity funds' },
            },
          ]
        : []),
      ...(b.none > 0 || hold.unknownValue > 0
        ? [
            {
              label: 'Purchases not known (left out)',
              value: exInr(hold.unknownValue),
              basis: 'missing' as const,
              count: { n: b.none, noun: 'funds' },
            },
          ]
        : []),
      ...(hold.otherValue > 0
        ? [
            {
              label: 'Debt, gold, international, hybrid (other rule, not counted)',
              value: exInr(hold.otherValue),
              basis: 'recorded' as const,
            },
          ]
        : []),
    ],
    level:
      b.none > 0
        ? 'partly_estimated'
        : b.estimated > 0
          ? b.statement > 0
            ? 'partly_estimated'
            : 'estimated'
          : 'complete',
    completeness:
      b.estimated === 0 && b.none === 0
        ? `All ${exPlural(b.statement, 'equity fund')} have their purchases on a statement.`
        : `${b.statement} of ${exPlural(n, 'equity fund')} from statements, ${b.estimated} rebuilt from the SIP plan, ${b.none} with unknown purchases.`,
    notes: [
      `The ${months}-month period is the tax rule in Settings, not a number fixed in the app.`,
      hold.nextTurn
        ? `Next to turn long-term: ${exInr(hold.nextTurn.value)} of ${hold.nextTurn.fund} on ${exDate(hold.nextTurn.on)}.`
        : null,
    ],
    fix:
      b.estimated + b.none > 0
        ? { label: 'Import a fund statement', href: i.links.import }
        : undefined,
  });
}

function statementsExplain(i: InvestExplainInput, c: Coverage): Explain {
  const needing = i.funds.filter((f) => f.ledgerStatus !== 'complete');
  const lines = (Object.keys(c.byStatus) as LedgerStatus[])
    .filter((s) => s !== 'complete' && c.byStatus[s].length > 0)
    .map(
      (s) =>
        `${c.byStatus[s].length} ${STATUS_WORD[s]} (${nameList(
          c.byStatus[s].map((f) => f.name),
          3,
        )})`,
    );
  const per = i.ledger.filter((l) => l.startsLate && l.lateNote);
  return explain({
    id: 'invest.statements',
    title: 'Statements and reconciliation',
    what: 'How many funds have transactions read from a fund statement, and how many of those add up to the units held.',
    how: `${c.withStatement} of ${exPlural(c.total, 'fund')} have statement lines. ${c.noStatement} ${c.noStatement === 1 ? 'is' : 'are'} estimated from the start date and SIP. ${c.unreconciled} ${c.unreconciled === 1 ? 'is' : 'are'} not reconciled (the transactions do not add up to the units held, or there are none), so figures resting on ${c.unreconciled === 1 ? 'it' : 'them'} carry “est.”.`,
    inputs: [
      {
        label: 'Funds with statement lines',
        value: `${c.withStatement} of ${c.total}`,
        basis: 'statement',
        from: minDate(i.funds.map((f) => f.firstTxnOn)),
        to: maxDate(i.funds.map((f) => f.lastTxnOn)),
        count: { n: c.withStatement, of: c.total, noun: 'funds' },
      },
      {
        label: 'Funds estimated (no statement)',
        value: String(c.noStatement),
        basis: c.noStatement > 0 ? 'estimated' : 'statement',
        count: { n: c.noStatement, of: c.total, noun: 'funds' },
        ...(c.noStatement > 0
          ? { note: nameList(i.funds.filter((f) => !f.hasStatement).map((f) => f.name)) }
          : {}),
      },
      {
        label: 'Funds that reconcile',
        value: `${c.reconciled} of ${c.total}`,
        basis: 'calculated',
        count: { n: c.reconciled, of: c.total, noun: 'funds' },
      },
      ...needing.slice(0, 5).map((f) => ({
        label: f.name,
        value: STATUS_WORD[f.ledgerStatus],
        basis: (f.hasStatement ? 'estimated' : 'missing') as ExplainBasis,
        note: f.ledgerWhy || undefined,
      })),
    ],
    level: historyLevel(c),
    completeness:
      c.unreconciled === 0
        ? `All ${exPlural(c.total, 'fund')} reconcile with their statements.`
        : `${lines.join('; ')}.`,
    notes: [
      needing.length > 5 ? `${needing.length - 5} more funds are listed in the data check.` : null,
      ...per.map((l) => `${l.name}: ${l.lateNote}`),
      `Histories should start from ${exDate(i.historyFrom)} (a Settings value).`,
    ],
    fix: { label: 'Open the data check', href: i.links.dataCheck },
    also: [{ label: 'Import a fund statement', href: i.links.import }],
  });
}

function projectionExplain(i: InvestExplainInput): Explain {
  const p = i.pace;
  const first = p.years[0];
  return explain({
    id: 'invest.projection',
    title: 'The projection',
    what: 'What today’s value and today’s SIPs would grow to if the same yearly return carried on. A projection, not a promise.',
    how: first
      ? `Today’s value ${exInr(i.hero.value)} grown at ${(p.rate * 100).toFixed(1)}% a year, with ${exInr(i.hero.sipMonthly)} added each month, gives ${p.years.map((y) => `${exInr(y.expected)} in ${y.years} year${y.years === 1 ? '' : 's'}`).join(', ')}. The range around each is ± ${(p.spread * 100).toFixed(0)} points of return.`
      : 'No projection: the value and a return are needed.',
    inputs: [
      {
        label: 'Yearly return used',
        value: `${(p.rate * 100).toFixed(1)}%`,
        basis: p.assumed ? 'estimated' : 'calculated',
        note: p.assumed
          ? `assumed: no annual return yet, so half the cap of ${(p.cap * 100).toFixed(0)}% is used`
          : `your annual return so far, kept between 0% and the cap of ${(p.cap * 100).toFixed(0)}%`,
      },
      { label: 'Today’s value', value: exInr(i.hero.value), basis: 'calculated', to: i.today },
      { label: 'SIP a month', value: exInr(i.hero.sipMonthly), basis: 'recorded' },
    ],
    level: p.assumed ? 'estimated' : 'partly_estimated',
    completeness: p.assumed
      ? 'Estimated: the return is assumed, because no annual return can be worked out yet.'
      : 'Partly estimated: today’s value is calculated, but the return is your past return carried forward, which the future will not repeat.',
    notes: [
      `The cap (${(p.cap * 100).toFixed(0)}%) and the spread are saved settings.`,
      'Funds have no maturity value; there is no date on which this is paid out.',
    ],
  });
}

// ------------------------------------------------------------------------------------------------
// The overview cards
// ------------------------------------------------------------------------------------------------
function dataCheckExplain(i: InvestExplainInput, c: Coverage): Explain {
  return explain({
    id: 'invest.dataCheck',
    title: 'Is the history complete?',
    what: 'A check, person by person, of whether the transactions on file add up to the units each fund holds.',
    how: `For each fund the lines are replayed in order: units after each line must equal the line before plus its own units; the units they lead to must equal the unit count recorded for the same date; and their cost must match the amount recorded. ${c.reconciled} of ${exPlural(c.total, 'fund')} pass.`,
    inputs: i.ledger.map((l) => ({
      label: l.name,
      value: `${l.complete} of ${l.funds} reconcile`,
      basis: (l.complete === l.funds ? 'statement' : 'estimated') as ExplainBasis,
      from: l.earliestTxnOn,
      to: i.today,
      count: { n: l.complete, of: l.funds, noun: 'funds' },
      note:
        l.need.length > 0
          ? l.need
              .slice(0, 2)
              .map((n) => `${n.name}: ${n.why}`)
              .join(' ')
          : undefined,
    })),
    level: historyLevel(c),
    completeness: historyText(c),
    notes: [
      'Lines assumed from a SIP plan are never treated as evidence; they are counted and named, not trusted.',
      'The tolerances (units, rupees) and the date histories should start from are Settings.',
    ],
    also: [{ label: 'Import a fund statement', href: i.links.import }],
  });
}

function valueChartExplain(i: InvestExplainInput, c: Coverage): Explain {
  const stmt = i.funds.filter((f) => f.hasStatement && !f.figuresEstimated);
  const rest = i.funds.filter((f) => !(f.hasStatement && !f.figuresEstimated));
  const first = minDate(i.funds.map((f) => f.firstTxnOn ?? f.startedOn ?? f.updatedOn));
  return explain({
    id: 'invest.valueChart',
    title: 'Value and money put in',
    what: 'The value of the funds against the cost of the units held, at each month end.',
    how: `At each month end: units held then × the price of that day = value; cost of the units held then = money put in. The last point is today (${exInr(i.hero.value)} value against ${exInr(i.hero.invested)} money put in).`,
    inputs: [
      {
        label: 'Funds from statement lines and prices',
        value: exPlural(stmt.length, 'fund'),
        basis: 'statement',
        from: first,
        to: i.today,
        count: { n: stmt.length, of: c.total, noun: 'funds' },
      },
      ...(rest.length > 0
        ? [
            {
              label: 'Funds from recorded values and the plan',
              value: exPlural(rest.length, 'fund'),
              basis: 'estimated' as const,
              count: { n: rest.length, of: c.total, noun: 'funds' },
              note: 'a month with no price falls back to a recorded value; the cost follows the amount entered',
            },
          ]
        : []),
    ],
    level: levelOfShare(rest.length, c.total),
    completeness:
      rest.length === 0
        ? `Every fund is drawn from its statement lines and published prices, ${exRange(first, i.today)}.`
        : `${rest.length} of ${exPlural(c.total, 'fund')} ${rest.length === 1 ? 'has' : 'have'} no statement that adds up: the line there follows the values you recorded.`,
    notes: [
      '“Money put in” is the cost of the units held at that date, the same as in the headline, so a sale lowers it.',
    ],
    fix: fixFor(c, i.links),
  });
}

function goalsExplain(i: InvestExplainInput): Explain {
  return explain({
    id: 'invest.goals',
    title: 'Goal by goal',
    what: 'The funds you have set aside for each goal, with what was put in, what they are worth and the gain.',
    how: `For each goal: value of its funds, money put in and gain = value − money put in; the percentage is gain ÷ money put in. ${i.goals.withGoal} ${i.goals.withGoal === 1 ? 'fund is' : 'funds are'} set aside for a goal; ${i.goals.without} ${i.goals.without === 1 ? 'is' : 'are'} not.`,
    inputs: [
      {
        label: 'Funds set aside for a goal',
        value: String(i.goals.withGoal),
        basis: 'recorded',
        count: { n: i.goals.withGoal, of: i.funds.length, noun: 'funds' },
        note: i.goals.names.length > 0 ? nameList(i.goals.names) : undefined,
      },
      {
        label: 'Funds with no goal',
        value: String(i.goals.without),
        basis: i.goals.without > 0 ? 'missing' : 'recorded',
        count: { n: i.goals.without, noun: 'funds' },
      },
      {
        label: 'Value of everything shown',
        value: exInr(i.hero.value),
        basis: 'calculated',
        to: i.today,
      },
    ],
    level: i.goals.without > 0 ? 'partly_estimated' : 'complete',
    completeness:
      i.goals.without > 0
        ? `${i.goals.without} fund(s) are not set aside for a goal, so they sit in a “no goal” row.`
        : 'Every fund is set aside for a goal.',
    notes: ['The goal of a fund is chosen in its Edit panel; a fund can be shared between goals.'],
    fix: { label: 'See the funds goal by goal', href: i.links.funds },
  });
}

function mixExplain(i: InvestExplainInput, c: Coverage): Explain {
  const uncertain = i.funds.filter((f) => !f.categoryCertain);
  return explain({
    id: 'invest.mix',
    title: 'Where the money is',
    what: 'How the value of the funds splits by kind of fund (large, mid and small cap, hybrid, debt…).',
    how: `Value of each kind ÷ total value ${exInr(i.hero.value)}, from the fund’s official category on the scheme list; where a fund is not matched, from words in its name.`,
    inputs: [
      {
        label: 'Kind from the official scheme list',
        value: exPlural(i.funds.length - uncertain.length, 'fund'),
        basis: 'statement',
        count: { n: i.funds.length - uncertain.length, of: c.total, noun: 'funds' },
      },
      ...(uncertain.length > 0
        ? [
            {
              label: 'Kind guessed from the name',
              value: exPlural(uncertain.length, 'fund'),
              basis: 'estimated' as const,
              count: { n: uncertain.length, noun: 'funds' },
              note: nameList(uncertain.map((f) => f.name)),
            },
          ]
        : []),
    ],
    level: levelOfShare(uncertain.length, c.total),
    completeness:
      uncertain.length === 0
        ? 'Every fund is matched to its official category.'
        : `${uncertain.length} of ${exPlural(c.total, 'fund')} are guessed from the name until matched.`,
    notes: [],
    fix: uncertain.length > 0 ? { label: 'Match funds', href: i.links.match } : undefined,
  });
}

function moversExplain(i: InvestExplainInput): Explain {
  const st = i.stats;
  const withDay = i.funds.filter((f) => f.dayPct !== null);
  return explain({
    id: 'invest.movers',
    title: 'Movers',
    what: 'The funds that moved most today and over their whole holding.',
    how: `Today: each fund’s change between its last two published prices (${exDate(minDate(withDay.map((f) => f.dayFrom)))} to ${exDate(maxDate(withDay.map((f) => f.dayTo)))}). Overall: value ÷ money put in − 1 for each fund with a cost, so it is a return on that fund’s own cost. Needs at least two funds.`,
    inputs: [
      {
        label: 'Funds with two published prices',
        value: String(withDay.length),
        basis: 'calculated',
        from: minDate(withDay.map((f) => f.dayFrom)),
        to: maxDate(withDay.map((f) => f.dayTo)),
        count: { n: withDay.length, of: i.funds.length, noun: 'funds' },
      },
      {
        label: 'Funds with a cost and a value',
        value: String(i.funds.filter((f) => f.invested > 0 && f.value > 0).length),
        basis: 'recorded',
        count: {
          n: i.funds.filter((f) => f.invested > 0 && f.value > 0).length,
          of: i.funds.length,
          noun: 'funds',
        },
      },
    ],
    level: st.best && st.bestDay ? 'complete' : 'partly_estimated',
    completeness:
      st.best && st.bestDay
        ? 'Both lists have at least two funds to compare.'
        : 'Too few funds with a cost or a live price to rank some lists.',
    notes: [
      'An overall percentage is not annualised: a fund held for a month and one held for ten years are compared on their plain change.',
    ],
  });
}

function nextSipsExplain(i: InvestExplainInput): Explain {
  const running = i.funds.filter((f) => f.sipMonthly && !f.sipStopped);
  const stmt = running.filter((f) => f.hasStatement);
  return explain({
    id: 'invest.nextSips',
    title: 'Next monthly investments',
    what: 'The next instalment of each running SIP, with its amount.',
    how: `Each running SIP’s monthly amount on its usual day of the month. The day follows your past instalments on the statement; a fund without one uses its start date, so that date is only expected. ${running.length} SIP${running.length === 1 ? '' : 's'} running.`,
    inputs: [
      {
        label: 'Day taken from statement instalments',
        value: exPlural(stmt.length, 'fund'),
        basis: 'statement',
        count: { n: stmt.length, of: running.length, noun: 'running SIPs' },
      },
      {
        label: 'Day expected from the start date',
        value: exPlural(running.length - stmt.length, 'fund'),
        basis: running.length - stmt.length > 0 ? 'estimated' : 'statement',
        count: { n: running.length - stmt.length, of: running.length, noun: 'running SIPs' },
      },
    ],
    level:
      running.length === 0 ? 'missing' : levelOfShare(running.length - stmt.length, running.length),
    completeness:
      running.length === 0
        ? 'No SIP is running.'
        : running.length === stmt.length
          ? 'Every SIP day is read from statement instalments.'
          : `${running.length - stmt.length} of ${running.length} dates are expected, not read from a statement.`,
    notes: [
      'The amount is the recorded monthly amount; the fund house may change it without telling this app.',
    ],
  });
}

function peopleExplain(i: InvestExplainInput): Explain {
  return explain({
    id: 'invest.people',
    title: 'Person against person',
    what: 'One line per person with the same figures side by side.',
    how: `Each column is worked out for that person’s funds alone, exactly as in the headline. Percentages state their base: profit % is ÷ money put in; “Share” is the person’s value ÷ the value of everyone shown (${exInr(i.hero.value)}); “Last 1Y” is the funds’ own price return over a year, not your return; “Long-term” is the long-term share of equity value; “Top n” is the share of the person’s value in their largest funds.`,
    inputs: i.ledger.map((l) => ({
      label: l.name,
      value: `${l.funds} funds`,
      basis: (l.complete === l.funds ? 'statement' : 'estimated') as ExplainBasis,
      to: i.today,
      count: { n: l.complete, of: l.funds, noun: 'funds reconciled' },
    })),
    level: levelOfShare(i.funds.filter((f) => f.figuresEstimated).length, i.funds.length),
    completeness: `${i.funds.filter((f) => f.figuresEstimated).length} of ${exPlural(i.funds.length, 'fund')} rest partly on an estimate.`,
    notes: ['A person’s return a year (XIRR) uses only that person’s cash flows.'],
    fix: { label: 'Open the data check', href: i.links.dataCheck },
  });
}

function fundsTableExplain(i: InvestExplainInput, c: Coverage): Explain {
  return explain({
    id: 'invest.fundsTable',
    title: 'The funds table',
    what: 'Every fund on one line with its money put in, value, gain, today’s move and annual return, and the totals of the group.',
    how: `Invested = cost of the units held. Value = units × latest price. Gain = value − invested; its % is gain ÷ invested. Today = move between the last two prices. Return a year = the fund’s own XIRR (“~” when estimated). Share = fund value ÷ ${exInr(i.hero.value)} (all funds shown). A group total adds its funds; its % is the group’s gain ÷ the group’s invested.`,
    inputs: [
      { label: 'Funds', value: String(c.total), basis: 'recorded', to: i.today },
      {
        label: 'With a statement',
        value: `${c.withStatement} of ${c.total}`,
        basis: 'statement',
        count: { n: c.withStatement, of: c.total, noun: 'funds' },
      },
      {
        label: 'Estimated or not reconciled',
        value: String(c.unreconciled),
        basis: c.unreconciled > 0 ? 'estimated' : 'statement',
        count: { n: c.unreconciled, of: c.total, noun: 'funds' },
      },
    ],
    level: historyLevel(c),
    completeness: historyText(c),
    notes: ['Hover a row for its full line; open a fund for the lots, tax and every transaction.'],
    fix: fixFor(c, i.links),
  });
}

// ------------------------------------------------------------------------------------------------
// The breakdown cards
// ------------------------------------------------------------------------------------------------
function shareCard(
  id: 'invest.byKind' | 'invest.byHouse' | 'invest.byFund',
  title: string,
  what: string,
  sourceNote: string,
  i: InvestExplainInput,
  missing: { n: number; word: string; fixLabel: string; href: string },
): Explain {
  return explain({
    id,
    title,
    what,
    how: `Value of each slice ÷ total value ${exInr(i.hero.value)} = its share. Small slices beyond the limit set in Settings are folded into “Other”. ${sourceNote}`,
    inputs: [
      {
        label: 'Total value',
        value: exInr(i.hero.value),
        basis: 'calculated',
        to: i.today,
        count: { n: i.funds.length, noun: 'funds' },
      },
      ...(missing.n > 0
        ? [
            {
              label: missing.word,
              value: String(missing.n),
              basis: 'missing' as const,
              count: { n: missing.n, of: i.funds.length, noun: 'funds' },
            },
          ]
        : []),
    ],
    level: missing.n === 0 ? 'complete' : 'partly_estimated',
    completeness:
      missing.n === 0
        ? 'Every fund is placed.'
        : `${missing.n} of ${exPlural(i.funds.length, 'fund')} are not placed, so they appear under “not known”.`,
    notes: [],
    fix: missing.n > 0 ? { label: missing.fixLabel, href: missing.href } : undefined,
  });
}

function keyFiguresExplain(i: InvestExplainInput, c: Coverage): Explain {
  return explain({
    id: 'invest.keyFigures',
    title: 'Key figures',
    what: 'The headline numbers for the funds shown, in one grid.',
    how: `Money put in ${exInr(i.hero.invested)} · value ${exInr(i.hero.value)} · gain ${exSigned(i.hero.unrealised)} (${i.hero.unrealisedPct === null ? '–' : exSignedPct(i.hero.unrealisedPct, 1)} of the money put in) · annual return ${i.hero.xirr === null ? '–' : exSignedPct(i.hero.xirr, 1)}. Best and weakest are each fund’s value ÷ cost − 1.`,
    inputs: [
      { label: 'Funds', value: String(c.total), basis: 'recorded', to: i.today },
      {
        label: 'Folios',
        value: String(i.hero.folios),
        basis: i.hero.folios > 0 ? 'statement' : 'missing',
        note: 'folio numbers come from a fund statement',
      },
    ],
    level: historyLevel(c),
    completeness: historyText(c),
    notes: ['Each tile also has its own “?” in the headline on the Overview tab.'],
    fix: fixFor(c, i.links),
  });
}

function plansExplain(i: InvestExplainInput): Explain {
  const unknown = i.funds.filter((f) => f.plan === 'unknown');
  return explain({
    id: 'invest.plans',
    title: 'Direct and Regular plans',
    what: 'The share of value in Direct plans (no distributor commission) and Regular plans.',
    how: `Value of the funds in each plan ÷ total value ${exInr(i.hero.value)}. The plan is read from a statement or the scheme list, or set in the fund’s Edit panel.`,
    inputs: [
      {
        label: 'Direct',
        value: exInr(i.funds.filter((f) => f.plan === 'direct').reduce((a, f) => a + f.value, 0)),
        basis: 'recorded',
        count: { n: i.funds.filter((f) => f.plan === 'direct').length, noun: 'funds' },
      },
      {
        label: 'Regular',
        value: exInr(i.funds.filter((f) => f.plan === 'regular').reduce((a, f) => a + f.value, 0)),
        basis: 'recorded',
        count: { n: i.funds.filter((f) => f.plan === 'regular').length, noun: 'funds' },
      },
      ...(unknown.length > 0
        ? [
            {
              label: 'Plan not set',
              value: exInr(unknown.reduce((a, f) => a + f.value, 0)),
              basis: 'missing' as const,
              count: { n: unknown.length, noun: 'funds' },
              note: nameList(unknown.map((f) => f.name)),
            },
          ]
        : []),
    ],
    level: unknown.length === 0 ? 'complete' : 'partly_estimated',
    completeness:
      unknown.length === 0
        ? 'The plan of every fund is known.'
        : `${unknown.length} of ${exPlural(i.funds.length, 'fund')} have no plan set.`,
    notes: [
      'The rupees saved by a Direct plan are not worked out: expense ratios are not in the free price data used.',
    ],
    fix:
      unknown.length > 0
        ? { label: 'Set the plan in each fund’s Edit panel', href: i.links.funds }
        : undefined,
  });
}

function ageingExplain(i: InvestExplainInput): Explain {
  const b = i.stats.holding.fundsByBasis;
  const est = i.funds.filter((f) => f.lotsBasis === 'estimated').length;
  const stmt = i.funds.filter((f) => f.lotsBasis === 'statement').length;
  const none = i.funds.filter((f) => f.lotsBasis === 'none').length;
  void b;
  return explain({
    id: 'invest.ageing',
    title: 'How old the units are',
    what: 'The value of the units you hold, grouped by how long ago each purchase was made.',
    how: `Each purchase still held is valued at today’s price (units × latest price) and put in a band by the date it was bought. Bands are set in Settings. Total ${exInr(i.hero.value)}; funds whose purchases are not known are left out.`,
    inputs: [
      {
        label: 'Purchases from statements',
        value: exPlural(stmt, 'fund'),
        basis: 'statement',
        from: minDate(i.funds.map((f) => f.firstTxnOn)),
        to: i.today,
        count: { n: stmt, of: i.funds.length, noun: 'funds' },
      },
      {
        label: 'Purchases rebuilt from SIP plan and prices',
        value: exPlural(est, 'fund'),
        basis: est > 0 ? 'estimated' : 'statement',
        count: { n: est, of: i.funds.length, noun: 'funds' },
      },
      {
        label: 'Purchases not known (left out)',
        value: exPlural(none, 'fund'),
        basis: none > 0 ? 'missing' : 'statement',
        count: { n: none, of: i.funds.length, noun: 'funds' },
      },
    ],
    level:
      none + est === 0
        ? 'complete'
        : est + none === i.funds.length
          ? 'estimated'
          : 'partly_estimated',
    completeness:
      none + est === 0
        ? 'Every fund’s purchases are on a statement that adds up.'
        : `${stmt} of ${exPlural(i.funds.length, 'fund')} from statements, ${est} rebuilt from the plan, ${none} unknown.`,
    notes: [
      'Units from before the first line on a statement go in the “before the statement” band.',
    ],
    fix: est + none > 0 ? { label: 'Import a fund statement', href: i.links.import } : undefined,
  });
}

function gainByFundExplain(i: InvestExplainInput, c: Coverage): Explain {
  return explain({
    id: 'invest.gainByFund',
    title: 'Gain or loss by fund',
    what: 'For each fund, its value less the money put in on the units still held.',
    how: `Value − money put in for each fund (these add up to ${exSigned(i.hero.unrealised)}); the percentage is the gain ÷ that fund’s money put in.`,
    inputs: [
      {
        label: 'Funds with a cost and a value',
        value: String(i.funds.filter((f) => f.invested > 0 && f.value > 0).length),
        basis: 'recorded',
        count: {
          n: i.funds.filter((f) => f.invested > 0 && f.value > 0).length,
          of: c.total,
          noun: 'funds',
        },
        to: i.today,
      },
    ],
    level: historyLevel(c),
    completeness: historyText(c),
    notes: ['Gains already booked by selling are not in these bars.'],
    fix: fixFor(c, i.links),
  });
}

function longTermCardExplain(i: InvestExplainInput): Explain {
  return {
    ...longTermExplain(i),
    id: 'invest.longTermCard',
    title: 'How much is long-term already',
  };
}

function sipCardExplain(i: InvestExplainInput): Explain {
  const sip = i.stats.sip;
  return explain({
    id: 'invest.sipCard',
    title: 'Monthly investments (SIP)',
    what: 'The running and stopped SIPs, what has been paid so far and when the next instalment is due.',
    how: `Going in each month = running SIP amounts added = ${exInr(sip.monthly)} (${sip.running} running, ${sip.stopped} stopped). Paid so far = the instalment lines on statements${sip.totalPaid === null ? ' (none yet)' : ` = ${exInr(sip.totalPaid)} over ${exPlural(sip.paidFunds, 'fund')}`}. Longest running counts months from the first instalment. Next instalment = the earliest due date.`,
    inputs: [
      {
        label: 'Running SIPs',
        value: exInr(sip.monthly),
        basis: 'recorded',
        count: { n: sip.running, noun: 'funds' },
      },
      {
        label: 'Instalments paid, from statements',
        value: sip.totalPaid === null ? 'none' : exInr(sip.totalPaid),
        basis: sip.totalPaid === null ? 'missing' : 'statement',
        count: { n: sip.paidFunds, of: i.funds.length, noun: 'funds' },
      },
      {
        label: 'Next instalment',
        value: sip.next ? exDate(sip.next.on) : '–',
        basis: sip.next ? (sip.next.estimated ? 'estimated' : 'statement') : 'missing',
        note: sip.next ? `${exInr(sip.next.amount)} · ${sip.next.fund}` : undefined,
      },
    ],
    level:
      sip.totalPaid === null
        ? 'partly_estimated'
        : sip.paidFunds < sip.running + sip.stopped
          ? 'partly_estimated'
          : 'complete',
    completeness:
      sip.totalPaid === null
        ? 'No statement shows instalments yet, so “paid so far” is missing.'
        : `Instalments are read from the statements of ${sip.paidFunds} of ${sip.running + sip.stopped} funds.`,
    notes: [],
    fix:
      sip.totalPaid === null
        ? { label: 'Import a fund statement', href: i.links.import }
        : undefined,
  });
}

function bookedCardExplain(i: InvestExplainInput, c: Coverage): Explain {
  return {
    ...bookedExplain(i, c),
    id: 'invest.bookedCard',
    title: 'Gains already booked by selling',
  };
}

// ------------------------------------------------------------------------------------------------
// The whole set
// ------------------------------------------------------------------------------------------------
/** What the Performance tab's explainers need to know about the funds and the headline. */
export function perfContextOf(i: InvestExplainInput): PerfContext {
  const c = coverage(i.funds);
  return {
    today: i.today,
    scope: i.scope,
    hero: i.hero,
    links: i.links,
    coverage: {
      total: c.total,
      unreconciled: c.unreconciled,
      noStatement: c.noStatement,
      withStatement: c.withStatement,
    },
  };
}

/** The overview, funds and breakdown explainers; the Performance tab's come from `buildPerfExplain`. */
export type InvestOverviewSet = Omit<ExplainSet<'investments'>, keyof PerfExplainSet>;

export function buildInvestExplain(i: InvestExplainInput): InvestOverviewSet {
  const c = coverage(i.funds);
  const value = valueExplain(i, c);
  const money = moneyInExplain(i, c);
  return {
    'invest.value': value,
    'invest.profit': profitExplain(i, c, money, value),
    'invest.today': todayExplain(i, c),
    'invest.ring': ringExplain(i, c),
    'invest.moneyIn': money,
    'invest.xirr': xirrExplain(i, c),
    'invest.booked': bookedExplain(i, c),
    'invest.totalGain': totalGainExplain(i, c),
    'invest.sip': sipExplain(i),
    'invest.longTerm': longTermExplain(i),
    'invest.statements': statementsExplain(i, c),
    'invest.projection': projectionExplain(i),
    'invest.dataCheck': dataCheckExplain(i, c),
    'invest.valueChart': valueChartExplain(i, c),
    'invest.goals': goalsExplain(i),
    'invest.mix': mixExplain(i, c),
    'invest.movers': moversExplain(i),
    'invest.nextSips': nextSipsExplain(i),
    'invest.people': peopleExplain(i),
    'invest.fundsTable': fundsTableExplain(i, c),
    'invest.byKind': shareCard(
      'invest.byKind',
      'By kind of fund',
      'How the value splits by kind of fund.',
      'A fund matched to the official list uses its category; otherwise the words in its name decide, and that is a guess.',
      i,
      {
        n: i.funds.filter((f) => !f.categoryCertain).length,
        word: 'Kind guessed from the name',
        fixLabel: 'Match funds',
        href: i.links.match,
      },
    ),
    'invest.byHouse': shareCard(
      'invest.byHouse',
      'By fund house',
      'How the value splits by fund house (AMC).',
      'The fund house comes from the official scheme list, so it appears once a fund is matched.',
      i,
      {
        n: i.funds.filter((f) => !f.livePrice).length,
        word: 'Funds not matched to the scheme list',
        fixLabel: 'Match funds',
        href: i.links.match,
      },
    ),
    'invest.byFund': shareCard(
      'invest.byFund',
      'By fund',
      'How the value splits fund by fund.',
      'Spread is 1 ÷ the sum of squared shares: how many equal-sized funds would be as spread out.',
      i,
      { n: 0, word: '', fixLabel: '', href: '' },
    ),
    'invest.keyFigures': keyFiguresExplain(i, c),
    'invest.plans': plansExplain(i),
    'invest.ageing': ageingExplain(i),
    'invest.gainByFund': gainByFundExplain(i, c),
    'invest.longTermCard': longTermCardExplain(i),
    'invest.sipCard': sipCardExplain(i),
    'invest.bookedCard': bookedCardExplain(i, c),
  };
}
