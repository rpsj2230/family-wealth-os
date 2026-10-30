import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  CATEGORY_ORDER,
  earnedSince,
  fyBoundsOf,
  fyOf,
  foldShares,
  formatInr,
  groupLines,
  GROUP_BYS,
  heroModel,
  buildValuationExplain,
  lotAgeing,
  parseGranularity,
  parseValuationRange,
  valuationHistory,
  type Explain,
  type InvestOverviewSet,
  parseGroupBy,
  splitByPlan,
  totalsOfLines,
  upcomingSips,
  type GroupBy,
  type PersonStyle,
  type PositionInput,
  type ShareRow,
  type YearKind,
} from '@fwos/core';
import { StackBar } from '@/components/FundViz';
import { WhyHead } from '@/components/Why';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { PlotChart } from '@/components/PlotChart';
import { Tabs } from '@/components/Tabs';
import {
  AddFundButton,
  AddTxnButton,
  FundEditProvider,
  type FundEditActions,
} from '@/components/invest/FundEdit';
import { DataCheck } from '@/components/invest/DataCheck';
import { FundsTable } from '@/components/invest/FundsTable';
import { Ledger } from '@/components/invest/Ledger';
import {
  Movers,
  GoalSummary,
  PersonCompare,
  UpcomingSips,
} from '@/components/invest/OverviewParts';
import { PortfolioHero } from '@/components/invest/PortfolioHero';
import { ValueByPeriod } from '@/components/invest/ValueByPeriod';
import { ReturnsByPeriod, type PeriodRow } from '@/components/invest/PerfParts';
import { investOverviewExplain, investPerfExplain } from '@/lib/explain-invest';
import { fundEditRows, householdLedger } from '@/lib/invest-ledger';
import { buildPl, parseCompareMode } from '@/lib/invest-pl';
import { fundLines, investPerformance, xirrOfIds } from '@/lib/invest-perf';
import { personRows } from '@/lib/invest-people';
import { investGrowth, investStats } from '@/lib/invest-view';
import { fundPace, type InvestmentView } from '@/lib/investments';
import { colourOf, slotColours } from '@/lib/viz';
import { parsePlKind } from '@fwos/core';
import { BreakdownTab } from './Insights';
import { PerformanceTab } from './PerfTab';
import './investments.css';
import '@/components/invest/invest.css';

export const TABS = [
  'overview',
  'performance',
  'valuation',
  'funds',
  'transactions',
  'breakdown',
  'update',
  'match',
] as const;
export type InvestTab = (typeof TABS)[number];
/** the tabs that read the funds and can be narrowed to one person */
export const PERSON_TABS: InvestTab[] = [
  'overview',
  'performance',
  'valuation',
  'funds',
  'transactions',
  'breakdown',
];

export const parseTab = (v: string | undefined): InvestTab =>
  v === 'growth'
    ? 'performance'
    : (TABS as readonly string[]).includes(v ?? '')
      ? (v as InvestTab)
      : 'overview';

export interface InvestQuery {
  tab: InvestTab;
  p?: string | undefined;
  range?: string | undefined;
  by?: string | undefined;
  compare?: string | undefined;
  heat?: string | undefined;
  group?: string | undefined;
  edit?: string | undefined;
  /** Value by period: weeks, months, quarters or years, and the dates of a chosen stretch */
  g?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

const fmtShare = (rows: ShareRow[]) => rows;

/**
 * The whole Investments page for the real portal and the public sample: header with the main actions, tabs, the person filter and the
 * content of the reading tabs. The two tabs that change things (Update funds, Match funds) arrive as `children`, because the real
 * page and the sample save differently. Every figure is worked out in packages/core; this lays them out.
 */
export function InvestShell({
  base,
  demo,
  q,
  view,
  styles,
  owners,
  noPrice,
  actions,
  position,
  taxFree = null,
  earnedFy,
  nominees,
  children,
}: {
  /** this FY's fund earnings as Home's ledger counts them (core fundsEarnedThisFy); when not given, worked out from the funds' series */
  earnedFy?: number | null | undefined;
  /** the yearly tax-free allowance on long-term equity gains and what each person has left of it this FY (the Tax page's figures) */
  taxFree?: { exemption: number; people: { name: string; left: number }[] } | null;
  /** '/investments' or '/demo/investments' */
  base: string;
  demo: boolean;
  q: InvestQuery;
  view: InvestmentView;
  styles: Record<string, PersonStyle>;
  owners: { id: string; name: string }[];
  noPrice: number;
  actions?: FundEditActions;
  /** what the Value by period tab reads (only given when that tab is open) */
  position?: PositionInput | undefined;
  /** nominee notes by fund, so the edit panel can offer the nominee (not in the public sample) */
  nominees?: Record<string, string> | undefined;
  children?: ReactNode;
}) {
  const tab = q.tab;
  const who = q.p && styles[q.p] && PERSON_TABS.includes(tab) ? q.p : null;
  const link = (patch: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = {
      tab,
      p: who ?? undefined,
      range: q.range,
      by: q.by,
      compare: q.compare,
      heat: q.heat,
      group: q.group,
      g: q.g,
      from: q.from,
      to: q.to,
      ...patch,
    };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(merged))
      if (v !== undefined && v !== '' && !(k === 'tab' && v === 'overview')) sp.set(k, v);
    const s = sp.toString();
    return s ? `${base}?${s}` : base;
  };
  const tabHref = (t: InvestTab) =>
    link({
      tab: t,
      range: undefined,
      by: undefined,
      compare: undefined,
      heat: undefined,
      group: undefined,
      g: undefined,
      from: undefined,
      to: undefined,
    });

