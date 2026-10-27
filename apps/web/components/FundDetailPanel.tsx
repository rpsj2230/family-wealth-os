import Link from 'next/link';
import { formatInr, formatInrCompact } from '@fwos/core';
import type { FundDetail, DetailFund } from '@/lib/fund-detail-model';
import { niceDate } from '@/lib/dates';
import {
  BasisChip,
  MonthColumns,
  RangeSwitch,
  SipStrip,
  StackBar,
  StatList,
  type Stat,
} from './FundViz';
import { pct, rupees } from './InvestHeadline';
import { PlotChart, type PlotMarker } from './PlotChart';

const tone = (n: number | null): 'gain' | 'fail' | null =>
  n === null ? null : n >= 0 ? 'gain' : 'fail';
const inr = (n: number) => formatInr(Math.round(n));
const price = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const monthsText = (n: number) => {
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [
    y ? `${y} year${y === 1 ? '' : 's'}` : '',
    m || !y ? `${m} month${m === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' ');
};

/**
 * Everything the fund page adds for a mutual fund: the figures that describe it, then the graphs (price with every purchase and
 * the average cost, value against money put in, units, money per month, the SIP calendar and how much is long-term).
 */
export function FundDetailPanel({
  fund,
  detail,
  base,
  links,
  holdingMonths,
  colour = 'var(--viz-1)',
}: {
  fund: DetailFund;
  detail: FundDetail;
  /** this page's address, for the range switch */
  base: string;
  links: { update: string; match: string };
  holdingMonths: number | null;
  colour?: string;
}) {
  const f = fund;
  const d = detail;
  const real = f.hasStatement;
  const sip = d.sip;
  const hold = d.holding;
  const stats: Stat[] = [
    {
      label: 'Gain on units held',
      value: f.invested > 0 ? rupees(d.unrealised) : '–',
      note:
        d.unrealisedPct === null
          ? 'no cost recorded'
          : `${pct(d.unrealisedPct, 1)} on money put in`,
      tone: f.invested > 0 ? tone(d.unrealised) : null,
    },
    {
      label: 'Return a year (XIRR)',
      value: (
        <>
          {f.xirr === null ? '–' : pct(f.xirr, 1)}
          {f.xirr !== null && <BasisChip real={!f.xirrEstimated} />}
        </>
      ),
      note:
        f.xirr === null
          ? 'needs a start date or a fund statement'
          : f.xirrEstimated
            ? 'from the start date and SIP'
            : 'from the transactions',
      tone: tone(f.xirr),
    },
    {
      label: 'Compound growth (CAGR)',
      value: d.cagr === null ? '–' : pct(d.cagr, 1),
      note:
        d.cagr !== null
          ? `single investment on ${niceDate(d.cagrFrom!)}`
          : 'single investments only; with a SIP see XIRR',
      tone: tone(d.cagr),
    },
    {
      label: 'Average cost per unit',
      value: d.avgCost === null ? '–' : price(d.avgCost),
      note:
        d.avgCost === null
          ? 'needs units and money put in'
          : `${d.avgCostBasis === 'statement' ? 'from statement purchases' : d.avgCostBasis === 'estimated' ? 'estimated from the SIP plan' : 'money put in over units'}`,
    },
    {
      label: 'Price now',
      value: f.nav === null ? '–' : price(f.nav),
      note:
        d.priceVsCost === null
          ? f.nav === null
            ? 'no live price'
            : undefined
          : `${pct(d.priceVsCost, 1)} against your average cost`,
      tone: tone(d.priceVsCost),
    },
    {
      label: 'Units held',
      value: f.units === null ? '–' : f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 }),
      note: f.folioLast4 ? `folio …${f.folioLast4}` : undefined,
    },
    {
      label: 'Held since',
      value: d.firstOn ? niceDate(d.firstOn) : '–',
      note: d.firstOn ? 'first purchase' : 'no start date recorded',
    },
    {
      label: 'Today',
      value: f.dayAmount === null ? '–' : rupees(f.dayAmount),
      note: f.dayPct === null ? 'no price change yet' : pct(f.dayPct),
      tone: tone(f.dayAmount),
    },
    {
      label: 'Already long-term',
      value:
        hold?.longShare === null || hold?.longShare === undefined
          ? '–'
          : `${Math.round(hold.longShare * 100)}%`,
      note: hold
        ? `${inr(hold.longValue)} of ${inr(hold.longValue + hold.shortValue)}`
        : 'see below',
    },
    {
      label: 'Monthly investment (SIP)',
      value: sip.monthly ? inr(sip.monthly) : 'None',
      note: sip.stopped
        ? 'stopped'
        : sip.active
          ? `${sip.monthsRunning === null ? '' : `running ${monthsText(sip.monthsRunning)}`}${sip.nextOn ? `${sip.monthsRunning === null ? '' : ' · '}next ${niceDate(sip.nextOn)}${sip.basis === 'statement' ? '' : ' (expected; not verified by a statement)'}` : ''}`
          : undefined,
    },
    {
      label: 'Paid by SIP so far',
      value: sip.totalPaid === null ? '–' : inr(sip.totalPaid),
      note: sip.instalments === null ? 'needs a fund statement' : `${sip.instalments} instalments`,
    },
    {
      label: 'Gains booked by selling',
      value:
        d.realised.sales === 0
          ? 'None'
          : rupees(d.realised.stcg + d.realised.ltcg + d.realised.other),
      note:
        d.realised.sales === 0
          ? real
            ? 'no sale on the statement'
            : 'needs a fund statement'
          : `${d.realised.sales} sale line${d.realised.sales === 1 ? '' : 's'}, ${inr(d.realised.proceeds)} received`,
    },
  ];

  const buyMarkers: PlotMarker[] = d.nav.buys.map((b) => ({
    date: b.date,
    value: b.nav,
    shape: 'dot',
    colour: 'var(--viz-2)',
    label: `Bought ${inr(b.amount)} (${b.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units at ${price(b.nav)})`,
  }));
  const sellMarkers: PlotMarker[] = d.nav.sells.map((b) => ({
    date: b.date,
    value: b.nav,
    shape: 'down',
    colour: 'var(--viz-bad)',
    label: `Sold ${inr(b.amount)} (${b.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units at ${price(b.nav)})`,
  }));
  const valuePts = d.points.map((p) => ({ date: p.date, value: p.value }));
  const inPts = d.points
    .filter((p) => p.invested !== null)
    .map((p) => ({ date: p.date, value: p.invested as number }));
  const c = d.change;
  return (
    <>
      <section className="detailsection" aria-label="Fund in numbers">
        <h2>This fund in numbers</h2>
        <p className="muted small">
          {f.units !== null
            ? `${f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`
            : 'Units not recorded yet'}
          {f.nav !== null ? ` × price ${price(f.nav)}` : ''}
          {f.value ? ` = ${inr(f.value)}` : ''}.{' '}
          <Link href={links.update}>Update units and price</Link>
          {!f.amfiCode && (
            <>
              {' · '}
              <Link href={links.match}>Match this fund to follow its daily price</Link>
            </>
          )}
        </p>
        <StatList items={stats} label="Figures for this fund" />
      </section>

      <section className="detailsection" aria-label="Fund graphs">
        <h2>Graphs</h2>
        <RangeSwitch base={base} current={d.range} />
        <div>
          <div className="vizblock">
            <h3 className="subhead">Price, with every purchase and your average cost</h3>
            <PlotChart
              unit="nav"
              caption={`${f.name}: price per unit with purchases and average cost, ${d.rangeWords}`}
              series={[
                {
                  key: 'nav',
                  name: 'Price (NAV)',
                  colour,
                  points: d.nav.line.map((n) => ({ date: n.date, value: n.nav })),
                },
              ]}
              refs={
                d.nav.avgCost === null
                  ? []
                  : [
                      {
                        value: d.nav.avgCost,
                        label: `Average cost ${price(d.nav.avgCost)}`,
                        colour: 'var(--viz-2)',
                      },
                    ]
              }
              markers={[...buyMarkers, ...sellMarkers]}
              legendMarkers={[
                ...(buyMarkers.length
                  ? [
                      {
                        label: 'Purchase (at the price paid)',
                        shape: 'dot' as const,
                        colour: 'var(--viz-2)',
                      },
                    ]
                  : []),
                ...(sellMarkers.length
                  ? [{ label: 'Sale', shape: 'down' as const, colour: 'var(--viz-bad)' }]
                  : []),
              ]}
              empty={
                f.amfiCode
                  ? 'The price history appears once the daily prices have been fetched for this fund.'
                  : 'Match this fund to its official scheme to draw its price history.'
              }
              note={
                !real
                  ? 'No fund statement is imported, so purchases are not shown and the average cost is money put in over units.'
                  : d.nav.buys.length === 0 && d.nav.sells.length === 0
                    ? 'No purchase or sale in this period.'
                    : undefined
              }
            />
          </div>
          <div className="vizblock">
            <h3 className="subhead">Value against money put in</h3>
            <PlotChart
              unit="inr"
              caption={`${f.name}: value against money put in, ${d.rangeWords}`}
              series={[
                { key: 'value', name: 'Value', colour, area: true, points: valuePts },
                { key: 'in', name: 'Money put in', colour: 'var(--viz-line)', points: inPts },
              ]}
              note={[
                d.startsLate ? 'History starts later than this range.' : '',
                c && c.gain !== null
                  ? `Over ${d.rangeWords} the market added ${rupees(c.gain)} and ${rupees(c.netIn ?? 0)} of new money went in.`
                  : '',
                real ? '' : 'Without a fund statement the line follows the values you recorded.',
              ]
                .filter(Boolean)
                .join(' ')}
            />
          </div>
          {d.units.length >= 2 && (
            <div className="vizblock">
              <h3 className="subhead">Units held over time</h3>
              <PlotChart
                unit="units"
                caption={`${f.name}: units held after each transaction`}
                series={[
                  {
                    key: 'units',
                    name: 'Units held',
                    colour: 'var(--viz-3)',
                    step: true,
                    points: d.units,
                  },
                ]}
              />
            </div>
          )}
          {real && (
            <div className="vizblock">
              <h3 className="subhead">Money put in each month</h3>
              <MonthColumns
                months={d.contributions}
                caption={`${f.name}: money put in each month`}
              />
            </div>
          )}
          {d.calendar.basis !== 'none' && (
            <div className="vizblock">
              <h3 className="subhead">Monthly investment calendar</h3>
              <SipStrip
                cells={d.calendar.cells}
                caption={`${f.name}: monthly investment by month`}
              />
              <p className="plotnote">
                {d.calendar.basis === 'statement'
                  ? `${d.calendar.paid} instalment${d.calendar.paid === 1 ? '' : 's'} made${d.calendar.missed ? `, ${d.calendar.missed} month${d.calendar.missed === 1 ? '' : 's'} with none on the statement` : ''}.`
                  : 'Drawn from the SIP plan, not from a statement, so a missed instalment cannot be shown.'}
              </p>
            </div>
          )}
          <div className="vizblock">
            <h3 className="subhead">How much is long-term</h3>
            {hold ? (
              <>
                <StackBar
                  caption={`${f.name}: value held over and within the long-term period`}
                  parts={[
                    {
                      key: 'l',
                      label: `Held over ${holdingMonths} months`,
                      value: hold.longValue,
                      colour: 'var(--viz-1)',
                    },
                    {
                      key: 's',
                      label: 'Held for less',
                      value: hold.shortValue,
                      colour: 'var(--viz-2)',
                    },
                  ]}
                  format={formatInrCompact}
                />
                <p className="plotnote">
                  <BasisChip
                    real={hold.basis === 'statement'}
                    text={hold.basis === 'statement' ? 'statement' : 'estimated'}
                  />{' '}
                  {hold.nextTurn
                    ? `${inr(hold.nextTurn.value)} passes ${holdingMonths} months on ${niceDate(hold.nextTurn.on)}.`
                    : 'Everything has passed the period.'}
                </p>
              </>
            ) : (
              <p className="viz-empty">{d.holdingNote}</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
