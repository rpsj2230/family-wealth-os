/**
 * The "?" explainers of Investments > Value by period: the chart of the total valuation and the table of change and gain. Pure; they
 * quote the rows the page shows, never a figure worked out another way.
 */
import {
  explain,
  exDate,
  exInr,
  exPlural,
  exSigned,
  ratioHow,
  type Explain,
  type ExplainSet,
} from './explain';
import {
  GRANULARITIES,
  signedShare,
  type ValuationHistory,
  type ValuationRow,
} from './valuation-history';

export function buildValuationExplain(
  h: ValuationHistory,
  /** 'everyone' or the person's name */
  who: string,
): ExplainSet<'valuation'> {
  const rows = h.rows;
  const noun = GRANULARITIES.find((g) => g.key === h.granularity)!.noun;
  const withValue = rows.filter((r) => r.value !== null);
  const estimated = withValue.filter((r) => r.estimated).length;
  const missing = rows.length - withValue.length;
  const last =
    [...withValue].reverse().find((r) => !r.period.toDate) ?? withValue[withValue.length - 1];
  const first = rows[0]?.period;
  const level =
    rows.length === 0 || withValue.length === 0
      ? ('missing' as const)
      : estimated > 0 || missing > 0
        ? ('partly_estimated' as const)
        : ('complete' as const);
  const completeness =
    rows.length === 0
      ? 'Missing: no fund has a value on record for this selection.'
      : `${withValue.length} of ${exPlural(rows.length, noun)} have a value${missing > 0 ? `; ${exPlural(missing, noun)} say “no data” because there is no price or record near the end of the period` : ''}${estimated > 0 ? `; ${estimated} rest on a record moved forward with the price, a plan or assumed instalments and are marked est.` : ''}.`;
  const range = first
    ? `${exDate(first.from)} to ${exDate(rows[rows.length - 1]!.period.through)}`
    : 'nothing on record';

  const chart = explain({
    id: 'valuation.chart',
    title: 'Total valuation',
    what: `What ${who === 'everyone' ? 'all the mutual funds' : `${who}’s mutual funds`} were worth at the end of each ${noun}.`,
    how: last
      ? `For each ${noun}: the units held on its last day × the price on or just before it, added over the funds. For ${last.period.label}: ${exInr(last.value ?? 0)}. The latest ${noun} is cut at today (${exDate(h.today)}) and says “to date”: it is not a ${noun} end.`
      : 'Nothing to chart yet.',
    inputs: [
      {
        label: 'Period ends',
        value: range,
        basis: estimated > 0 ? 'estimated' : 'calculated',
        from: first?.from,
        to: rows[rows.length - 1]?.period.through,
        count: {
          n: withValue.length,
          of: rows.length,
          noun: noun === 'financial year' ? 'years' : `${noun}s`,
        },
      },
    ],
    level,
    completeness,
    notes: [
      'This is the plain valuation, as a statement shows it. It rises when you buy as well as when prices rise; the table beside it separates the two.',
    ],
  });

  const ex: ValuationRow | undefined = last;
  const table = explain({
    id: 'valuation.table',
    title: 'Value, change and gain by period',
    what: 'For each period: what the funds were worth at its end, how that changed from the end of the period before (new money included, as on a fund statement), and how much of the change was money you put in and how much was a real gain.',
    how: ex
      ? `${ex.period.label}: value ${exInr(ex.value ?? 0)}${ex.change === null ? '' : ` − the period before ${exInr((ex.value ?? 0) - ex.change)} = change ${exSigned(ex.change)} (${signedShare(ex.changePct)})`}. Money put in, net of sales: ${exSigned(ex.netIn)}. Gain = change − net money in = ${ex.gain === null ? 'not worked out' : exSigned(ex.gain)}${ex.gainPct === null || ex.gain === null || ex.base <= 0 ? '' : `; as a share of the money at work in the period (the value at its start plus each purchase for the days it was held): ${ratioHow({ label: 'gain', amount: ex.gain }, { label: 'at work', amount: ex.base })}`}.`
      : 'Not worked out: no fund has a value on record.',
    inputs: [
      {
        label: 'Value at the end of each period',
        value: `${withValue.length} of ${rows.length}`,
        basis: estimated > 0 ? 'estimated' : 'calculated',
        from: first?.from,
        to: rows[rows.length - 1]?.period.through,
      },
      {
        label: 'Money put in and taken out',
        value: 'from the fund statement (or the plan when there is none)',
        basis: 'statement',
        note: 'the same cash flows as the profit and loss on the Performance tab',
      },
    ],
    level,
    completeness,
    notes: [
      'The first two change columns are the plain change in value. The last two take out the money you added or withdrew, so a month with a big purchase never reads as a good month.',
      'The gain is worked out by the same function as the profit on Home and the Performance tab, so the same period gives the same rupees everywhere.',
      'A period before the first record is cut where the records begin; one with no price or record near its end says “no data” instead of zero.',
      'Funds are worth the units held on a day times the price of that day. With a fund statement the units are the statement’s. A fund with no transactions has its units worked out from your plan: the start date, the amount invested and every SIP amount and change with its date, each instalment buying its amount divided by the price of its day (the next priced day when it fell on a holiday). That is labelled estimated from your SIP plan and the price of each day. Your monthly sheet value is used only as a last resort, for a fund with no start date or no price. Between two monthly sheet values the fund moves with its price; money added by the SIP plan and any difference between the sheet and the prices is not counted as profit.',
    ],
  });
  return { 'valuation.chart': chart, 'valuation.table': table };
}

export type { Explain };
