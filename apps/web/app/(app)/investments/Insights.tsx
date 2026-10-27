import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CATEGORY_ORDER,
  foldShares,
  type AgeBucket,
  type InvestOverviewSet,
  type PlanSplit,
  formatInr,
  formatInrCompact,
  type PersonStyle,
  type ShareRow,
  type StatBlock,
} from '@fwos/core';
import { Donut } from '@/components/charts';
import { WhyHead } from '@/components/Why';
import { BasisChip, GainBars, StackBar, StatList, type Stat } from '@/components/FundViz';
import { pct, rupees } from '@/components/InvestHeadline';
import { niceDate } from '@/lib/dates';
import type { InvestmentView } from '@/lib/investments';
import { colourOf, slotColours } from '@/lib/viz';

const tone = (n: number | null): 'gain' | 'fail' | null =>
  n === null ? null : n >= 0 ? 'gain' : 'fail';
const share = (x: number) => `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`;

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

/* ---------------------------------------------------------------------------------------- breakdown */

function Allocation({
  view,
  stats,
  ex,
}: {
  view: InvestmentView;
  stats: StatBlock;
  ex: InvestOverviewSet;
}) {
  const cfg = view.config;
  const catColour = slotColours(CATEGORY_ORDER.filter((k) => view.palette.categories.includes(k)));
  const amcColour = slotColours(view.palette.amcs);
  const fundColour = slotColours(view.palette.funds);
  const cat = foldShares(stats.byCategory, cfg.maxSlices);
  const amc = foldShares(stats.byAmc, cfg.maxSlices);
  const funds = foldShares(stats.byFund, cfg.maxSlices);
  const parts = (rows: ShareRow[], plan: Map<string, string>, withGain = false) =>
    rows.map((r) => ({
      key: r.key,
      label: r.label,
      value: r.value,
      colour: colourOf(plan, r.key === '__none' ? '__none' : r.key),
      ...(withGain && r.gainPct !== null ? { note: pct(r.gainPct, 1) } : {}),
    }));
  const c = stats.concentration;
  return (
    <div className="insightgrid">
      <section className="card" aria-labelledby="al1">
        <div className="cardhead">
          <WhyHead why={ex['invest.byKind']}>
            <h2 id="al1">By kind of fund</h2>
          </WhyHead>
          <span className="small muted">Large, mid, small, hybrid, debt…</span>
        </div>
        {cat.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <Donut
            caption="Mutual fund value by kind of fund"
            size={150}
            slices={parts(cat, catColour)}
            centre={{ top: formatInrCompact(stats.value), bottom: 'value' }}
          />
        )}
        {stats.byCategory.some((r) => r.key === 'unknown') && (
          <p className="cardnote">
            “Kind not known” means the fund is not matched to the official list and its name does
            not say. <Link href="/investments?tab=match">Match it</Link>.
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="al2">
        <div className="cardhead">
          <WhyHead why={ex['invest.byHouse']}>
            <h2 id="al2">By fund house</h2>
          </WhyHead>
          <span className="small muted">Share of value</span>
        </div>
        {amc.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <StackBar caption="Mutual fund value by fund house" parts={parts(amc, amcColour)} />
        )}
        {stats.byAmc.some((r) => r.key === '__none') && (
          <p className="cardnote">
            The fund house comes from the official scheme list, so it appears once a fund is
            matched.
          </p>
        )}
      </section>
      <section className="card" aria-labelledby="al3">
        <div className="cardhead">
          <WhyHead why={ex['invest.byFund']}>
            <h2 id="al3">By fund</h2>
          </WhyHead>
          <span className="small muted">
            Top {cfg.concentrationTop} = {share(c.topShare)}
          </span>
        </div>
        {funds.length === 0 ? (
          <p className="empty">Nothing to split yet.</p>
        ) : (
          <StackBar caption="Mutual fund value by fund" parts={parts(funds, fundColour)} />
        )}
        {c.effectiveFunds !== null && stats.funds > 1 && (
          <p className="cardnote">
            Spread like {c.effectiveFunds.toFixed(1)} equal-sized funds, though you hold{' '}
            {stats.funds}.
          </p>
        )}
      </section>
    </div>
  );
}