  const funds = view.groups.flatMap((g) => g.funds);
  const stats = investStats(view);
  const lines = fundLines(view);
  const xirrOf = xirrOfIds(view);
  const everything = lines.reduce((a, l) => a + l.value, 0);
  const grand = totalsOfLines(lines, everything, xirrOf);
  const cfg = view.config;
  const goalName = Object.fromEntries(view.goals.map((g) => [g.id, g.name]));
  const needsPerf = tab === 'overview' || tab === 'performance';
  const perf = needsPerf ? investPerformance(view) : null;
  const h = view.household;
  const pace = fundPace(view);
  const hero = heroModel({
    funds: stats.all.funds,
    folios: stats.all.folios,
    invested: stats.all.invested,
    value: stats.all.value,
    dayAmount: h.dayAmount,
    dayPct: h.dayPct,
    xirr: h.xirr,
    xirrEstimated: h.xirrEstimated,
    sipMonthly: h.sipMonthly,
    withStatement: stats.all.withStatement,
    estimated: stats.all.estimated,
    unreconciled: funds.filter((f) => f.ledger.figuresEstimated).length,
    longShare: stats.all.holding.longShare,
    realised: stats.all.realised,
  });
  const totals = Object.fromEntries(
    view.groups.map((g) => [g.ownerId, formatInr(Math.round(g.totals.value))]),
  );
  // the "?" explainers: worked out from the same view, hero and statistics as the figures they sit beside
  const exArgs = { view, base, demo, who, styles, hero, stats: stats.all, pace };
  const ex = investOverviewExplain(exArgs);
  const growth = tab === 'performance' ? investGrowth(view) : undefined;
  const pl =
    tab === 'performance' && perf
      ? buildPl(view, perf, styles, parsePlKind(q.by), parseCompareMode(q.compare))
      : undefined;
  const heat = (q.heat === 'calendar' ? 'calendar' : 'financial') as YearKind;
  const exPerf = perf ? investPerfExplain({ ...exArgs, perf, growth, pl, heat }) : null;
  const editRows = fundEditRows(view);
  const matchHref = link({ tab: 'match', p: undefined });
  const keepForPerson = Object.fromEntries(
    Object.entries({
      tab,
      range: q.range,
      by: q.by,
      compare: q.compare,
      heat: q.heat,
      group: q.group,
    }).filter(([k, v]) => v !== undefined && !(k === 'tab' && v === 'overview')),
  ) as Record<string, string>;

