import Link from 'next/link';
import {
  FD_BY,
  FUND_BY,
  PERIODS,
  fdBreakdown,
  fdInterestByFy,
  fdSummary,
  formatInrCompact,
  fundAge,
  fundFlow,
  fundSummary,
  parseFdBy,
  parseFundBy,
  buildReportsExplain,
  parsePeriod,
  reportTableExplain,
  sipTable,
  type ExplainSet,
  type ReportFd,
  type ReportFund,
  type ReportTable,
} from '@fwos/core';
import { BarList, inrCompact } from '@/components/charts';
import { KpiStrip } from '@/components/KpiStrip';
import { ParamTabs } from '@/components/ParamTabs';
import { CsvButton, ReportSheet } from '@/components/ReportTable';
import { Why, WhyHead } from '@/components/Why';

export type Params = Record<string, string | undefined>;

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const pctText = (v: number | null, d = 2) => (v === null ? '–' : `${(v * 100).toFixed(d)}%`);

/** One report: its title and note, a CSV download, an optional bar chart and the sheet. `controls` sit between the two. */
function Report({
  table,
  controls,
  caption,
  ctx,
}: {
  table: ReportTable;
  controls?: React.ReactNode;
  caption?: string;
  ctx: { today: string; noStatement: number; funds: number; links: { import: string } };
}) {
  return (
    <section className="card rptcard" aria-labelledby={`${table.id}-h`}>
      <div className="rpthead">
        <WhyHead why={reportTableExplain(table, ctx)}>
          <h2 id={`${table.id}-h`}>{table.title}</h2>
        </WhyHead>
        <CsvButton table={table} />
      </div>
      {table.note && <p className="muted small">{table.note}</p>}
      {controls && <div className="rptbar">{controls}</div>}
      {table.chart && table.chart.length > 1 && (
        <div className="rptchart">
          <BarList
            caption={caption ?? table.title}
            items={table.chart.slice(0, 24).map((c) => ({ label: c.label, value: c.value }))}
            format={inrCompact}
          />
        </div>
      )}
      <ReportSheet table={table} />
    </section>
  );
}

function Switch({
  base,
  params,
  name,
  label,
  options,
  current,
}: {
  base: string;
  params: Params;
  name: string;
  label: string;
  options: { key: string; label: string }[];
  current: string;
}) {
  return (
    <ParamTabs
      base={base}
      param={name}
      current={current}
      label={label}
      keep={params}
      tabs={options}
    />
  );
}

const reportLinks = (sample: boolean) => ({
  deposits: sample ? '/demo/deposits' : '/deposits',
  investments: sample ? '/demo/investments' : '/investments',
  import: sample ? '/demo/import' : '/import',
  settings: sample ? '/demo/settings' : '/settings',
});

export function DepositReports({
  fds,
  today,
  base,
  params,
  scope = null,
  sample = false,
}: {
  fds: ReportFd[];
  today: string;
  base: string;
  params: Params;
  scope?: string | null;
  sample?: boolean;
}) {
  const ex: ExplainSet<'reports'> = buildReportsExplain({
    today,
    scope,
    fds,
    funds: [],
    links: reportLinks(sample),
  });
  const ctx = { today, noStatement: 0, funds: 0, links: { import: reportLinks(sample).import } };
  const ms = parsePeriod(params.ms, 'date');
  const ss = parsePeriod(params.ss, 'date');
  const by = parseFdBy(params.by);
  const principal = sum(fds.map((f) => f.principal));
  const maturity = sum(fds.map((f) => f.maturityAmount));
  const avg = principal > 0 ? sum(fds.map((f) => f.principal * f.rate)) / principal : null;
  const next = fds
    .map((f) => f.maturityOn)
    .filter((d) => d >= today)
    .sort()[0];
  const nextAmt = next
    ? sum(fds.filter((f) => f.maturityOn === next).map((f) => f.maturityAmount))
    : null;
  return (
    <>
      <KpiStrip
        label="Deposits at a glance"
        items={[
          {
            label: 'Deposits',
            value: fds.length,
            sub: 'running or waiting to be confirmed',
            why: ex['reports.fdCount'],
          },
          {
            label: 'Amount put in',
            value: formatInrCompact(principal),
            main: true,
            why: ex['reports.fdPrincipal'],
          },
          {
            label: 'Pays at maturity',
            value: formatInrCompact(maturity),
            why: ex['reports.fdMaturity'],
          },
          {
            label: 'Total interest to maturity',
            value: formatInrCompact(maturity - principal),
            sub: 'from booking to maturity',
            why: ex['reports.fdInterest'],
          },
          {
            label: 'Average rate',
            value: pctText(avg),
            sub: 'weighted by amount',
            why: ex['reports.fdRate'],
          },
          {
            label: 'Next maturity',
            value: next ? formatInrCompact(nextAmt ?? 0) : '–',
            sub: next ?? 'none ahead',
            why: ex['reports.fdNext'],
          },
        ]}
        six
      />
      <p className="muted small">
        Every table ends with a Grand total row. <Why explain={ex['reports.table']} />
      </p>
      <Report
        ctx={ctx}
        table={fdSummary(fds, { basis: 'maturity', period: ms })}
        caption="What each maturity date pays"
        controls={
          <Switch
            base={base}
            params={params}
            name="ms"
            label="Group maturities by"
            options={PERIODS}
            current={ms}
          />
        }
      />
      <Report
        ctx={ctx}
        table={fdSummary(fds, { basis: 'start', period: ss })}
        controls={
          <Switch
            base={base}
            params={params}
            name="ss"
            label="Group start dates by"
            options={PERIODS}
            current={ss}
          />
        }
      />
      <Report
        ctx={ctx}
        table={fdBreakdown(fds, by)}
        controls={
          <Switch
            base={base}
            params={params}
            name="by"
            label="Group deposits by"
            options={FD_BY}
            current={by}
          />
        }
      />
      <Report
        ctx={ctx}
        table={fdInterestByFy(fds, today)}
        caption="Interest in each financial year"
      />
    </>
  );
}

