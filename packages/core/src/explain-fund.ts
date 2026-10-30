/**
 * The "?" explainers on one fund's page: the headline tiles (current value, invested, profit, annual return, today's move,
 * monthly investment), the units still held, the exit-load and tax panel, the booked profit and the returns by period.
 * Pure; the page passes the fund row, its detail and tax panel as plain facts.
 */
import {
  explain,
  exDate,
  exInr,
  exPct,
  exPlural,
  exRange,
  exSigned,
  exSignedPct,
  ratioHow,
  type Explain,
  type ExplainBasis,
  type ExplainLevel,
  type ExplainSet,
} from './explain';
import type { LedgerStatus } from './ledger-check';
import type { LotsBasis } from './fund-stats';

export interface FundExplainInput {
  today: string;
  name: string;
  value: number;
  invested: number;
  units: number | null;
  nav: number | null;
  navDate: string | null;
  livePrice: boolean;
  /** the page's own words for where the value comes from ("units × live price", ...) */
  valueBasis: string;
  hasStatement: boolean;
  ledgerStatus: LedgerStatus;
  /** the history does not add up (the "est." mark) */
  figuresEstimated: boolean;
  lotsBasis: LotsBasis;
  firstTxnOn: string | null;
  lastTxnOn: string | null;
  txnCount: number;
  /** where the unit count comes from */
  unitsFrom: 'ledger' | 'recorded' | 'none';
  positionUnitsAsOf: string | null;
  statementOn: string | null;
  dayAmount: number | null;
  dayPct: number | null;
  dayFrom: string | null;
  dayTo: string | null;
  xirr: number | null;
  xirrEstimated: boolean;
  flowCount: number;
  flowsFrom: string | null;
  flowsTo: string | null;
  flowsEstimated: boolean;
  avgCost: number | null;
  /** compound growth of a single investment, when all the money went in on one date */
  cagr: { rate: number; from: string } | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  sipNextOn: string | null;
  sipBasis: 'statement' | 'plan' | 'none';
  realised: {
    sales: number;
    stcg: number;
    ltcg: number;
    other: number;
    unknownCost: number;
    proceeds: number;
  };
  saleFirst: string | null;
  saleLast: string | null;
  /** the returns tab: 'price' = the fund's own published prices, 'values' = recorded values; null = none */
  returns: {
    basis: 'price' | 'values';
    estimated: boolean;
    from: string | null;
    to: string | null;
    benchName: string | null;
  } | null;
  tax: {
    classLabel: string;
    classCertain: boolean;
    basis: LotsBasis;
    estimated: boolean;
    exitLoadHeadline: string;
    exitLoadRuleSet: boolean;
    lots: number;
    stcgUnits: number;
    ltcgUnits: number;
    holdingMonths: number | null;
  };
  links: { dataCheck: string; import: string; match: string; tax: string };
}

type FundIds =
  | 'fund.value'
  | 'fund.moneyIn'
  | 'fund.profit'
  | 'fund.today'
  | 'fund.xirr'
  | 'fund.sip'
  | 'fund.units'
  | 'fund.tax'
  | 'fund.booked'
  | 'fund.returns';