  return (
    <FundEditProvider
      rows={editRows}
      owners={owners}
      goals={view.goals}
      styles={styles}
      today={view.today}
      {...(actions ? { actions } : {})}
      linkBase={{ match: matchHref, demo }}
      initialOpen={q.edit ?? null}
      nominees={nominees}
    >
      <PageHead
        title="Investments"
        subtitle={
          <>
            What your mutual funds are worth, what they have earned and how they have performed,
            with every transaction. Prices are fetched every day for funds you have matched.
          </>
        }
        pills={[
          {
            label: `${view.household.funds} fund${view.household.funds === 1 ? '' : 's'}`,
            tone: 'info',
          },
          noPrice > 0
            ? { label: `${noPrice} without a live price`, tone: 'warn' }
            : { label: 'all funds follow their price', tone: 'ok' },
        ]}
        actions={
          <>
            <Link className="btn primary" href={link({ tab: 'update', p: undefined })}>
              Update funds
            </Link>
            <AddFundButton />
            <AddTxnButton />
            <Link className="btn" href={demo ? '/demo/tax-harvest' : '/tax'}>
              Tax harvest
            </Link>
          </>
        }
      />

      <Tabs
        base={base}
        current={tab}
        keep={who ? { p: who } : {}}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'performance', label: 'Performance' },
          { key: 'valuation', label: 'Value by period' },
          { key: 'funds', label: 'Funds' },
          { key: 'transactions', label: 'Transactions' },
          { key: 'breakdown', label: 'Breakdown' },
          { key: 'update', label: 'Update funds' },
          { key: 'match', label: 'Match funds', badge: noPrice },
        ]}
      />
      {PERSON_TABS.includes(tab) && (
        <PersonFilter
          people={Object.values(styles)}
          basePath={base}
          current={who}
          totals={totals}
          keep={keepForPerson}
        />
      )}

      {tab === 'overview' && perf && (
        <>
          <PortfolioHero
            ex={ex}
            hero={hero}
            asOf={view.today}
            history={view.series}
            projection={pace.projections.map((x) => ({ years: x.years, expected: x.expected }))}
            projectionRate={pace.rate}
            projectionAssumed={pace.assumed}
            holdingMonths={view.holdingMonths}
            extras={{
              ...heroExtras(view.groups.flatMap((g) => g.funds)),
              taxFree,
              bench: view.benchmark
                ? {
                    name: view.benchmark.name ?? 'the benchmark fund',
                    xirr: perf.whatIf?.xirr ?? null,
                  }
                : null,
              earnedFy:
                earnedFy !== undefined
                  ? earnedFy
                  : (earnedSince(view.series, fyBoundsOf(fyOf(view.today))!.from)?.gain ?? null),
            }}
            base={base}
            tabLinks={{
              performance: tabHref('performance'),
              transactions: tabHref('transactions'),
              breakdown: tabHref('breakdown'),
              tax: demo ? '/demo/tax-harvest' : '/tax',
            }}
          />
          <OverviewBody
            ex={ex}
            exReturns={exPerf!['invest.returns']}
            view={view}
            perf={perf}
            lines={lines}
            xirrOf={xirrOf}
            styles={styles}
            who={who}
            goalName={goalName}
            tabHref={tabHref}
            link={link}
            demo={demo}
            stats={stats}
            funds={funds}
          />
        </>
      )}

      {tab === 'performance' && perf && growth && pl && exPerf && (
        <PerformanceTab
          ex={exPerf}
          view={view}
          stats={stats.all}
          perf={perf}
          growth={growth}
          pace={pace}
          pl={pl}
          who={who}
          styles={styles}
          heat={heat}
          link={(patch) => link({ tab: 'performance', ...patch })}
        />
      )}

      {tab === 'valuation' && position && (
        <ValuationTab
          position={position}
          q={q}
          who={who}
          styles={styles}
          recent={cfg.valuationPeriods}
          noLedgerAbove={cfg.noLedgerNoteAbove}
          financialQuarters={cfg.financialQuarters}
          base={base}
          link={(patch) => link({ tab: 'valuation', ...patch })}
          demo={demo}
        />
      )}

      {tab === 'funds' && (
        <FundsBody
          ex={ex}
          view={view}
          lines={lines}
          xirrOf={xirrOf}
          grand={grand}
          group={parseGroupBy(q.group)}
          styles={styles}
          goalName={goalName}
          demo={demo}
          matchHref={matchHref}
          groupHref={(g) => link({ tab: 'funds', group: g === 'person' ? undefined : g })}
          who={who}
        />
      )}

      {tab === 'transactions' && (
        <section aria-labelledby="tx">
          <h2 id="tx" className="sr-only">
            Every transaction
          </h2>
          <p className="lead muted">
            Every purchase, SIP instalment, switch, dividend and sale on your fund statements and
            the ones you typed, with the units and the cost held after each.{' '}
            {funds.some((f) => !f.hasStatement) &&
              `${funds.filter((f) => !f.hasStatement).length} fund${funds.filter((f) => !f.hasStatement).length === 1 ? ' has' : 's have'} no transactions on file yet: import a statement under Import or add them with Add a transaction.`}
          </p>
          <Ledger
            rows={householdLedger(view, styles)}
            withFund
            pageSize={cfg.ledgerPageSize}
            name="transactions"
            today={view.today}
            demo={demo}
            empty="No transaction is on file yet. Import a fund statement on the Import page, or add one with Add a transaction."
          />
        </section>
      )}

      {tab === 'breakdown' && (
        <BreakdownTab
          ex={ex}
          view={view}
          stats={stats.all}
          who={who}
          styles={styles}
          people={
            <PersonCompare
              rows={personRows(
                view,
                stats.byOwner,
                (id) => groupLines(lines, 'person', xirrOf).find((g) => g.key === id)!.totals,
              )}
              styles={styles}
              topN={cfg.concentrationTop}
            />
          }
          plans={splitByPlan(lines)}
          ageing={lotAgeing(funds, view.today, cfg.ageBucketsMonths)}
        />
      )}

      {(tab === 'update' || tab === 'match') && children}
    </FundEditProvider>
  );
}