export function FundReports({
  funds,
  today,
  longMonths,
  base,
  params,
  scope = null,
  sample = false,
}: {
  funds: ReportFund[];
  today: string;
  longMonths: number | null;
  base: string;
  params: Params;
  scope?: string | null;
  sample?: boolean;
}) {
  const ex: ExplainSet<'reports'> = buildReportsExplain({
    today,
    scope,
    fds: [],
    funds,
    links: reportLinks(sample),
  });
  const ctx = {
    today,
    noStatement: funds.filter((f) => !f.hasStatement).length,
    funds: funds.length,
    links: { import: reportLinks(sample).import },
  };
  const fb = parseFundBy(params.fb);
  const fp = parsePeriod(params.fp, 'month');
  const flow = parsePeriod(params.flow, 'fy');
  const invested = sum(funds.map((f) => f.invested));
  const value = sum(funds.map((f) => f.value));
  const sip = sum(funds.filter((f) => !f.sipStopped).map((f) => f.sipMonthly ?? 0));
  const withX = funds.filter((f) => f.xirr !== null && f.value > 0);
  const xirr =
    withX.length > 0
      ? sum(withX.map((f) => f.value * (f.xirr as number))) / sum(withX.map((f) => f.value))
      : null;
  return (
    <>
      <KpiStrip
        label="Mutual funds at a glance"
        items={[
          { label: 'Funds', value: funds.length, why: ex['reports.fundCount'] },
          {
            label: 'Invested',
            value: formatInrCompact(invested),
            why: ex['reports.fundInvested'],
          },
          {
            label: 'Value now',
            value: formatInrCompact(value),
            main: true,
            why: ex['reports.fundValue'],
          },
          {
            label: 'Gain',
            value: formatInrCompact(value - invested),
            tone: value - invested < 0 ? 'fail' : 'gain',
            sub:
              invested > 0 ? `${pctText((value - invested) / invested, 1)} of invested` : undefined,
            why: ex['reports.fundGain'],
          },
          {
            label: 'Average yearly return (XIRR)',
            value: pctText(xirr, 1),
            sub: 'average of the funds, weighted by value',
            why: ex['reports.fundXirr'],
          },
          {
            label: 'SIPs per month',
            value: formatInrCompact(sip),
            sub: 'running SIPs',
            why: ex['reports.fundSip'],
          },
        ]}
        six
      />
      <p className="muted small">
        Every table ends with a Grand total row. <Why explain={ex['reports.table']} />
      </p>
      <Report
        ctx={ctx}
        table={fundSummary(funds, fb, fp)}
        controls={
          <>
            <Switch
              base={base}
              params={params}
              name="fb"
              label="Group funds by"
              options={FUND_BY}
              current={fb}
            />
            {fb === 'start' && (
              <Switch
                base={base}
                params={params}
                name="fp"
                label="Group start dates by"
                options={PERIODS.filter((p) => p.key !== 'date')}
                current={fp === 'date' ? 'month' : fp}
              />
            )}
          </>
        }
      />
      <Report ctx={ctx} table={sipTable(funds, today)} />
      <Report
        ctx={ctx}
        table={fundFlow(funds, flow)}
        caption="Net money invested"
        controls={
          <Switch
            base={base}
            params={params}
            name="flow"
            label="Group money in and out by"
            options={PERIODS.filter((p) => p.key !== 'date')}
            current={flow === 'date' ? 'month' : flow}
          />
        }
      />
      <Report ctx={ctx} table={fundAge(funds, today, longMonths)} />
      <p className="muted small">
        More on how these funds are doing:{' '}
        <Link href="/investments?tab=breakdown">Investments, Breakdown</Link> and{' '}
        <Link href="/tax">Tax</Link>.
      </p>
    </>
  );
}
