import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  addMonthsIso,
  formatInr,
  formatInrCompact,
  rebase,
  type Explain,
  type ExplainSet,
  type FundTaxPanel,
  type PlanSplit,
  type YearKind,
} from '@fwos/core';
import { Est, LEDGER_EST_TITLE } from '@/components/Est';
import { SipStrip, StatList, type Stat } from '@/components/FundViz';
import { pct, rupees, tone } from '@/components/InvestHeadline';
import { PlotChart, type PlotSeries } from '@/components/PlotChart';
import { Tabs } from '@/components/Tabs';
import { Why, WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import { fundExplain } from '@/lib/explain-fund';
import type { FundDetail, FundReturns } from '@/lib/fund-detail-model';
import type { FundRow } from '@/lib/investments';
import { AddsUp, LedgerChip } from './DataCheck';
import { AddTxnButton, EditFundButton } from './FundEdit';
import { Ledger, type LedgerEntry } from './Ledger';
import { ReplacedLines, type ReplacedRow } from './ReplacedLines';
import { TaxPanel } from './TaxPanel';
import {
  Chips,
  DrawdownCard,
  EstimateNote,
  Extremes,
  Heatmap,
  ReturnsByPeriod,
  RiskCard,
  RollingCard,
  type PeriodRow,
} from './PerfParts';
import './invest.css';
import { MONEY_WORDS as W } from '@/lib/money-words';

export const FUND_TABS = ['overview', 'returns', 'transactions', 'sip', 'lots', 'records'] as const;
export type FundTab = (typeof FUND_TABS)[number];
export const parseFundTab = (v: string | undefined): FundTab =>
  (FUND_TABS as readonly string[]).includes(v ?? '') ? (v as FundTab) : 'overview';

/** The Returns tab shows the time the holder's money has been in the fund, or the fund's whole price history. */
export type ReturnScope = 'mine' | 'whole';
export const parseReturnScope = (v: string | undefined): ReturnScope =>
  v === 'whole' ? 'whole' : 'mine';

const inr = (n: number) => formatInr(Math.round(n));
const price = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const units = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

const planWords: Record<FundRow['plan'], string> = {
  direct: 'Direct plan',
  regular: 'Regular plan',
  unknown: 'Plan not set',
};

/** One tile of the fund's headline row. */
function Tile({
  label,
  value,
  sub,
  cls,
  main,
  why,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  cls?: string | null | undefined;
  main?: boolean;
  why?: Explain;
}) {
  return (
    <article className={`kpi ${main ? 'main' : ''}`}>
      <div className="kpi-label">
        {label}
        {why && <Why explain={why} />}
      </div>
      <div className={`kpi-value ${cls ?? ''}`}>{value}</div>
      {sub && <div className="kpi-sub muted">{sub}</div>}
    </article>
  );
}

/**
 * The read-out lines of the growth chart for one day: the overall return (profit over the money invested) and the XIRR (the same
 * profit as a rate a year, counting how long each rupee was in), yours and the benchmark's on the same money.
 */
function xirrWords(
  x: { yours: number | null; bench: number | null },
  since: string | null,
  date: string,
  value: number | undefined,
  invested: number | undefined,
): string {
  if (x.yours === null) return '';
  const short = since !== null && addMonthsIso(since, 12) > date;
  const overall =
    value !== undefined && invested !== undefined && invested > 0
      ? `Overall ${pct(value / invested - 1, 1)} (${rupees(value - invested)}) · `
      : '';
  return `${overall}XIRR ${pct(x.yours, 1)} a year${x.bench !== null ? ` · benchmark XIRR ${pct(x.bench, 1)}` : ''}${short ? ' (under a year)' : ''}`;
}

/** The holder's own money over each period: the value at the start, money in and out, the value now, the profit and the return. */
function OwnPeriods({ rows }: { rows: FundReturns['own'] }) {
  return (
    <div className="tablewrap">
      <table className="data ownperiods">
        <caption className="sr-only">Your money in this fund over each period</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col" className="num">
              Value at the start
            </th>
            <th scope="col" className="num">
              Put in
            </th>
            <th scope="col" className="num">
              Taken out
            </th>
            <th scope="col" className="num">
              Value now
            </th>
            <th scope="col" className="num">
              Profit
            </th>
            <th scope="col" className="num">
              Your return
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.def.key}>
              <th scope="row">
                {r.sinceFirst ? 'Since you started' : r.def.label}
                <span className="fl-s">from {niceDate(r.from)}</span>
              </th>
              <td className="num" data-label="Value at the start">
                {r.sinceFirst ? '–' : inr(r.startValue)}
              </td>
              <td className="num" data-label="Put in">
                {r.putIn > 0 ? inr(r.putIn) : '–'}
              </td>
              <td className="num" data-label="Taken out">
                {r.takenOut > 0 ? inr(r.takenOut) : '–'}
              </td>
              <td className="num" data-label="Value now">
                {inr(r.endValue)}
              </td>
              <td className={`num ${tone(r.gain)}`} data-label="Profit">
                {rupees(r.gain)}
              </td>
              <td className={`num ${tone(r.ret)}`} data-label="Your return">
                {r.ret === null ? '–' : pct(r.ret, 1)}
                <span className="fl-s">
                  {r.ret === null ? '' : r.annualised ? 'a year (XIRR)' : 'on the money at work'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A fund's page: the headline row, then tabs. Overview (the figures and graphs), Returns (the fund's price return over each period
 * against the benchmark, calendar and financial years, month grid, fall from the high, rolling returns, risk), Transactions (every
 * line with running figures, filters and export), Lots and gains (each purchase still held with its age and gain, each sale with
 * the gain it booked, the SIP calendar) and Records (details, recorded values, activity).
 */
export function FundPage({
  fund,
  detail,
  tab,
  heat,
  scope = 'mine',
  base,
  keep,
  today,
  demo,
  overview,
  records,
  sipPlan,
  holdingMonths,
  config,
  plan,
  colour,
  tax,
  taxHref,
  replaced = [],
}: {
  fund: FundRow;
  detail: FundDetail;
  tab: FundTab;
  heat: YearKind;
  /** the Returns tab: from the first purchase (the default) or the fund's whole price history */
  scope?: ReturnScope;
  /** this page's address without its query, and the query values to carry along */
  base: string;
  keep: Record<string, string>;
  today: string;
  demo: boolean;
  /** the existing figures and graphs of a fund (range switch included); given the fund's explainers when it is a function */
  overview: ReactNode | ((ex: ExplainSet<'fund'>) => ReactNode);
  /** details, recorded values and the activity log */
  records: ReactNode;
  /** the SIP's dated plan and the account it is paid from (a tab of its own) */
  sipPlan?: ReactNode;
  holdingMonths: number | null;
  config: { ledgerPageSize: number; riskMinMonths: number; rollingMinWindows: number };
  plan?: PlanSplit | undefined;
  colour: string;
  /** the exit-load and tax panel of this fund, and the address of the Tax page it points to */
  tax: FundTaxPanel;
  taxHref: string;
  /** lines a fund statement replaced: listed (collapsed) under the transactions, counted nowhere */
  replaced?: ReplacedRow[];
}) {
  const f = fund;
  const d = detail;
  const href = (patch: Record<string, string | undefined>) => {
    const q = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) q.delete(k);
      else q.set(k, v);
    }
    const s = q.toString();
    return s ? `${base}?${s}` : base;
  };
  void plan;
  const ex = fundExplain({
    fund: f,
    detail: d,
    tax,
    today,
    holdingMonths,
    overviewHref: href({ tab: undefined }),
    importHref: demo ? '/demo/import' : '/import',
    matchHref: demo ? '/demo/investments?tab=match' : '/investments?tab=match',
    taxHref,
  });
  const gain = f.value - f.invested;
  const gainPct = f.invested > 0 ? f.value / f.invested - 1 : null;
  const ret = d.returns;
  const noStatement = !f.hasStatement;
  const estMark = f.ledger.figuresEstimated ? <Est title={LEDGER_EST_TITLE} /> : null;
  const addsUp = (
    <AddsUp
      verdict={f.ledger}
      value={f.value}
      nav={f.nav}
      navDate={f.navDate}
      sourceNote={`Value now: ${f.valueBasis}.`}
    />
  );

  const header = (
    <>
      <section className="fundhero" aria-label="This fund at a glance">
        <Tile
          main
          why={ex['fund.value']}
          label={W.valueToday}
          value={
            <>
              {f.value ? inr(f.value) : '–'}
              {f.value ? estMark : null}
            </>
          }
          sub={
            <>
              {f.units !== null ? `${units(f.units)} units` : 'units not recorded'}
              {f.nav !== null ? ` × ${price(f.nav)}` : ''}
              {f.dayAmount !== null && (
                <>
                  {' · today '}
                  <span className={tone(f.dayAmount)}>
                    {rupees(f.dayAmount)} ({f.dayPct === null ? '' : pct(f.dayPct)})
                  </span>
                  <Why explain={ex['fund.today']} />
                </>
              )}
            </>
          }
        />
        <Tile
          why={ex['fund.moneyIn']}
          label={W.investedNow}
          value={
            <>
              {f.invested ? inr(f.invested) : '–'}
              {f.invested ? estMark : null}
            </>
          }
          sub={d.avgCost === null ? 'cost of the units held' : `average cost ${price(d.avgCost)}`}
        />
        <Tile
          why={ex['fund.profit']}
          label={W.profitOnInvested}
          value={
            <>
              {f.invested ? rupees(gain) : '–'}
              {f.invested ? estMark : null}
            </>
          }
          cls={f.invested ? tone(gain) : null}
          sub={
            gainPct === null
              ? 'no cost recorded'
              : `${pct(gainPct, 1)} on the ${formatInrCompact(f.invested)} invested now`
          }
        />
        <Tile
          why={ex['fund.xirr']}
          label={W.xirrInvested}
          value={
            <>
              {f.xirr === null ? '–' : pct(f.xirr, 1)}
              {f.xirr !== null ? estMark : null}
            </>
          }
          cls={tone(f.xirr)}
          sub={
            f.xirr === null
              ? 'needs a start date or statement'
              : f.xirrEstimated
                ? 'estimated from start date and SIP'
                : 'from the transactions'
          }
        />
        <Tile
          why={d.cagr !== null ? ex['fund.cagr'] : ex['fund.booked']}
          label={d.cagr !== null ? 'Compound growth' : 'Booked by selling'}
          value={
            d.cagr !== null
              ? pct(d.cagr, 1)
              : d.realised.sales === 0
                ? 'None'
                : rupees(d.realised.stcg + d.realised.ltcg + d.realised.other)
          }
          cls={
            d.cagr !== null
              ? tone(d.cagr)
              : d.realised.sales === 0
                ? null
                : tone(d.realised.stcg + d.realised.ltcg + d.realised.other)
          }
          sub={
            d.cagr !== null
              ? `single investment on ${niceDate(d.cagrFrom)}`
              : d.realised.sales === 0
                ? f.hasStatement
                  ? 'no sale on the statement'
                  : 'needs a fund statement'
                : `${d.realised.sales} sale line${d.realised.sales === 1 ? '' : 's'}`
          }
        />
        <Tile
          why={ex['fund.sip']}
          label="Monthly investment"
          value={f.sipMonthly ? (f.sipStopped ? 'Stopped' : inr(f.sipMonthly)) : 'None'}
          sub={
            d.sip.nextOn && d.sip.active
              ? `next ${niceDate(d.sip.nextOn)}${d.sip.basis === 'statement' ? '' : ' (expected; not verified by a statement)'}`
              : planWords[f.plan]
          }
        />
      </section>
      <div className="fundactions noprint">
        <EditFundButton id={f.assetId} name={f.name} button label="Edit this fund" />
        <AddTxnButton assetId={f.assetId} className="btn compact" label="Add a transaction" />
        {!f.amfiCode && (
          <Link
            className="btn compact"
            href={demo ? '/demo/investments?tab=match' : '/investments?tab=match'}
          >
            Match to follow its price
          </Link>
        )}
        <LedgerChip chip={f.ledger.chip} />
        <span className="muted small">
          {planWords[f.plan]}
          {f.folioLast4 ? ` · folio …${f.folioLast4}` : ''}
        </span>
      </div>
      <Tabs
        base={base}
        current={tab}
        keep={keep}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'returns', label: 'Returns' },
          { key: 'transactions', label: 'Transactions', badge: d.ledger.length || null },
          ...(sipPlan ? [{ key: 'sip', label: 'SIP plan' }] : []),
          { key: 'lots', label: 'Lots and gains' },
          { key: 'records', label: 'Records' },
        ]}
      />
    </>
  );

  /* ---------------------------------------------------------------- returns */
  let returnsBody: ReactNode = null;
  if (tab === 'returns') {
    if (!ret)
      returnsBody = (
        <p className="empty">
          This fund&apos;s returns need its published prices.{' '}
          <Link href={demo ? '/demo/investments?tab=match' : '/investments?tab=match'}>
            Match it to its official scheme
          </Link>{' '}
          and they appear after the next daily price fetch.
        </p>
      );
    else {
      const mine = scope === 'mine' && ret.since !== null;
      const shown = mine ? ret : ret.whole;
      const rows: PeriodRow[] = shown.versus.map((x) => ({
        def: x.def,
        r: x.yours,
        gain: undefined,
        v: x.v,
      }));
      const hasBench = shown.versus.some((x) => x.v.benchmark !== null);
      const p = shown.profile;
      const growth = shown.growth;
      const series: PlotSeries[] = growth
        ? [
            { key: 'fund', name: f.name, colour, points: growth.fund },
            {
              key: 'bench',
              name: `${ret.benchName ?? 'Benchmark'} (proxy)`,
              colour: 'var(--viz-line)',
              dashed: true,
              points: growth.bench,
            },
          ]
        : [];
      const sh = ret.shadow;
      const benchNow = sh && sh.bench.length > 0 ? sh.bench[sh.bench.length - 1]! : null;
      const valueNow = sh ? sh.value[sh.value.length - 1]! : null;
      const lastX = sh && sh.xirr.length > 0 ? sh.xirr[sh.xirr.length - 1]! : null;
      const valueOn = new Map((sh?.value ?? []).map((p) => [p.date, p.value]));
      // the money invested on a day: the last step of the invested line on or before it
      const investedOn = (d: string) =>
        [...(sh?.invested ?? [])].reverse().find((p) => p.date <= d)?.value;
      const shortSpan =
        ret.since !== null && lastX !== null && addMonthsIso(ret.since, 12) > lastX.date;
      returnsBody = (
        <>
          {ret.since !== null && (
            <Chips<ReturnScope>
              label="Show"
              items={[
                { key: 'mine', label: `Since you invested (${niceDate(ret.since)})` },
                { key: 'whole', label: 'The fund’s whole price history' },
              ]}
              current={mine ? 'mine' : 'whole'}
              href={(k) =>
                href({
                  tab: 'returns',
                  scope: k === 'mine' ? undefined : k,
                  heat: heat === 'financial' ? undefined : heat,
                })
              }
            />
          )}
          {mine && ret.own.length > 0 && (
            <section className="card wide" aria-labelledby="fy">
              <div className="cardhead">
                <h2 id="fy">Your money over each period</h2>
                <span className="small muted">Counts only your own money, and when it went in</span>
              </div>
              <OwnPeriods rows={ret.own} />
              {ret.estimated && <EstimateNote share={1} />}
            </section>
          )}
          {mine && sh && (
            <section className="card wide" aria-labelledby="fm">
              <div className="cardhead">
                <h2 id="fm">How your money grew</h2>
                <span className="small muted">From {niceDate(sh.value[0]!.date)}</span>
              </div>
              <PlotChart
                unit="inr"
                caption={`${f.name}: your value against the money you put in${benchNow ? ' and the same money in the benchmark' : ''}`}
                series={[
                  { key: 'value', name: 'Current value', colour, area: true, points: sh.value },
                  {
                    key: 'in',
                    name: 'Invested',
                    colour: 'var(--viz-line)',
                    step: true,
                    points: sh.invested,
                  },
                  ...(sh.bench.length >= 2
                    ? [
                        {
                          key: 'bench',
                          name: 'Benchmark',
                          colour: 'var(--viz-3)',
                          dashed: true,
                          points: sh.bench,
                        },
                      ]
                    : []),
                ]}
                tipNotes={sh.xirr.map((x) => ({
                  date: x.date,
                  text: xirrWords(x, ret.since, x.date, valueOn.get(x.date), investedOn(x.date)),
                }))}
                note={[
                  'Current value: what your units are worth on the day. Invested: the money you put in, less any taken out.',
                  sh.bench.length >= 2
                    ? `Benchmark: ${ret.benchName ?? 'the benchmark'}, with every purchase and sale of yours made in it on the same day for the same amount.`
                    : '',
                  lastX && lastX.yours !== null
                    ? `Your XIRR in this fund: ${pct(lastX.yours, 1)} a year${lastX.bench !== null ? `; the benchmark on the same money: ${pct(lastX.bench, 1)}` : ''}${shortSpan ? ' (under a year, so a yearly rate can swing a lot)' : ''}.`
                    : '',
                  benchNow && valueNow
                    ? `On ${niceDate(benchNow.date)} the benchmark would be worth ${inr(benchNow.value)}, against ${inr(valueNow.value)} in this fund.`
                    : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              />
            </section>
          )}
          <p className="fundnote">
            {ret.basis === 'price'
              ? mine
                ? `The figures below are the fund’s price return (the price of one unit) while your money has been in it, from your first purchase on ${niceDate(ret.since!)}. They ignore how much you put in and when; your own return is in the table above.`
                : 'These are the fund’s own returns from its published prices over its whole history, including the years before you invested. They are not your return.'
              : 'No published prices are loaded for this fund, so these returns are worked out from the values you recorded and the money put in'}
            {ret.estimated && ', with the money put in estimated from the start date and SIP'}
            {ret.basis === 'values' ? '.' : ''}
          </p>
          <section className="card wide" aria-labelledby="fr">
            <div className="cardhead">
              <WhyHead why={ex['fund.returns']}>
                <h2 id="fr">Return over each period</h2>
              </WhyHead>
              <span className="small muted">
                {ret.basis === 'price'
                  ? mine
                    ? 'Price return, since you invested'
                    : 'Price return, whole history'
                  : 'From recorded values'}
              </span>
            </div>
            <ReturnsByPeriod
              rows={rows}
              benchName={ret.benchName}
              hasBench={hasBench}
              showGain={false}
            />
            {ret.estimated && <EstimateNote share={1} />}
          </section>
          {growth && (
            <section className="card wide" aria-labelledby="fg">
              <div className="cardhead">
                <h2 id="fg">Growth of 100 against the benchmark</h2>
                <span className="small muted">From {niceDate(growth.from)}</span>
              </div>
              <PlotChart
                unit="index"
                caption={`Growth of 100: ${f.name} and the benchmark`}
                series={series}
                note={`Both start at 100 on ${niceDate(growth.from)}${mine ? ', your first purchase' : ''}. The benchmark is an index fund that follows the Nifty 50, a proxy for the index.`}
              />
            </section>
          )}
          <section className="card wide" aria-labelledby="fh">
            <div className="cardhead">
              <h2 id="fh">Month by month</h2>
              <span className="small muted">
                {mine
                  ? 'The price return in each month since you invested'
                  : 'Return in each month and each year'}
              </span>
            </div>
            <Chips<YearKind>
              label="Years"
              items={[
                { key: 'financial', label: 'Financial (April to March)' },
                { key: 'calendar', label: 'Calendar' },
              ]}
              current={heat}
              href={(k) =>
                href({
                  tab: 'returns',
                  heat: k === 'financial' ? undefined : k,
                  scope: scope === 'whole' ? 'whole' : undefined,
                })
              }
            />
            <Extremes
              bestMonth={p.bestMonth}
              worstMonth={p.worstMonth}
              bestYear={heat === 'calendar' ? p.bestYear : p.bestFy}
              worstYear={heat === 'calendar' ? p.worstYear : p.worstFy}
              kind={heat}
            />
            <div style={{ height: 12 }} />
            <Heatmap
              rows={heat === 'calendar' ? p.heatCalendar : p.heatFinancial}
              kind={heat}
              months={p.months}
            />
          </section>
          <div className="invgrid two">
            <section className="card" aria-labelledby="fd">
              <div className="cardhead">
                <h2 id="fd">Fall from the highest price</h2>
                {mine && <span className="small muted">Since you invested</span>}
              </div>
              <DrawdownCard d={p.drawdown} />
            </section>
            <section className="card" aria-labelledby="fk">
              <div className="cardhead">
                <h2 id="fk">Risk</h2>
              </div>
              <RiskCard risk={p.risk} months={config.riskMinMonths} />
            </section>
          </div>
          <section className="card wide" aria-labelledby="fo">
            <div className="cardhead">
              <h2 id="fo">Rolling returns</h2>
              <span className="small muted">
                {mine
                  ? 'What any holding period since you invested would have earned'
                  : 'What any holding period would have earned'}
              </span>
            </div>
            <RollingCard rolling={p.rolling} minWindows={config.rollingMinWindows} />
          </section>
          <p className="cardnote">
            Not shown: the category average and the expense ratio. Neither is in the free price data
            this page reads (AMFI publishes the expense ratio as a separate monthly file, and
            category averages come from paid data providers).
          </p>
        </>
      );
    }
  }

  /* ---------------------------------------------------------------- transactions */
  const ledgerRows: LedgerEntry[] = d.ledger.map((r) => ({ ...r, assetId: f.assetId }));
  const t = d.ledgerTotals;

  /* ---------------------------------------------------------------- lots */
  const open = d.ledger.filter((r) => r.unitsLeft !== null && r.valueNow !== null);
  const sales = d.ledger.filter((r) => r.group === 'sell');
  const lotsBody =
    tab === 'lots' ? (
      <>
        <section className="card wide" aria-labelledby="fl">
          <div className="cardhead">
            <WhyHead why={ex['fund.units']}>
              <h2 id="fl">Units still held</h2>
            </WhyHead>
            <span className="small muted">Each purchase with units left, oldest first</span>
          </div>
          {open.length > 0 ? (
            <div className="cmpwrap">
              <table className="tbl lines cmp lotstbl">
                <thead>
                  <tr>
                    <th>Bought</th>
                    <th className="num">Held for</th>
                    <th className="num">Units left</th>
                    <th className="num">Cost</th>
                    <th className="num">Value now</th>
                    <th className="num">Gain</th>
                    {holdingMonths !== null && <th>Long-term from</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...open]
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((r) => {
                      const cost = r.valueNow! - (r.gainNow ?? 0);
                      return (
                        <tr key={r.n}>
                          <td data-label="Bought">
                            {niceDate(r.date)} <span className="muted small">{r.label}</span>
                          </td>
                          <td className="num" data-label="Held for">
                            {held(r.heldDays)}
                          </td>
                          <td className="num" data-label="Units left">
                            {units(r.unitsLeft!)}
                          </td>
                          <td className="num" data-label="Cost">
                            {r.gainNow === null ? '–' : inr(cost)}
                          </td>
                          <td className="num" data-label={W.valueToday}>
                            {inr(r.valueNow!)}
                          </td>
                          <td className={`num ${tone(r.gainNow)}`} data-label="Gain">
                            {r.gainNow === null ? '–' : rupees(r.gainNow)}
                            <span className="fl-s">
                              {r.gainNowPct === null ? '' : pct(r.gainNowPct, 1)}
                            </span>
                          </td>
                          {holdingMonths !== null && (
                            <td data-label="Long-term from">
                              {r.longTermOn === null ? (
                                '–'
                              ) : r.longTermOn <= today ? (
                                <span className="gain">already</span>
                              ) : (
                                niceDate(r.longTermOn)
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          ) : f.lots.length > 0 ? (
            <div className="cmpwrap">
              <table className="tbl lines cmp lotstbl">
                <thead>
                  <tr>
                    <th>Bought</th>
                    <th className="num">Units</th>
                    <th className="num">Cost</th>
                    <th className="num">Value now</th>
                    <th className="num">Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {f.lots.map((l, i) => {
                    const unit = f.units && f.units > 0 ? f.value / f.units : null;
                    const v = unit === null ? null : l.units * unit;
                    return (
                      <tr key={i}>
                        <td data-label="Bought">
                          {l.acquiredOn === '1900-01-01'
                            ? 'Before the statement'
                            : niceDate(l.acquiredOn)}
                          {l.estimated && <span className="estchip">est.</span>}
                        </td>
                        <td className="num" data-label="Units">
                          {units(l.units)}
                        </td>
                        <td className="num" data-label="Cost">
                          {l.cost === null ? '–' : inr(l.cost)}
                        </td>
                        <td className="num" data-label={W.valueToday}>
                          {v === null ? '–' : inr(v)}
                        </td>
                        <td className="num" data-label="Gain">
                          {v === null || l.cost === null ? '–' : rupees(v - l.cost)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">
              {noStatement
                ? 'No fund statement is imported, so the purchases are not known. Import one under Import, or add the transactions.'
                : 'No units are held.'}
            </p>
          )}
          {d.holding && (
            <p className="cardnote">
              {formatInrCompact(d.holding.longValue)} of the value has been held over{' '}
              {holdingMonths} months (long-term), {formatInrCompact(d.holding.shortValue)} for less.
              {d.holding.nextTurn &&
                ` ${inr(d.holding.nextTurn.value)} turns long-term on ${niceDate(d.holding.nextTurn.on)}.`}
              {d.holding.basis !== 'statement' && ' The purchases are estimated from the SIP plan.'}
            </p>
          )}
        </section>

        <section className="card wide" aria-labelledby="fs">
          <div className="cardhead">
            <WhyHead why={ex['fund.booked']}>
              <h2 id="fs">Gains booked by selling</h2>
            </WhyHead>
            <span className="small muted">Oldest units sold first</span>
          </div>
          {sales.length > 0 ? (
            <>
              <StatList
                label="Gains booked by selling"
                items={
                  [
                    {
                      label: 'Sales',
                      value: String(d.realised.sales),
                      note: `${inr(d.realised.proceeds)} received`,
                    },
                    {
                      label: 'Short-term gain',
                      value: rupees(d.realised.stcg),
                      note: 'equity funds, held under the long-term period',
                      tone: d.realised.stcg === 0 ? null : tone(d.realised.stcg),
                    },
                    {
                      label: 'Long-term gain',
                      value: rupees(d.realised.ltcg),
                      note: 'equity funds, held longer',
                      tone: d.realised.ltcg === 0 ? null : tone(d.realised.ltcg),
                    },
                    {
                      label: 'Other funds',
                      value: rupees(d.realised.other),
                      note: 'debt, gold, international: taxed another way',
                      tone: d.realised.other === 0 ? null : tone(d.realised.other),
                    },
                  ] satisfies Stat[]
                }
              />
              <div style={{ height: 10 }} />
              <div className="cmpwrap">
                <table className="tbl lines cmp lotstbl">
                  <thead>
                    <tr>
                      <th>Sold</th>
                      <th className="num">Units</th>
                      <th className="num">Received</th>
                      <th className="num">Units held for</th>
                      <th className="num">Gain booked</th>
                      <th>Term</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...sales].reverse().map((r) => (
                      <tr key={r.n}>
                        <td data-label="Sold">
                          {niceDate(r.date)} <span className="muted small">{r.label}</span>
                        </td>
                        <td className="num" data-label="Units">
                          {units(Math.abs(r.units))}
                        </td>
                        <td className="num" data-label="Received">
                          {inr(Math.abs(r.amount))}
                        </td>
                        <td className="num" data-label="Units held for">
                          {held(r.heldDays)}
                        </td>
                        <td className={`num ${tone(r.realisedGain)}`} data-label="Gain booked">
                          {r.realisedGain === null ? 'not known' : rupees(r.realisedGain)}
                        </td>
                        <td data-label="Term">
                          {r.term === null
                            ? '–'
                            : r.term === 'mixed'
                              ? 'short and long'
                              : r.term === 'short'
                                ? 'short term'
                                : 'long term'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="cardnote">
                These are gains, not tax. The tax and the schedule for filing are on{' '}
                <Link href={demo ? '/demo/tax' : '/tax/filing'}>Tax filing papers</Link>. A sale
                that used units bought before the statement began has no known cost, so its gain is
                not shown.
              </p>
            </>
          ) : (
            <p className="empty">
              {noStatement ? 'Needs a fund statement.' : 'No sale is on the statement.'}
            </p>
          )}
        </section>

        {d.calendar.basis !== 'none' && (
          <section className="card wide" aria-labelledby="fc">
            <div className="cardhead">
              <h2 id="fc">Monthly investment calendar</h2>
              <span className="small muted">
                {d.sip.instalments === null
                  ? 'from the plan'
                  : `${d.sip.instalments} instalments, ${inr(d.sip.totalPaid ?? 0)} paid`}
              </span>
            </div>
            <SipStrip cells={d.calendar.cells} caption={`${f.name}: monthly investment by month`} />
            <p className="plotnote">
              {d.calendar.basis === 'statement'
                ? `${d.calendar.paid} instalment${d.calendar.paid === 1 ? '' : 's'} made${d.calendar.missed ? `, ${d.calendar.missed} month${d.calendar.missed === 1 ? '' : 's'} with none on the statement` : ''}.`
                : 'Drawn from the SIP plan, not from a statement, so a missed instalment cannot be shown.'}
            </p>
          </section>
        )}
      </>
    ) : null;

  return (
    <>
      {header}
      {tab === 'overview' && (
        <>
          {addsUp}
          <TaxPanel
            panel={tax}
            why={ex['fund.tax']}
            taxHref={taxHref}
            setExitLoadHref={href({ edit: f.assetId })}
            fundName={f.name}
          />
          {typeof overview === 'function' ? overview(ex) : overview}
        </>
      )}
      {tab === 'returns' && returnsBody}
      {tab === 'transactions' && (
        <section aria-labelledby="ft">
          <h2 id="ft" className="sr-only">
            Every transaction of this fund
          </h2>
          {t.lines > 0 && (
            <StatList
              label="Totals of the transactions"
              items={
                [
                  {
                    label: 'Transactions',
                    value: String(t.lines),
                    note: `${niceDate(t.firstOn)} to ${niceDate(t.lastOn)}`,
                  },
                  {
                    label: 'Put in',
                    value: inr(t.boughtAmount),
                    note: `${units(t.boughtUnits)} units`,
                  },
                  {
                    label: 'SIP instalments',
                    value: t.sipCount ? inr(t.sipAmount) : 'None',
                    note: t.sipCount ? `${t.sipCount} instalments` : undefined,
                  },
                  { label: 'One-off', value: t.oneOffAmount ? inr(t.oneOffAmount) : 'None' },
                  {
                    label: 'Taken out',
                    value: t.soldAmount ? inr(t.soldAmount) : 'None',
                    note: t.soldUnits ? `${units(t.soldUnits)} units` : undefined,
                  },
                  {
                    label: 'Gain booked',
                    value: t.soldAmount ? rupees(t.realisedGain) : 'None',
                    tone: t.soldAmount ? tone(t.realisedGain) : null,
                    note: t.salesUnknown
                      ? `${t.salesUnknown} sale(s) of unknown cost left out`
                      : undefined,
                  },
                ] satisfies Stat[]
              }
            />
          )}
          <div style={{ height: 14 }} />
          {addsUp}
          <div style={{ height: 14 }} />
          <Ledger
            rows={ledgerRows}
            withFund={false}
            pageSize={config.ledgerPageSize}
            name={`transactions-${f.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
            today={today}
            demo={demo}
            empty="No transactions are on file for this fund. Import a fund statement under Import, or press Add a transaction."
          />
          <ReplacedLines rows={replaced} />
        </section>
      )}
      {tab === 'sip' && sipPlan}
      {tab === 'lots' && lotsBody}
      {tab === 'records' && records}
    </>
  );
}

function held(days: number | null) {
  if (days === null) return '–';
  if (days < 60) return `${days} days`;
  if (days < 730) return `${Math.round(days / 30.4)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

export { rebase };