export function buildFundExplain(i: FundExplainInput): ExplainSet<'fund'> {
  const reconciled = i.ledgerStatus === 'complete';
  const histLevel: ExplainLevel = reconciled
    ? 'complete'
    : i.hasStatement
      ? 'partly_estimated'
      : 'estimated';
  const histText = reconciled
    ? `The ${exPlural(i.txnCount, 'transaction line')} on file (${exRange(i.firstTxnOn, i.lastTxnOn)}) add up to the units held.`
    : i.hasStatement
      ? `The history on file (${exRange(i.firstTxnOn, i.lastTxnOn)}) does not add up to the units held, so figures that rest on it are marked estimated. See “Does this add up?” on the Overview tab.`
      : 'There is no fund statement for this fund: its figures are worked out from the start date, the amount entered and the SIP.';
  const histFix = reconciled
    ? undefined
    : { label: 'See what is missing (Does this add up?)', href: i.links.dataCheck };
  const histAlso = reconciled ? [] : [{ label: 'Import a fund statement', href: i.links.import }];
  const profit = i.value - i.invested;

  const unitsBasis: ExplainBasis =
    i.unitsFrom === 'ledger' ? 'statement' : i.unitsFrom === 'recorded' ? 'recorded' : 'missing';

  const value = explain({
    id: 'fund.value',
    title: 'Current value',
    exact: exInr(i.value),
    what: `What ${i.name} is worth now.`,
    how:
      i.units !== null && i.nav !== null
        ? `${i.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units × ₹${i.nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })} (price on ${exDate(i.navDate)}) = ${exInr(i.units * i.nav)}${Math.abs(i.units * i.nav - i.value) > 1 ? `; the value shown, ${exInr(i.value)}, is ${i.valueBasis}` : ''}.`
        : `${exInr(i.value)}: ${i.valueBasis}. The units or the price are not recorded, so it cannot be worked out from units × price.`,
    inputs: [
      {
        label: 'Units held',
        value:
          i.units === null
            ? 'not recorded'
            : i.units.toLocaleString('en-IN', { maximumFractionDigits: 3 }),
        basis: unitsBasis,
        to: i.unitsFrom === 'ledger' ? i.lastTxnOn : (i.positionUnitsAsOf ?? i.statementOn),
      },
      {
        label: 'Price (NAV)',
        value:
          i.nav === null
            ? 'none'
            : `₹${i.nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })}`,
        basis: i.livePrice && i.nav !== null ? 'statement' : 'missing',
        to: i.navDate,
        note: i.livePrice
          ? 'the fund house’s published price'
          : 'no live price: match this fund so its price is fetched every day',
      },
    ],
    level:
      i.valueBasis === 'units × live price' && reconciled
        ? 'complete'
        : i.valueBasis.startsWith('last recorded')
          ? 'estimated'
          : 'partly_estimated',
    completeness:
      i.valueBasis === 'units × live price' && reconciled
        ? `Units and price are both on record; the price is from ${exDate(i.navDate)}.`
        : `Value is ${i.valueBasis}.${reconciled ? '' : ' The history under the units does not add up.'}`,
    notes: [
      i.livePrice
        ? null
        : 'Without a live price the value stays at the last one recorded until you update it.',
    ],
    fix: i.livePrice ? histFix : { label: 'Match to follow its price', href: i.links.match },
    also: histAlso,
  });

  const moneyIn = explain({
    id: 'fund.moneyIn',
    title: 'Invested',
    exact: exInr(i.invested),
    what: 'What you paid for the units you still hold in this fund.',
    how: `Cost of the units still held (oldest units sold first) = ${exInr(i.invested)}${i.avgCost !== null && i.units ? `, which is ₹${i.avgCost.toLocaleString('en-IN', { maximumFractionDigits: 2 })} a unit on average (${exInr(i.invested)} ÷ ${i.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units)` : ''}.`,
    inputs: [
      {
        label: i.hasStatement
          ? 'Cost of units held, from statement lines'
          : 'Amount entered by hand',
        value: exInr(i.invested),
        basis:
          i.hasStatement && reconciled ? 'statement' : i.hasStatement ? 'estimated' : 'recorded',
        from: i.firstTxnOn,
        to: i.lastTxnOn ?? i.today,
        count: { n: i.txnCount, noun: 'lines' },
      },
    ],
    level: histLevel,
    completeness: histText,
    notes: ['Money that bought units since sold is not in this figure.'],
    fix: histFix,
    also: histAlso,
  });

  const pctBase = i.invested > 0 ? profit / i.invested : null;
  const profitE = explain({
    id: 'fund.profit',
    title: 'Profit',
    exact: exSigned(profit),
    what: 'How much the units you still hold are worth above (or below) what you paid for them.',
    how: `${exInr(i.value)} value − ${exInr(i.invested)} invested = ${exSigned(profit)}.${pctBase === null ? ' No cost is recorded, so no percentage.' : ` As a share of the amount invested: ${ratioHow({ label: 'profit', amount: profit }, { label: 'invested', amount: i.invested })}.`}`,
    inputs: [
      {
        label: 'Current value',
        value: exInr(i.value),
        basis: value.completeness.level === 'complete' ? 'calculated' : 'estimated',
        to: i.navDate ?? i.today,
      },
      {
        label: 'Invested',
        value: exInr(i.invested),
        basis: moneyIn.inputs[0]!.basis,
        from: i.firstTxnOn,
        to: i.today,
      },
    ],
    level: histLevel,
    completeness: histText,
    notes: ['Booked profit (from units sold) is separate: see Booked profit.'],
    fix: histFix,
    also: histAlso,
  });

  const today =
    i.dayPct === null || i.dayAmount === null
      ? explain({
          id: 'fund.today',
          title: 'Today’s move',
          what: 'How much the fund moved between its last two published prices.',
          how: 'Not worked out: two published prices are needed.',
          inputs: [{ label: 'Two published prices', value: 'none yet', basis: 'missing' }],
          level: 'missing',
          completeness: 'Missing: the fund needs a live price and an earlier price.',
          fix: { label: 'Match to follow its price', href: i.links.match },
        })
      : explain({
          id: 'fund.today',
          title: 'Today’s move',
          exact: exSigned(i.dayAmount),
          what: 'How much the fund moved between its last two published prices.',
          how: `Units × (latest price − previous price) = ${exSigned(i.dayAmount)}, which is ${exSignedPct(i.dayPct, 2)} of the price on ${exDate(i.dayFrom)}.`,
          inputs: [
            {
              label: 'Prices compared',
              value: exRange(i.dayFrom, i.dayTo),
              basis: 'statement',
              from: i.dayFrom,
              to: i.dayTo,
            },
          ],
          level: 'complete',
          completeness: `Both prices are published ones (${exRange(i.dayFrom, i.dayTo)}).`,
          notes: [
            'The latest trading day is used, so “today” can be a few days back after a weekend or holiday.',
          ],
        });

  const xirr =
    i.xirr === null
      ? explain({
          id: 'fund.xirr',
          title: 'Yearly return on amount invested (XIRR)',
          what: 'The single yearly rate your money has grown at, given the date of each payment.',
          how: 'Not worked out: a dated payment (from a statement or a start date) is needed.',
          inputs: [{ label: 'Dated payments', value: 'none', basis: 'missing' }],
          level: 'missing',
          completeness: 'Missing: a fund statement, or a start date and the amount invested.',
          fix: { label: 'Import a fund statement', href: i.links.import },
        })
      : explain({
          id: 'fund.xirr',
          title: 'Yearly return on amount invested (XIRR)',
          what: 'The single yearly rate your money has grown at, given the date of each payment in and out.',
          how: `Find the rate r so that each payment in and out, grown at r from its date, plus current value ${exInr(i.value)} on ${exDate(i.today)}, adds up to zero. ${exPlural(i.flowCount, 'dated payment')} from ${exDate(i.flowsFrom)} to ${exDate(i.flowsTo)} give ${exSignedPct(i.xirr, 1)} a year.`,
          inputs: [
            {
              label: i.flowsEstimated
                ? 'Payments worked out from start date and SIP'
                : 'Payments from the statement',
              value: exPlural(i.flowCount, 'payment'),
              basis: i.flowsEstimated ? 'estimated' : 'statement',
              from: i.flowsFrom,
              to: i.flowsTo,
            },
            {
              label: 'Today’s value as the last inflow',
              value: exInr(i.value),
              basis: 'calculated',
              to: i.today,
            },
          ],
          level: i.xirrEstimated
            ? i.flowsEstimated
              ? 'estimated'
              : 'partly_estimated'
            : 'complete',
          completeness: i.xirrEstimated
            ? i.flowsEstimated
              ? 'Estimated: with no fund statement the payments are worked out from the start date, the amount invested and the SIP.'
              : 'Partly estimated: the history does not add up, so the lines may be incomplete.'
            : `Every payment is read from the statement (${exRange(i.flowsFrom, i.flowsTo)}).`,
          notes: [
            'Units held before the first statement line count as paid in on that day at that day’s price.',
          ],
          fix: i.xirrEstimated
            ? { label: 'Import a fund statement', href: i.links.import }
            : undefined,
        });

  const sip = explain({
    id: 'fund.sip',
    title: 'Monthly investment',
    exact: i.sipMonthly ? exInr(i.sipMonthly) : undefined,
    what: 'The amount going into this fund each month through a SIP, and when the next instalment is due.',
    how: i.sipMonthly
      ? `${exInr(i.sipMonthly)} a month${i.sipStopped ? ', marked stopped (so not counted in the totals)' : ''}. ${i.sipNextOn ? `Next instalment: ${exDate(i.sipNextOn)}${i.sipBasis === 'statement' ? ', on the usual day of your past instalments' : ', expected from the start date'}.` : ''}`
      : 'No monthly investment is recorded for this fund.',
    inputs: [
      {
        label: 'SIP amount',
        value: i.sipMonthly ? exInr(i.sipMonthly) : 'none',
        basis: i.sipMonthly ? 'recorded' : 'missing',
      },
      {
        label: 'Day of the month',
        value: i.sipNextOn ? exDate(i.sipNextOn) : '–',
        basis: i.sipBasis === 'statement' ? 'statement' : i.sipNextOn ? 'estimated' : 'missing',
      },
    ],
    level: !i.sipMonthly ? 'missing' : i.sipBasis === 'statement' ? 'complete' : 'partly_estimated',
    completeness: !i.sipMonthly
      ? 'No SIP is recorded.'
      : i.sipBasis === 'statement'
        ? 'The amount is the one set on the fund; the day is read from the statement’s instalments.'
        : 'The amount is the one set on the fund; the day is expected from the start date, not read from a statement.',
    notes: [],
  });

  const units = explain({
    id: 'fund.units',
    title: 'Units still held',
    what: 'The units of this fund you hold now, and where that count comes from.',
    how: `${i.units === null ? 'The unit count is not recorded.' : `${i.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units, ${i.unitsFrom === 'ledger' ? 'the units the statement lines lead to' : i.unitsFrom === 'recorded' ? 'the count recorded on the fund' : 'not known'}.`} Each purchase still held is listed oldest first, valued at today’s price; its profit is current value − cost.`,
    inputs: [
      {
        label: 'Units',
        value:
          i.units === null
            ? 'not recorded'
            : i.units.toLocaleString('en-IN', { maximumFractionDigits: 3 }),
        basis: unitsBasis,
        to: i.unitsFrom === 'ledger' ? i.lastTxnOn : i.positionUnitsAsOf,
      },
      {
        label: 'Purchases',
        value:
          i.lotsBasis === 'none'
            ? 'not known'
            : i.lotsBasis === 'statement'
              ? 'from statement lines'
              : 'rebuilt from SIP plan and prices',
        basis:
          i.lotsBasis === 'statement'
            ? 'statement'
            : i.lotsBasis === 'estimated'
              ? 'estimated'
              : 'missing',
      },
    ],
    level:
      i.lotsBasis === 'statement' && reconciled
        ? 'complete'
        : i.lotsBasis === 'none'
          ? 'missing'
          : 'partly_estimated',
    completeness:
      i.lotsBasis === 'statement' && reconciled
        ? 'Every purchase is on a statement that adds up to the units.'
        : i.lotsBasis === 'none'
          ? 'Missing: the purchases are not known.'
          : `Purchases are ${i.lotsBasis === 'estimated' ? 'rebuilt from the SIP plan and published prices' : 'from a statement that does not add up'}; marked est.`,
    notes: [],
    fix: histFix,
    also: histAlso,
  });

  const t = i.tax;
  const tax = explain({
    id: 'fund.tax',
    title: 'Exit load and tax',
    what: 'Which units are still under an exit load, which are short-term or long-term for tax, and which are at a loss.',
    how: `${t.exitLoadHeadline} The ${exPlural(t.lots, 'purchase')} still held are placed in short-term or long-term by the date each was bought${t.holdingMonths !== null ? ` (long-term after ${t.holdingMonths} months, from the tax rules in Settings)` : ''}: ${t.stcgUnits.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units short-term, ${t.ltcgUnits.toLocaleString('en-IN', { maximumFractionDigits: 3 })} long-term.`,
    inputs: [
      {
        label: 'Kind of fund for tax',
        value: t.classLabel,
        basis: t.classCertain ? 'statement' : 'estimated',
        note: t.classCertain ? 'from the official category' : 'guessed from the fund’s name',
      },
      {
        label: 'Purchases',
        value:
          t.basis === 'none'
            ? 'none known'
            : t.basis === 'statement'
              ? 'from statement lines'
              : 'rebuilt from the plan',
        basis:
          t.basis === 'statement' ? 'statement' : t.basis === 'estimated' ? 'estimated' : 'missing',
        count: { n: t.lots, noun: 'purchases' },
      },
      {
        label: 'Exit load rule',
        value: t.exitLoadRuleSet ? 'set for this fund' : 'default from Settings',
        basis: t.exitLoadRuleSet ? 'recorded' : 'estimated',
      },
    ],
    level:
      t.basis === 'none'
        ? 'missing'
        : t.estimated
          ? 'partly_estimated'
          : t.classCertain
            ? 'complete'
            : 'partly_estimated',
    completeness:
      t.basis === 'none'
        ? 'Missing: no purchases are on file, so units cannot be split by age.'
        : t.estimated
          ? 'The split rests on purchases that are estimated or on a history that does not add up.'
          : t.classCertain
            ? 'Purchases are on a statement that adds up; the kind of fund is from the official category.'
            : 'The kind of fund is guessed from the name.',
    notes: ['This is not tax advice: rates and the allowance are the rules in Settings.'],
    fix: { label: 'Open the Tax page', href: i.links.tax },
    also: histAlso,
  });

  const r = i.realised;
  const booked =
    r.sales === 0
      ? explain({
          id: 'fund.booked',
          title: 'Profit booked by selling',
          what: 'The profit or loss already booked by units sold from this fund.',
          how: i.hasStatement
            ? 'No sale is on the statement.'
            : 'Needs a fund statement: no sale can be read without one.',
          inputs: [
            {
              label: 'Sales on the statement',
              value: '0',
              basis: i.hasStatement ? 'statement' : 'missing',
            },
          ],
          level: i.hasStatement ? 'complete' : 'missing',
          completeness: i.hasStatement
            ? 'The statement shows no sale.'
            : 'Missing: no statement for this fund.',
          fix: i.hasStatement
            ? undefined
            : { label: 'Import a fund statement', href: i.links.import },
        })
      : explain({
          id: 'fund.booked',
          title: 'Profit booked by selling',
          exact: exSigned(r.stcg + r.ltcg + r.other),
          what: 'The profit or loss already booked by units sold from this fund.',
          how: `For each sale: money received − what those units cost (oldest first). Short-term ${exSigned(r.stcg)} + long-term ${exSigned(r.ltcg)} + other ${exSigned(r.other)} = ${exSigned(r.stcg + r.ltcg + r.other)} over ${exPlural(r.sales, 'sale')}, ${exInr(r.proceeds)} received.`,
          inputs: [
            {
              label: 'Sales on the statement',
              value: String(r.sales),
              basis: 'statement',
              from: i.saleFirst,
              to: i.saleLast,
            },
            ...(r.unknownCost > 0
              ? [
                  {
                    label: 'Sales whose purchase is not on file',
                    value: String(r.unknownCost),
                    basis: 'missing' as const,
                    note: 'their profit is left out',
                  },
                ]
              : []),
          ],
          level: r.unknownCost > 0 ? 'partly_estimated' : 'complete',
          completeness:
            r.unknownCost > 0
              ? `${r.unknownCost} of ${exPlural(r.sales, 'sale')} used units bought before the statement began; their profit is left out.`
              : 'Every sale has its purchase cost on a statement.',
          notes: ['This is profit before tax; the tax is on the Tax pages.'],
          fix:
            r.unknownCost > 0
              ? { label: 'Import earlier history', href: i.links.import }
              : undefined,
        });

  const ret = i.returns;
  const returns = ret
    ? explain({
        id: 'fund.returns',
        title: 'Return over each period',
        what:
          ret.basis === 'price'
            ? 'The fund’s own return over each period, from its published prices (not your return).'
            : 'The return over each period from the values you recorded and the amount invested.',
        how:
          ret.basis === 'price'
            ? `For each period: price at the end ÷ price at the start − 1, as a rate per year from a year. Prices run ${exRange(ret.from, ret.to)}. It ignores when you put money in; your own return is the XIRR in the tiles above.`
            : `For each period: recorded value at the end ÷ at the start, after taking out invested. ${exRange(ret.from, ret.to)}.`,
        inputs: [
          {
            label: ret.basis === 'price' ? 'Published prices' : 'Recorded values',
            value: exRange(ret.from, ret.to),
            basis: ret.basis === 'price' ? 'statement' : 'recorded',
            from: ret.from,
            to: ret.to,
          },
          ...(ret.benchName
            ? [{ label: 'Benchmark (proxy)', value: ret.benchName, basis: 'statement' as const }]
            : []),
        ],
        level:
          ret.basis === 'price' ? 'complete' : ret.estimated ? 'estimated' : 'partly_estimated',
        completeness:
          ret.basis === 'price'
            ? 'Read from the fund’s published prices.'
            : ret.estimated
              ? 'No published prices: worked out from recorded values, with the amount invested estimated from the start date and SIP.'
              : 'No published prices: worked out from recorded values.',
        notes: ['The benchmark is the price of an index fund, a stand-in for the index.'],
        fix:
          ret.basis === 'price'
            ? undefined
            : { label: 'Match to follow its price', href: i.links.match },
      })
    : explain({
        id: 'fund.returns',
        title: 'Return over each period',
        what: 'The fund’s own return over each period.',
        how: 'Not worked out: the fund’s published prices are needed.',
        inputs: [{ label: 'Published prices', value: 'none', basis: 'missing' }],
        level: 'missing',
        completeness:
          'Missing: match the fund to its official scheme and the prices appear after the next daily fetch.',
        fix: { label: 'Match to follow its price', href: i.links.match },
      });

  void exPct;
  const out: Record<FundIds, Explain> = {
    'fund.value': value,
    'fund.moneyIn': moneyIn,
    'fund.profit': profitE,
    'fund.today': today,
    'fund.xirr': xirr,
    'fund.sip': sip,
    'fund.units': units,
    'fund.tax': tax,
    'fund.booked': booked,
    'fund.returns': returns,
  };
  return out;
}