export function BreakdownTab({
  ex,
  view,
  stats,
  who,
  styles,
  people,
  plans,
  ageing,
}: {
  ex: InvestOverviewSet;
  view: InvestmentView;
  stats: StatBlock;
  who: string | null;
  styles: Record<string, PersonStyle>;
  /** the person-against-person comparison, drawn by the page */
  people: ReactNode;
  plans: PlanSplit[];
  ageing: { buckets: AgeBucket[]; unknownValue: number; total: number };
}) {
  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>.
      </p>
    );
  const h = view.household;
  const months = view.holdingMonths;
  const hold = stats.holding;
  const sip = stats.sip;
  const real = stats.realised;

  const headline: Stat[] = [
    {
      label: 'Money put in',
      value: formatInr(Math.round(stats.invested)),
      note: 'cost of the units held',
      why: ex['invest.moneyIn'],
    },
    { label: 'Value now', value: formatInr(Math.round(stats.value)), why: ex['invest.value'] },
    {
      label: 'Gain on units held',
      value: rupees(stats.unrealised),
      note:
        stats.unrealisedPct === null
          ? undefined
          : `${pct(stats.unrealisedPct, 1)} on the ${formatInrCompact(stats.invested)} put in`,
      tone: tone(stats.unrealised),
      why: ex['invest.profit'],
    },
    {
      label: 'Return a year (XIRR)',
      value: (
        <>
          {h.xirr === null ? '–' : pct(h.xirr, 1)}
          {h.xirr !== null && (
            <BasisChip
              real={!h.xirrEstimated}
              text={h.xirrEstimated ? 'partly estimated' : 'statement'}
            />
          )}
        </>
      ),
      note:
        stats.estimated > 0
          ? `${stats.estimated} of ${stats.funds} funds have no fund statement`
          : 'every fund has a fund statement',
      tone: tone(h.xirr),
      why: ex['invest.xirr'],
    },
    stats.best
      ? {
          label: 'Best fund',
          value: pct(stats.best.pct, 1),
          note: <Link href={`/asset/${stats.best.assetId}`}>{stats.best.name}</Link>,
          tone: tone(stats.best.pct),
          why: ex['invest.movers'],
        }
      : { label: 'Best fund', value: '–', note: 'needs two funds with a cost' },
    stats.worst
      ? {
          label: 'Weakest fund',
          value: pct(stats.worst.pct, 1),
          note: <Link href={`/asset/${stats.worst.assetId}`}>{stats.worst.name}</Link>,
          tone: tone(stats.worst.pct),
          why: ex['invest.movers'],
        }
      : { label: 'Weakest fund', value: '–', note: 'needs two funds with a cost' },
    stats.bestDay
      ? {
          label: 'Best today',
          value: pct(stats.bestDay.pct, 2),
          note: <Link href={`/asset/${stats.bestDay.assetId}`}>{stats.bestDay.name}</Link>,
          tone: tone(stats.bestDay.pct),
          why: ex['invest.movers'],
        }
      : { label: 'Best today', value: '–', note: 'needs two live prices' },
    stats.worstDay
      ? {
          label: 'Weakest today',
          value: pct(stats.worstDay.pct, 2),
          note: <Link href={`/asset/${stats.worstDay.assetId}`}>{stats.worstDay.name}</Link>,
          tone: tone(stats.worstDay.pct),
          why: ex['invest.movers'],
        }
      : { label: 'Weakest today', value: '–', note: 'needs two live prices' },
    {
      label: 'Funds and folios',
      value: `${stats.funds} · ${stats.folios}`,
      note:
        stats.folios === 0 ? 'folio numbers come from a fund statement' : 'last four digits only',
    },
  ];

  return (
    <>
      <p className="lead muted">
        {who ? `${styles[who]?.name}'s funds` : 'All funds'}: where the money is, what has made or
        lost it, how much is already long-term, the monthly investments and the gains already
        booked.
      </p>
      {!who && view.groups.length > 1 && (
        <section className="card wide" aria-labelledby="bp">
          <div className="cardhead">
            <WhyHead why={ex['invest.people']}>
              <h2 id="bp">By person</h2>
            </WhyHead>
            <span className="small muted">Each PAN holder on one line</span>
          </div>
          {people}
        </section>
      )}

      <section className="card wide" aria-labelledby="kf">
        <div className="cardhead">
          <WhyHead why={ex['invest.keyFigures']}>
            <h2 id="kf">Key figures</h2>
          </WhyHead>
          <span className="small muted">As of {niceDate(view.today)}</span>
        </div>
        <StatList items={headline} label="Key figures for the mutual funds shown" />
      </section>

      <Allocation view={view} stats={stats} ex={ex} />

      <div className="insightgrid">
        <section className="card" aria-labelledby="pl">
          <div className="cardhead">
            <WhyHead why={ex['invest.plans']}>
              <h2 id="pl">Direct and Regular plans</h2>
            </WhyHead>
            <span className="small muted">Share of value</span>
          </div>
          {plans.length === 0 ? (
            <p className="empty">Nothing to split yet.</p>
          ) : (
            <>
              <StackBar
                caption="Mutual fund value by plan"
                parts={plans.map((x, i) => ({
                  key: x.key,
                  label: x.label,
                  value: x.value,
                  colour:
                    x.key === 'direct'
                      ? 'var(--viz-3)'
                      : x.key === 'regular'
                        ? 'var(--viz-2)'
                        : `var(--viz-${i + 5})`,
                  note: `${x.funds} fund${x.funds === 1 ? '' : 's'}`,
                }))}
              />
              <p className="cardnote">
                A Regular plan pays the distributor a commission out of the fund&apos;s expenses
                every year, so it earns less than the same fund&apos;s Direct plan. The saving in
                rupees is not worked out because the expense ratios are not in the free price data
                the page uses; set the plan in each fund&apos;s Edit panel.
              </p>
            </>
          )}
        </section>

        <section className="card" aria-labelledby="ag">
          <div className="cardhead">
            <WhyHead why={ex['invest.ageing']}>
              <h2 id="ag">How old the units are</h2>
            </WhyHead>
            <span className="small muted">By the date each purchase was made</span>
          </div>
          {ageing.total <= 0 ? (
            <p className="empty">
              The purchase dates are needed for this. Import a fund statement on the{' '}
              <Link href="/import">Import page</Link>, or match the fund to its official price so
              the SIPs can be estimated.
            </p>
          ) : (
            <>
              <StackBar
                caption="Value of the units held, by how long ago they were bought"
                parts={ageing.buckets.map((x, i) => ({
                  key: x.key,
                  label: x.label,
                  value: x.value,
                  colour: x.key === 'before' ? 'var(--viz-other)' : `var(--viz-${i + 1})`,
                  ...(x.estimatedValue > 0 ? { note: 'part estimated' } : {}),
                }))}
              />
              <p className="cardnote">
                {ageing.unknownValue > 0 &&
                  `${formatInrCompact(ageing.unknownValue)} is in funds whose purchases are not known and is left out. `}
                A purchase is short-term for equity funds until it has been held{' '}
                {view.holdingMonths ?? 'the set number of'} months.
              </p>
            </>
          )}
        </section>
      </div>

      <section className="card wide" aria-labelledby="gb">
        <div className="cardhead">
          <WhyHead why={ex['invest.gainByFund']}>
            <h2 id="gb">Gain or loss by fund</h2>
          </WhyHead>
          <span className="small muted">Value less money put in, on the units still held</span>
        </div>
        {stats.gainBars.length === 0 ? (
          <p className="empty">No fund has both a cost and a value yet.</p>
        ) : (
          <GainBars
            caption="Gain or loss on each fund"
            rows={stats.gainBars.map((g) => ({
              key: g.assetId,
              label: <Link href={`/asset/${g.assetId}`}>{g.label}</Link>,
              gain: g.gain,
              pctValue: g.gainPct,
            }))}
          />
        )}
      </section>

      <div className="insightgrid">
        <section className="card" aria-labelledby="hp">
          <div className="cardhead">
            <WhyHead why={ex['invest.longTermCard']}>
              <h2 id="hp">How much is long-term already</h2>
            </WhyHead>
            {months !== null && (
              <span className="small muted">Equity funds, over {months} months</span>
            )}
          </div>
          {months === null ? (
            <p className="empty">No long-term period is set in the tax rules in Settings.</p>
          ) : hold.longShare === null ? (
            <p className="empty">
              The purchase dates are needed for this. Import a fund statement on the{' '}
              <Link href="/import">Import page</Link>, or match the fund to its official price so
              the SIPs can be estimated.
            </p>
          ) : (
            <>
              <StackBar
                caption="Equity fund value held past and within the long-term period"
                parts={[
                  {
                    key: 'long',
                    label: `Held over ${months} months`,
                    value: hold.longValue,
                    colour: 'var(--viz-1)',
                  },
                  {
                    key: 'short',
                    label: 'Held for less',
                    value: hold.shortValue,
                    colour: 'var(--viz-2)',
                  },
                  {
                    key: 'unknown',
                    label: 'Purchases not known',
                    value: hold.unknownValue,
                    colour: 'var(--viz-other)',
                  },
                ]}
              />
              <p className="cardnote">
                Gain on the older units {rupees(hold.longGain)}, on the newer units{' '}
                {rupees(hold.shortGain)}.
                {hold.nextTurn && (
                  <>
                    {' '}
                    {formatInr(Math.round(hold.nextTurn.value))} of {hold.nextTurn.fund} passes{' '}
                    {months} months on {niceDate(hold.nextTurn.on)}.
                  </>
                )}
              </p>
              <p className="cardnote">
                {hold.fundsByBasis.statement > 0 && (
                  <>
                    <BasisChip real text="statement" /> {hold.fundsByBasis.statement} fund
                    {hold.fundsByBasis.statement === 1 ? '' : 's'} from purchases on a fund
                    statement.{' '}
                  </>
                )}
                {hold.fundsByBasis.estimated > 0 && (
                  <>
                    <BasisChip real={false} /> {hold.fundsByBasis.estimated} fund
                    {hold.fundsByBasis.estimated === 1 ? '' : 's'} rebuilt from the SIP plan and
                    published prices.{' '}
                  </>
                )}
                {hold.otherValue > 0 &&
                  `${formatInrCompact(hold.otherValue)} is in debt, gold, international or hybrid funds, which follow a different rule and are not counted here.`}
              </p>
              {hold.byFund.length > 1 && (
                <details className="disclose">
                  <summary>By fund</summary>
                  <GainBars
                    caption="Long-term value by fund"
                    rows={hold.byFund.map((f) => ({
                      key: f.assetId,
                      label: <Link href={`/asset/${f.assetId}`}>{f.name}</Link>,
                      gain: f.longValue,
                      pctValue:
                        f.longValue + f.shortValue > 0
                          ? f.longValue / (f.longValue + f.shortValue)
                          : null,
                    }))}
                  />
                  <p className="cardnote">
                    Bars show the long-term value; the percentage is the long-term share of that
                    fund.
                  </p>
                </details>
              )}
            </>
          )}
        </section>

        <section className="card" aria-labelledby="sp">
          <div className="cardhead">
            <WhyHead why={ex['invest.sipCard']}>
              <h2 id="sp">Monthly investments (SIP)</h2>
            </WhyHead>
            <span className="small muted">
              {sip.running} running{sip.stopped ? `, ${sip.stopped} stopped` : ''}
            </span>
          </div>
          {sip.running + sip.stopped === 0 ? (
            <p className="empty">No fund has a monthly investment recorded.</p>
          ) : (
            <StatList
              label="Monthly investment figures"
              items={[
                {
                  label: 'Going in each month',
                  value: formatInr(Math.round(sip.monthly)),
                  note: `${sip.running} fund${sip.running === 1 ? '' : 's'}`,
                },
                {
                  label: 'Paid so far',
                  value: sip.totalPaid === null ? '–' : formatInr(sip.totalPaid),
                  note:
                    sip.totalPaid === null
                      ? 'needs a fund statement'
                      : `from fund statements of ${sip.paidFunds} fund${sip.paidFunds === 1 ? '' : 's'}`,
                },
                {
                  label: 'Longest running',
                  value: sip.longestMonths === null ? '–' : monthsText(sip.longestMonths),
                },
                {
                  label: 'Next instalment',
                  value: sip.next ? niceDate(sip.next.on) : '–',
                  note: sip.next
                    ? `${formatInr(Math.round(sip.next.amount))} · ${sip.next.fund}${sip.next.estimated ? ' (expected)' : ''}`
                    : 'no running SIP',
                },
              ]}
            />
          )}
        </section>
      </div>

      <section className="card wide" aria-labelledby="rg">
        <div className="cardhead">
          <WhyHead why={ex['invest.bookedCard']}>
            <h2 id="rg">Gains already booked by selling</h2>
          </WhyHead>
          <span className="small muted">From the sales on fund statements, oldest units first</span>
        </div>
        {real.sales === 0 ? (
          <p className="empty">
            No sale appears on the fund statements imported so far. Nothing has been booked, or the
            statements are not imported yet.
          </p>
        ) : (
          <>
            <StatList
              label="Gains already booked"
              items={[
                {
                  label: 'Sales on statements',
                  value: String(real.sales),
                  note: `${formatInr(real.proceeds)} received`,
                },
                {
                  label: `Short-term (under ${months ?? '?'} months)`,
                  value: rupees(real.stcg),
                  note: 'equity-oriented funds',
                  tone: tone(real.stcg),
                },
                {
                  label: `Long-term (over ${months ?? '?'} months)`,
                  value: rupees(real.ltcg),
                  note: 'equity-oriented funds',
                  tone: tone(real.ltcg),
                },
                {
                  label: 'Other funds',
                  value: rupees(real.other),
                  note: 'debt, gold, international: taxed another way',
                  tone: tone(real.other),
                },
              ]}
            />
            {real.unknownCost > 0 && (
              <p className="cardnote">
                {real.unknownCost} sale{real.unknownCost === 1 ? '' : 's'} used units whose purchase
                is not on the statement, so{' '}
                {real.unknownCost === 1 ? 'its gain is' : 'their gains are'} left out.
              </p>
            )}
            {real.byYear.length > 0 && (
              <div className="cmpwrap">
                <table className="tbl lines cmp">
                  <thead>
                    <tr>
                      <th>Financial year</th>
                      <th className="num">Received</th>
                      <th className="num">Short-term gain</th>
                      <th className="num">Long-term gain</th>
                      <th className="num">Other funds</th>
                    </tr>
                  </thead>
                  <tbody>
                    {real.byYear.map((y) => (
                      <tr key={y.fy}>
                        <td data-label="Financial year">{y.fy}</td>
                        <td className="num" data-label="Received">
                          {formatInr(y.proceeds)}
                        </td>
                        <td className={`num ${tone(y.stcg)}`} data-label="Short-term gain">
                          {rupees(y.stcg)}
                        </td>
                        <td className={`num ${tone(y.ltcg)}`} data-label="Long-term gain">
                          {rupees(y.ltcg)}
                        </td>
                        <td className={`num ${tone(y.other)}`} data-label="Other funds">
                          {rupees(y.other)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="cardnote">
              These are gains, not tax. The tax and the schedule for filing are on{' '}
              <Link href="/tax/filing">Tax filing papers</Link>.
            </p>
          </>
        )}
      </section>
    </>
  );
}
