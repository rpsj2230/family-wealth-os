/**
 * The "?" explainers of Reports: the strip of totals above each tab and the heading of every report table (what the rows group, what
 * the Grand total row adds, how a percentage or an average is weighted). Pure: it reads the same ReportFd and ReportFund rows the
 * report tables are built from, so a total here is the total in the sheet.
 */
import { pooledXirr } from './reports';
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
  type Explain,
  type ExplainSet,
} from './explain';
import { maturedRuleText } from './deposit-state';
import type { ReportFd, ReportFund, ReportTable } from './reports';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export interface ReportsExplainInput {
  today: string;
  /** the person the page is narrowed to, if any */
  scope: string | null;
  fds: ReportFd[];
  funds: ReportFund[];
  links: { deposits: string; investments: string; import: string; settings: string };
}

function fdFigures(i: ReportsExplainInput) {
  const principal = sum(i.fds.map((f) => f.principal));
  const maturity = sum(i.fds.map((f) => f.maturityAmount));
  const avg = principal > 0 ? sum(i.fds.map((f) => f.principal * f.rate)) / principal : null;
  const next = i.fds
    .map((f) => f.maturityOn)
    .filter((d) => d >= i.today)
    .sort()[0];
  const nextAmt = next
    ? sum(i.fds.filter((f) => f.maturityOn === next).map((f) => f.maturityAmount))
    : null;
  const booked = i.fds.map((f) => f.bookedOn).sort();
  const matures = i.fds.map((f) => f.maturityOn).sort();
  return {
    principal,
    maturity,
    avg,
    next,
    nextAmt,
    from: booked[0] ?? null,
    to: matures.at(-1) ?? null,
  };
}