/* ----------------------------------------------------------------------------------------------- overview */

function OverviewBody({
  ex,
  exReturns,
  view,
  perf,
  lines,
  xirrOf,
  styles,
  who,
  goalName,
  tabHref,
  link,
  demo,
  stats,
  funds,
}: {
  ex: InvestOverviewSet;
  exReturns: Explain;
  view: InvestmentView;
  perf: ReturnType<typeof investPerformance>;
  lines: ReturnType<typeof fundLines>;
  xirrOf: ReturnType<typeof xirrOfIds>;
  styles: Record<string, PersonStyle>;
  who: string | null;
  goalName: Record<string, string>;
  tabHref: (t: InvestTab) => string;
  link: (patch: Record<string, string | undefined>) => string;
  demo: boolean;
  stats: ReturnType<typeof investStats>;
  funds: InvestmentView['groups'][number]['funds'];
}) {
  void goalName;
  const cfg = view.config;
  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>, or press Add a fund.
      </p>
    );
  const fundHref = (id: string) => (demo ? `/demo/asset?kind=fund&id=${id}` : `/asset/${id}`);
  const profile = perf.profile;
  const bench = view.benchmark;
  const hasBench = !!bench && perf.versus.some((x) => x.v.benchmark !== null);
  const KEYS = ['1m', '3m', '6m', 'fy', '1y', '3y', 'all'];
  const rows: PeriodRow[] = perf.versus
    .filter((x) => KEYS.includes(x.def.key))
    .map((x) => ({
      def: x.def,
      r: profile.trailing.find((t) => t.def.key === x.def.key)?.r ?? null,
      gain: perf.periodGains[x.def.key],
      v: x.v,
    }));
  const goals = groupLines(lines, 'goal', xirrOf, view.goals);
  const anyGoal = goals.some((g) => !g.key.startsWith('__'));
  const total = lines.reduce((a, l) => a + l.value, 0);
  const grand = totalsOfLines(lines, total, xirrOf);
  const catColour = slotColours(CATEGORY_ORDER.filter((k) => view.palette.categories.includes(k)));
  const cat = foldShares(stats.all.byCategory, cfg.maxSlices);
  const people = who ? null : groupLines(lines, 'person', xirrOf);
  return (
    <>
      <section className="card dcsection" aria-labelledby="ov-dc">
        <div className="cardhead">
          <WhyHead why={ex['invest.dataCheck']}>
            <h2 id="ov-dc">Is the history complete?</h2>
          </WhyHead>
          <Link className="sectionlink" href={link({ tab: 'funds', group: undefined })}>
            Funds
          </Link>
        </div>
        {view.groups.map((g) => (
          <div
            key={g.ownerId}
            className="dcperson"
            style={{ ['--person' as string]: styles[g.ownerId]?.colour }}
          >
            <h3 className="dcname">{g.name}</h3>
            <DataCheck summary={g.ledger} fundHref={fundHref} />
          </div>
        ))}
      </section>
      <div className="invgrid two">
        <section className="card" aria-labelledby="ov-v">
          <div className="cardhead">
            <WhyHead why={ex['invest.valueChart']}>
              <h2 id="ov-v">Current value and invested</h2>
            </WhyHead>
            <Link className="sectionlink" href={tabHref('performance')}>
              Performance
            </Link>
          </div>
          <PlotChart
            unit="inr"
            caption="Current value of mutual funds against invested, whole history"
            series={[
              {
                key: 'value',
                name: 'Value',
                colour: who ? (styles[who]?.colour ?? 'var(--viz-1)') : 'var(--viz-1)',
                area: true,
                points: view.series.map((p) => ({ date: p.date, value: p.value })),
              },
              {
                key: 'in',
                name: 'Invested',
                colour: 'var(--viz-line)',
                points: view.series
                  .filter((p) => p.invested !== null)
                  .map((p) => ({ date: p.date, value: p.invested as number })),
              },
            ]}
          />
        </section>
        <section className="card" aria-labelledby="ov-r">
          <div className="cardhead">
            <WhyHead why={exReturns}>
              <h2 id="ov-r">Return over time</h2>
            </WhyHead>
            <Link className="sectionlink" href={tabHref('performance')}>
              All periods
            </Link>
          </div>
          <ReturnsByPeriod
            rows={rows}
            benchName={bench?.name ?? null}
            hasBench={hasBench}
            bars={false}
            showGain={false}
          />
        </section>
      </div>

      <div className="invgrid">
        <section className="card" aria-labelledby="ov-g">
          <div className="cardhead">
            <WhyHead why={ex['invest.goals']}>
              <h2 id="ov-g">Goal by goal</h2>
            </WhyHead>
            <span className="small muted">Funds set aside for each goal</span>
          </div>
          {anyGoal ? (
            <GoalSummary
              groups={goals}
              grand={grand}
              groupHref={link({ tab: 'funds', group: 'goal' })}
              goalsHref={demo ? '/demo/goals' : '/goals'}
            />
          ) : (
            <p className="empty">
              No fund is set aside for a goal yet. Choose a goal in a fund&apos;s Edit panel, or add
              goals on the <Link href={demo ? '/demo/goals' : '/goals'}>Goals page</Link>.
            </p>
          )}
        </section>
        <section className="card" aria-labelledby="ov-k">
          <div className="cardhead">
            <WhyHead why={ex['invest.mix']}>
              <h2 id="ov-k">Where the money is</h2>
            </WhyHead>
            <Link className="sectionlink" href={tabHref('breakdown')}>
              Breakdown
            </Link>
          </div>
          <StackBar
            caption="Mutual fund value by kind of fund"
            parts={fmtShare(cat).map((r) => ({
              key: r.key,
              label: r.label,
              value: r.value,
              colour: colourOf(catColour, r.key),
            }))}
          />
        </section>
        <section className="card" aria-labelledby="ov-m">
          <div className="cardhead">
            <WhyHead why={ex['invest.movers']}>
              <h2 id="ov-m">Movers</h2>
            </WhyHead>
            <span className="small muted">Today and overall</span>
          </div>
          <Movers
            best={stats.all.best}
            worst={stats.all.worst}
            bestDay={stats.all.bestDay}
            worstDay={stats.all.worstDay}
            href={fundHref}
            count={cfg.moversShown}
          />
        </section>
        <section className="card" aria-labelledby="ov-s">
          <div className="cardhead">
            <WhyHead why={ex['invest.nextSips']}>
              <h2 id="ov-s">Next monthly investments</h2>
            </WhyHead>
            <span className="small muted">SIP calendar</span>
          </div>
          <UpcomingSips
            list={upcomingSips(funds, view.today, cfg.upcomingSips)}
            today={view.today}
          />
        </section>
      </div>

      {people && people.length > 1 && (
        <section className="card wide" aria-labelledby="ov-p">
          <div className="cardhead">
            <WhyHead why={ex['invest.people']}>
              <h2 id="ov-p">Person against person</h2>
            </WhyHead>
            <Link className="sectionlink" href={tabHref('breakdown')}>
              Breakdown
            </Link>
          </div>
          <PersonCompare
            rows={personRows(view, stats.byOwner, (id) => people.find((g) => g.key === id)!.totals)}
            styles={styles}
            topN={cfg.concentrationTop}
          />
        </section>
      )}
    </>
  );
}

/* ----------------------------------------------------------------------------------------------- funds */

function FundsBody({
  ex,
  view,
  lines,
  xirrOf,
  grand,
  group,
  styles,
  goalName,
  demo,
  matchHref,
  groupHref,
  who,
}: {
  ex: InvestOverviewSet;
  view: InvestmentView;
  lines: ReturnType<typeof fundLines>;
  xirrOf: ReturnType<typeof xirrOfIds>;
  grand: ReturnType<typeof totalsOfLines>;
  group: GroupBy;
  styles: Record<string, PersonStyle>;
  goalName: Record<string, string>;
  demo: boolean;
  matchHref: string;
  groupHref: (g: GroupBy) => string;
  who: string | null;
}) {
  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>, or press Add a fund.
      </p>
    );
  const groups = groupLines(lines, group, xirrOf, view.goals);
  const goalGroups = group === 'goal' ? groups : null;
  void who;
  return (
    <>
      <nav className="rangeswitch groupby" aria-label="Group by">
        <span className="rangelabel">Group by</span>
        {GROUP_BYS.map((g) => (
          <Link
            key={g.key}
            href={groupHref(g.key)}
            scroll={false}
            className={`fchip ${group === g.key ? 'on' : ''}`}
            aria-current={group === g.key ? 'true' : undefined}
          >
            {g.label}
          </Link>
        ))}
      </nav>
      {goalGroups && (
        <section className="card" aria-labelledby="fg">
          <div className="cardhead">
            <WhyHead why={ex['invest.goals']}>
              <h2 id="fg">Goal by goal</h2>
            </WhyHead>
            <span className="small muted">Invested, profit and current value</span>
          </div>
          <GoalSummary
            groups={goalGroups}
            grand={grand}
            groupHref={groupHref('goal')}
            goalsHref={demo ? '/demo/goals' : '/goals'}
          />
        </section>
      )}
      <FundsTable
        why={ex['invest.fundsTable']}
        groups={groups}
        grand={grand}
        by={group}
        styles={styles}
        goalName={goalName}
        demo={demo}
        matchHref={matchHref}
        checks={Object.fromEntries(view.groups.map((g) => [g.ownerId, g.ledger]))}
      />
      {view.household.xirrEstimated && (
        <p className="muted small">
          A return marked ~ is estimated from each fund&apos;s start date and SIP until its fund
          statement is imported (<Link href="/import">Import</Link>). Each row shows the units, the
          start and the price; hover a fund for the full line.
        </p>
      )}
    </>
  );
}