export function buildReportsExplain(i: ReportsExplainInput): ExplainSet<'reports'> {
  const d = fdFigures(i);
  const funds = i.funds;
  const invested = sum(funds.map((f) => f.invested));
  const value = sum(funds.map((f) => f.value));
  const sip = sum(funds.filter((f) => !f.sipStopped).map((f) => f.sipMonthly ?? 0));
  const withX = funds.filter((f) => f.xirr !== null && f.value > 0);
  const xirr = funds.length > 0 ? pooledXirr(funds, i.today) : null;
  const noStatement = funds.filter((f) => !f.hasStatement).length;
  const whose = i.scope ? ` for ${i.scope}` : '';
  const fdBasis = { from: d.from, to: d.to } as const;
  const fdLevel = i.fds.length === 0 ? ('missing' as const) : ('complete' as const);

  return {
    'reports.fdCount': explain({
      id: 'reports.fdCount',
      title: 'Deposits counted',
      what: `How many fixed deposits the deposit reports include${whose}.`,
      how: `${exPlural(i.fds.length, 'deposit')}: the ones still running. A deposit whose date has passed, and closed, renewed or confirmed matured ones, are not counted.`,
      inputs: [{ label: 'Deposits', value: String(i.fds.length), basis: 'recorded', ...fdBasis }],
      level: fdLevel,
      completeness:
        'Counted from the recorded deposits, by the same rule as net worth and the Accounts and Deposits overviews.',
      notes: [maturedRuleText()],
      fix: { label: 'Open Deposits', href: i.links.deposits },
    }),
    'reports.fdPrincipal': explain({
      id: 'reports.fdPrincipal',
      title: 'Invested',
      exact: exInr(d.principal),
      what: 'The principal of the deposits counted: what was invested, without interest.',
      how: `Principal of each of ${exPlural(i.fds.length, 'deposit')} added = ${exInr(d.principal)}.`,
      inputs: [
        {
          label: 'Deposit principal',
          value: exInr(d.principal),
          basis: 'recorded',
          ...fdBasis,
          count: { n: i.fds.length, noun: 'deposits' },
        },
      ],
      level: fdLevel,
      completeness: 'The amount recorded when each deposit was added.',
      notes: [],
    }),
    'reports.fdMaturity': explain({
      id: 'reports.fdMaturity',
      title: 'Pays at maturity',
      exact: exInr(d.maturity),
      what: 'What the deposits pay on their dates, including all their interest.',
      how: `Maturity amount of each of ${exPlural(i.fds.length, 'deposit')} added = ${exInr(d.maturity)}. A deposit uses the bank’s own maturity figure when it is recorded, otherwise the amount worked out from its rate, dates and how interest is added.`,
      inputs: [
        {
          label: 'Maturity amounts',
          value: exInr(d.maturity),
          basis: 'calculated',
          to: d.to,
          count: { n: i.fds.length, noun: 'deposits' },
          note: 'the bank’s figure where recorded, else calculated from the terms',
        },
      ],
      level: fdLevel,
      completeness:
        'Worked out from each deposit’s contract terms, or taken from the bank where it is recorded. Tax on the interest is not taken off.',
      notes: [],
    }),
    'reports.fdInterest': explain({
      id: 'reports.fdInterest',
      title: 'Interest still to earn',
      exact: exInr(d.maturity - d.principal),
      what: 'Maturity amount less the amount invested. Its sub-line says “from booking to maturity”: it is the interest over the whole life of the deposits.',
      how: `${exInr(d.maturity)} pays at maturity − ${exInr(d.principal)} invested = ${exInr(d.maturity - d.principal)}.`,
      inputs: [
        { label: 'Pays at maturity', value: exInr(d.maturity), basis: 'calculated', to: d.to },
        { label: 'Invested', value: exInr(d.principal), basis: 'recorded', from: d.from },
      ],
      level: fdLevel,
      completeness:
        'Calculated, but note the label: it is the interest over each deposit’s whole life, from booking to maturity, including interest already earned. The overview on Deposits uses “interest still to earn” for maturity less current value, which is smaller.',
      notes: [],
    }),
    'reports.fdRate': explain({
      id: 'reports.fdRate',
      title: 'Average rate',
      exact: d.avg === null ? undefined : exPct(d.avg, 2),
      what: 'The interest rate of the deposits, averaged with each weighted by its amount.',
      how:
        d.avg === null
          ? 'No deposit is counted.'
          : `Σ (principal × rate) ÷ Σ principal over ${exPlural(i.fds.length, 'deposit')} = ${exPct(d.avg, 2)} a year, on ${exInr(d.principal)}.`,
      inputs: [
        {
          label: 'Rates and amounts',
          value: d.avg === null ? 'none' : exPct(d.avg, 2),
          basis: 'recorded',
          from: d.from,
          to: d.to,
          count: { n: i.fds.length, noun: 'deposits' },
        },
      ],
      level: fdLevel,
      completeness:
        'A deposit with a larger amount counts for more. It is the stated rate, not an after-tax or compounded yield.',
      notes: [],
    }),
    'reports.fdNext': explain({
      id: 'reports.fdNext',
      title: 'Next maturity',
      exact: d.nextAmt === null ? undefined : exInr(d.nextAmt),
      what: 'The next date a deposit pays out and the amount due that day.',
      how: d.next
        ? `On ${exDate(d.next)}, deposits maturing that day pay ${exInr(d.nextAmt ?? 0)}.`
        : 'No deposit matures from today on.',
      inputs: [
        {
          label: 'Next maturity date',
          value: exDate(d.next),
          basis: d.next ? 'calculated' : 'missing',
          to: d.next ?? null,
        },
      ],
      level: d.next ? 'complete' : 'missing',
      completeness: d.next ? 'From the recorded maturity dates.' : 'None ahead.',
      notes: [],
    }),
    'reports.fundCount': explain({
      id: 'reports.fundCount',
      title: 'Funds counted',
      what: `How many mutual funds the fund reports include${whose}.`,
      how: `${exPlural(funds.length, 'fund')}, of which ${funds.length - noStatement} have a fund statement or transaction export on file and ${noStatement} do not.`,
      inputs: [
        {
          label: 'Funds with a statement',
          value: `${funds.length - noStatement} of ${funds.length}`,
          basis: 'statement',
          count: { n: funds.length - noStatement, of: funds.length, noun: 'funds' },
        },
      ],
      level: funds.length === 0 ? 'missing' : noStatement === 0 ? 'complete' : 'partly_estimated',
      completeness:
        noStatement === 0
          ? 'Every fund has transactions on file.'
          : `${noStatement} fund(s) have no transactions, so the money-in-and-out, SIP and age tables leave them out or show a dash.`,
      notes: [],
      fix: noStatement > 0 ? { label: 'Import a fund statement', href: i.links.import } : undefined,
    }),
    'reports.fundInvested': explain({
      id: 'reports.fundInvested',
      title: 'Invested',
      exact: exInr(invested),
      what: 'The money still in the funds: the cost of the units held.',
      how: `Cost of the units still held (sold units take their share of cost with them), added over ${exPlural(funds.length, 'fund')} = ${exInr(invested)}.`,
      inputs: [
        {
          label: 'Cost of units held',
          value: exInr(invested),
          basis: noStatement === 0 ? 'statement' : 'recorded',
          count: { n: funds.length, noun: 'funds' },
        },
      ],
      level: noStatement === 0 ? 'complete' : 'partly_estimated',
      completeness:
        noStatement === 0
          ? 'From statement transactions.'
          : `${noStatement} fund(s) use the amount entered by hand as their cost.`,
      notes: ['It is the same “invested” as on the Investments page.'],
    }),
    'reports.fundValue': explain({
      id: 'reports.fundValue',
      title: 'Current value',
      exact: exInr(value),
      what: 'What the funds are worth now.',
      how: `Units × latest price of each of ${exPlural(funds.length, 'fund')}, added = ${exInr(value)}.`,
      inputs: [
        {
          label: 'Value of the funds',
          value: exInr(value),
          basis: 'calculated',
          to: i.today,
          count: { n: funds.length, noun: 'funds' },
        },
      ],
      level: 'partly_estimated',
      completeness:
        'Valued as on the Investments page; a fund with no live price keeps its last recorded value. Open the “?” on Investments for the price dates.',
      notes: [],
      fix: { label: 'Open Investments', href: i.links.investments },
    }),
    'reports.fundGain': explain({
      id: 'reports.fundGain',
      title: 'Gain',
      exact: exSigned(value - invested),
      what: 'Current value less invested, on the units still held.',
      how: `${exInr(value)} value − ${exInr(invested)} invested = ${exSigned(value - invested)}${invested > 0 ? `; as a share of what is invested: ${exSignedPct((value - invested) / invested, 1)} (÷ ${exInr(invested)} invested)` : ''}.`,
      inputs: [
        { label: 'Current value', value: exInr(value), basis: 'calculated', to: i.today },
        {
          label: 'Invested',
          value: exInr(invested),
          basis: noStatement === 0 ? 'statement' : 'recorded',
        },
      ],
      level: noStatement === 0 ? 'complete' : 'partly_estimated',
      completeness:
        noStatement === 0
          ? 'Every fund’s cost is from a statement.'
          : `${noStatement} fund(s) rest on a cost entered by hand.`,
      notes: ['Booked profit (from units sold) is not included.'],
    }),
    'reports.fundXirr': explain({
      id: 'reports.fundXirr',
      title: TERMS.xirr.label,
      exact: xirr === null ? undefined : `${exPct(xirr, 2)} a year`,
      what: `${TERMS.xirr.hint} One rate for all the funds shown together.`,
      how:
        xirr === null
          ? 'No fund has dated money in and out yet.'
          : `Every purchase, SIP, sale and payout of the ${exPlural(funds.length, 'fund')} together, and their current value, solved for one yearly rate: ${exPct(xirr, 2)} a year. The same rule as Investments, so the same funds show the same XIRR there.`,
      inputs: [
        {
          label: 'Funds with an annual return',
          value: `${withX.length} of ${funds.length}`,
          basis: noStatement === 0 ? 'statement' : 'estimated',
          to: i.today,
          count: { n: withX.length, of: funds.length, noun: 'funds' },
        },
      ],
      level: xirr === null ? 'missing' : noStatement === 0 ? 'partly_estimated' : 'estimated',
      completeness:
        xirr === null
          ? 'Missing: no fund has a return yet.'
          : noStatement === 0
            ? 'From the funds’ own transactions.'
            : `${noStatement} fund(s) have no statement: their money in is worked out from the start date and SIP.`,
      notes: [],
      fix: { label: 'Open Investments', href: i.links.investments },
    }),
    'reports.fundSip': explain({
      id: 'reports.fundSip',
      title: 'SIPs per month',
      exact: exInr(sip),
      what: 'The monthly amount of the running SIPs.',
      how: `Monthly amount of each running SIP added = ${exInr(sip)}; a stopped SIP is left out.`,
      inputs: [
        {
          label: 'Running SIPs',
          value: exInr(sip),
          basis: 'recorded',
          count: {
            n: funds.filter((f) => !f.sipStopped && (f.sipMonthly ?? 0) > 0).length,
            noun: 'funds',
          },
        },
      ],
      level: 'complete',
      completeness: 'The amounts set on each fund.',
      notes: [],
    }),
    'reports.table': tableGuide(i),
  };
}