/** Investments > Value by period: the chart and table of the funds' worth at the end of each period. */
function ValuationTab({
  position,
  q,
  who,
  styles,
  recent,
  noLedgerAbove,
  financialQuarters,
  base,
  link,
  demo,
}: {
  position: PositionInput;
  q: InvestQuery;
  who: string | null;
  styles: Record<string, PersonStyle>;
  recent: number;
  noLedgerAbove: number;
  financialQuarters: boolean;
  base: string;
  link: (patch: Record<string, string | undefined>) => string;
  demo: boolean;
}) {
  const h = valuationHistory({
    position,
    granularity: parseGranularity(q.g),
    range: parseValuationRange(q.range, q.from, q.to),
    owner: who,
    recent,
    financialQuarters,
  });
  const name = who ? (styles[who]?.name ?? 'everyone') : 'everyone';
  const csv = new URLSearchParams();
  csv.set('g', h.granularity);
  if (h.range.kind === 'between') {
    csv.set('from', h.range.from);
    csv.set('to', h.range.to);
  } else csv.set('range', h.range.kind);
  if (who) csv.set('p', who);
  return (
    <ValueByPeriod
      h={h}
      ex={buildValuationExplain(h, name)}
      href={link}
      csvHref={`${base}/valuation-csv?${csv.toString()}`}
      action={base}
      keep={{ tab: 'valuation', g: h.granularity, ...(who ? { p: who } : {}) }}
      recent={recent}
      noLedgerAbove={noLedgerAbove}
      who={name}
      demo={demo}
    />
  );
}

/** "Also on this page" of the headline: the value by platform (largest first) and the Regular plans, from the funds shown. */
function heroExtras(funds: { value: number; plan: string; platform: string | null }[]) {
  const by = new Map<string, number>();
  for (const f of funds)
    by.set(f.platform ?? 'Not set', (by.get(f.platform ?? 'Not set') ?? 0) + f.value);
  const regular = funds.filter((f) => f.plan === 'regular');
  return {
    platforms: [...by.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value),
    regular: { value: regular.reduce((a, f) => a + f.value, 0), count: regular.length },
  };
}