function tableGuide(i: ReportsExplainInput): Explain {
  return explain({
    id: 'reports.table',
    title: 'How to read a report table',
    what: 'Each report is a sheet: one row per group, with a Grand total row at the bottom and a CSV download that holds the same figures.',
    how: 'The Grand total adds the rows of every money and count column. A rate or a percentage on the total row is worked out again over everything, not added: an average rate is weighted by amount, an overall % is the profit ÷ the amount invested, and a share is a row’s part of the total value.',
    inputs: [
      { label: 'Deposits', value: String(i.fds.length), basis: 'recorded' },
      { label: 'Funds', value: String(i.funds.length), basis: 'recorded', to: i.today },
    ],
    level: 'complete',
    completeness:
      'Every table is built from the same rows as the strip above it, so a total here is the total there.',
    notes: ['Each table has its own “?” beside its title.'],
  });
}

const groupWord = (t: ReportTable) => t.columns[0]?.label ?? 'group';

/** The explainer of one report table, from the table itself and a few facts about the data behind it. */
export function reportTableExplain(
  t: ReportTable,
  c: { today: string; noStatement: number; funds: number; links: { import: string } },
): Explain {
  const total = t.total;
  const cols = t.columns.map((x) => x.label).join(', ');
  const isFund = t.id.startsWith('mf-');
  const how: Record<string, string> = {
    'fd-maturity':
      'Each deposit goes in the group its maturity date falls in. Amount = principal, Maturity = what it pays, Interest = Maturity − Amount; “Maturity so far” is the running total of Maturity down the rows.',
    'fd-start':
      'Each deposit goes in the group its start (booking) date falls in. Amount = principal, Maturity = what it pays, Interest = Maturity − Amount; “Amount so far” is the running total of Amount.',
    'fd-interest-fy':
      'For each financial year (1 April to 31 March) and each person: the interest each deposit earns inside the days of that year it is running, worked out from its rate, dates and how interest is added. A year not yet over includes interest still to come.',
    'mf-sip':
      'One row per fund with a SIP or SIP instalments: per month = the amount set on the fund; first and latest instalment, months, instalments and paid so far come from the statement lines of kind SIP; current value = units × latest price. The total adds the running SIPs and the paid and value columns.',
    'mf-flow':
      'Each purchase and sale line on the statements is placed in the period its date falls in: SIP + one-time buys − sold = net invested. Funds with no transactions are not counted.',
    'mf-age':
      'Each purchase still held is valued at today’s price (units × latest price) and placed in the age band its purchase date falls in; units whose purchase date is not on file go in “Date not known”.',
  };
  const generic = t.id.startsWith('fd-by-')
    ? `Deposits are grouped by ${groupWord(t).toLowerCase()}. Share = a group’s amount ÷ the total amount; Avg rate is weighted by amount; First and Last maturity are the earliest and latest maturity date in the group.`
    : t.id.startsWith('mf-by-')
      ? `Funds are grouped by ${groupWord(t).toLowerCase()}. Profit = Current value − Invested; Overall % = Profit ÷ Invested; XIRR is one rate over all the group’s purchases, sales and current value together; Share = Current value ÷ the total value.`
      : 'Each row is a group; the total row adds them.';
  const withData = t.rows.length > 0;
  return explain({
    id: 'reports.table',
    title: t.title,
    what: t.note ?? 'A summary table of the rows below.',
    how: `${how[t.id] ?? generic} Columns: ${cols}.${total ? ' The Grand total row adds every row.' : ''}`,
    inputs: [
      {
        label: 'Rows',
        value: String(t.rows.length),
        basis: withData ? 'calculated' : 'missing',
        to: c.today,
      },
      ...(isFund
        ? [
            {
              label: 'Funds with transactions on file',
              value: `${c.funds - c.noStatement} of ${c.funds}`,
              basis: 'statement' as const,
              count: { n: c.funds - c.noStatement, of: c.funds, noun: 'funds' },
            },
          ]
        : []),
    ],
    level: !withData ? 'missing' : isFund && c.noStatement > 0 ? 'partly_estimated' : 'complete',
    completeness: !withData
      ? 'Nothing to show yet.'
      : isFund && c.noStatement > 0
        ? `${c.noStatement} fund(s) have no transactions, so ${t.id === 'mf-flow' ? 'they are not counted here' : 'their cost and returns rest on the plan entered'}.`
        : 'Every row is worked out from recorded deposit terms or statement lines.',
    notes:
      t.id === 'fd-interest-fy'
        ? [
            'It can differ slightly from the bank’s certificate. Tax on the interest is a separate matter: see the Tax page.',
          ]
        : [],
    fix:
      isFund && c.noStatement > 0
        ? { label: 'Import a fund statement', href: c.links.import }
        : undefined,
  });
}

void exRange;
