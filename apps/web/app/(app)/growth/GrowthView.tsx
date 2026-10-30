import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  type GrowthProjection,
  type MoneyAtWork,
  type ReportTable,
  type WorkBucket,
} from '@fwos/core';
import { PrintButton, XlsxButton } from '@/components/CentreTools';
import { PageHead } from '@/components/PageHead';
import { PlotChart, type PlotSeries } from '@/components/PlotChart';
import { Tabs } from '@/components/Tabs';
import './growth.css';

export const GROWTH_TABS = ['slow', 'projection'] as const;
export type GrowthTab = (typeof GROWTH_TABS)[number];
export const parseGrowthTab = (v: string | undefined): GrowthTab =>
  (GROWTH_TABS as readonly string[]).includes(v ?? '') ? (v as GrowthTab) : 'slow';

const pct = (r: number) => `${(Math.round(r * 1000) / 10).toFixed(1)}%`;
const inr = (n: number) => formatInr(Math.round(n));

const BUCKET: Record<WorkBucket, { label: string; tone: string }> = {
  idle: { label: 'Not growing', tone: 'fail' },
  slow: { label: 'Slow: below inflation', tone: 'warn' },
  growing: { label: 'Growing', tone: 'info' },
  good: { label: 'Growing well', tone: 'ok' },
};

const COLOURS: Record<string, string> = {
  same: 'var(--viz-1)',
  allfunds: 'var(--viz-5)',
  longrun: 'var(--viz-other)',
  moved: 'var(--viz-6)',
};
const lineColour = (key: string, k: number) =>
  COLOURS[key] ??
  ['var(--viz-8)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-7)', 'var(--viz-4)'][k % 5]!;

function lineName(l: GrowthProjection['lines'][number]) {
  return `${l.label} (${pct(l.pace)} a year)`;
}

/** The two report tables: every holding with its rate and group, and the corpus year by year on every line. */
export function growthTables(
  work: MoneyAtWork,
  p: GrowthProjection,
  ageNames: string[],
): ReportTable[] {
  return [
    {
      id: 'money-at-work',
      title: 'Is my money growing?',
      note: `After tax and against inflation of ${pct(work.inflation)} a year.`,
      columns: [
        { key: 'owner', label: 'Whose', kind: 'text' },
        { key: 'name', label: 'Holding', kind: 'text' },
        { key: 'type', label: 'Type', kind: 'text' },
        { key: 'value', label: 'Value', kind: 'money' },
        { key: 'rate', label: 'Earns (before tax)', kind: 'pct' },
        { key: 'net', label: 'After tax', kind: 'pct' },
        { key: 'real', label: 'After inflation', kind: 'pct' },
        { key: 'group', label: 'Group', kind: 'text' },
        { key: 'basis', label: 'Rate from', kind: 'text' },
      ],
      rows: work.rows.map((r) => ({
        owner: r.owner,
        name: r.name,
        type: r.type,
        value: Math.round(r.value),
        rate: r.rate,
        net: r.netRate,
        real: r.realRate,
        group: BUCKET[r.bucket].label,
        basis: r.rateBasis,
      })),
    },
    {
      id: 'corpus',
      title: `Corpus year by year, ${p.years} years`,
      note: 'Interest and profit stay invested; SIPs continue and rise each year.',
      columns: [
        { key: 'year', label: 'Year', kind: 'int' },
        ...ageNames.map((n, i) => ({ key: `age${i}`, label: `${n}'s age`, kind: 'int' as const })),
        ...p.lines.map((l) => ({ key: l.key, label: lineName(l), kind: 'money' as const })),
        { key: 'real', label: 'Same pace in today’s rupees', kind: 'money' },
        { key: 'added', label: 'Added that year (SIPs)', kind: 'money' },
        { key: 'growth', label: 'Growth that year (same pace)', kind: 'money' },
      ],
      rows: p.table.map((y) => ({
        year: y.calendarYear,
        ...Object.fromEntries(y.ages.map((a, i) => [`age${i}`, a])),
        ...Object.fromEntries(p.lines.map((l) => [l.key, Math.round(l.values[y.year]!)])),
        real: Math.round(y.real),
        added: Math.round(y.added),
        growth: Math.round(y.growth),
      })),
    },
  ];
}

function SlowTab({ work }: { work: MoneyAtWork }) {
  const b = work.buckets;
  return (
    <>
      <dl className="gw-kpis" data-testid="gw-kpis">
        <div>
          <dt>Pace now, after tax</dt>
          <dd>{pct(work.paceNet)} a year</dd>
          <dd className="small muted">inflation {pct(work.inflation)}</dd>
        </div>
        <div className="fail">
          <dt>{BUCKET.idle.label}</dt>
          <dd>{formatInrCompact(b.idle.value)}</dd>
          <dd className="small muted">{b.idle.count} holdings</dd>
        </div>
        <div className="warn">
          <dt>{BUCKET.slow.label}</dt>
          <dd>{formatInrCompact(b.slow.value)}</dd>
          <dd className="small muted">{b.slow.count} holdings</dd>
        </div>
        <div>
          <dt>Lost to rising prices</dt>
          <dd>{inr(work.lostToInflation)} a year</dd>
          <dd className="small muted">by money growing slower than inflation</dd>
        </div>
        <div className="ok">
          <dt>The moves below would add</dt>
          <dd>{inr(work.movesGain)} a year</dd>
          <dd className="small muted">{work.moves.length} moves</dd>
        </div>
      </dl>

      <section className="card" aria-labelledby="gw-do-h" data-testid="gw-moves">
        <h2 id="gw-do-h">What would make it grow</h2>
        {work.moves.length === 0 && work.notes.length === 0 ? (
          <p className="muted">
            Nothing to suggest: every holding grows faster than prices rise, or no listed bank pays
            clearly more.
          </p>
        ) : (
          <ol className="gw-list">
            {work.moves.map((m) => (
              <li key={`m-${m.holdingId}`}>
                {m.text}
                <span className="small muted"> From the rates list; nothing is moved for you.</span>
              </li>
            ))}
            {work.notes.map((n) => (
              <li key={`n-${n.holdingId}`}>{n.text}</li>
            ))}
          </ol>
        )}
        <p className="small muted">
          Rates come from the <Link href="/rates">Rates</Link> page; the savings buffer, the
          smallest improvement worth a move and the insurance limit are in Settings.
        </p>
      </section>

      <section className="card" aria-labelledby="gw-all-h">
        <h2 id="gw-all-h">Every holding, slowest first</h2>
        <div className="tablewrap">
          <table className="tbl lines responsive gw-table" data-testid="gw-holdings">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Whose</th>
                <th className="num">Value</th>
                <th className="num">Earns</th>
                <th className="num">After tax</th>
                <th className="num">After inflation</th>
                <th>Group</th>
              </tr>
            </thead>
            <tbody>
              {work.rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Holding">
                    <Link href={`/asset/${r.id}`}>{r.name}</Link>
                    <div className="small muted">
                      {r.type}
                      {r.bank ? ` · ${r.bank}` : ''} · {r.rateBasis}
                    </div>
                  </td>
                  <td data-label="Whose">{r.owner}</td>
                  <td className="num" data-label="Value">
                    {inr(r.value)}
                  </td>
                  <td className="num" data-label="Earns">
                    {pct(r.rate)}
                  </td>
                  <td className="num" data-label="After tax">
                    {pct(r.netRate)}
                  </td>
                  <td
                    className={`num ${r.realRate < 0 ? 'fail' : 'gain'}`}
                    data-label="After inflation"
                  >
                    {pct(r.realRate)}
                  </td>
                  <td data-label="Group">
                    <span className={`pill ${BUCKET[r.bucket].tone}`}>
                      {BUCKET[r.bucket].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function ProjectionTab({
  work,
  p,
  ageNames,
  longRunEquity,
}: {
  work: MoneyAtWork;
  p: GrowthProjection;
  ageNames: string[];
  longRunEquity: number;
}) {
  const same = p.lines.find((l) => l.key === 'same')!;
  const end = same.values[p.years]!;
  const series: PlotSeries[] = p.lines.map((l, k) => ({
    key: l.key,
    name: lineName(l),
    colour: lineColour(l.key, k),
    dashed: l.shift !== 0,
    points: p.table.map((y) => ({ date: `${y.calendarYear}-01-01`, value: l.values[y.year]! })),
  }));
  const showAges = p.table[0]!.ages.map((a) => a !== null);
  return (
    <>
      <dl className="gw-kpis" data-testid="gw-proj-kpis">
        <div>
          <dt>Today</dt>
          <dd>{formatInrCompact(work.total)}</dd>
        </div>
        <div>
          <dt>Same pace</dt>
          <dd>{pct(same.pace)} a year</dd>
          <dd className="small muted">after tax, weighted by value</dd>
        </div>
        <div className="ok">
          <dt>In {p.years} years</dt>
          <dd>{formatInrCompact(end)}</dd>
          <dd className="small muted">
            {formatInrCompact(p.table[p.years]!.real)} in today’s rupees
          </dd>
        </div>
        {p.fundsPace !== null && (
          <div>
            <dt>Funds’ actual past return</dt>
            <dd>{pct(p.fundsPace)} a year</dd>
            <dd className="small muted">long-run in your plan {pct(longRunEquity)}</dd>
          </div>
        )}
        <div>
          <dt>SIPs</dt>
          <dd>{inr(p.monthlyNow)} a month</dd>
          <dd className="small muted">rising {pct(p.stepUp)} a year</dd>
        </div>
      </dl>

      <section className="card" aria-labelledby="gw-chart-h">
        <h2 id="gw-chart-h">Corpus over the next {p.years} years</h2>
        <PlotChart
          series={series}
          unit="inr"
          caption={`The corpus each year on every line, ${p.table[0]!.calendarYear} to ${p.table[p.years]!.calendarYear}`}
          note="Solid: the same pace (funds at their actual past return), funds at the long-run return, and the slow money moved. Dashed: slower and faster."
        />
      </section>

      <section className="card" aria-labelledby="gw-year-h" data-testid="gw-years">
        <h2 id="gw-year-h">Year by year</h2>
        <div className="tablewrap">
          <table className="tbl lines gw-years">
            <thead>
              <tr>
                <th>Year</th>
                {ageNames.map((n, i) =>
                  showAges[i] ? (
                    <th key={n} className="num">
                      {n}’s age
                    </th>
                  ) : null,
                )}
                {p.lines.map((l) => (
                  <th key={l.key} className="num">
                    {l.label}
                    <div className="small muted">{pct(l.pace)} a year</div>
                  </th>
                ))}
                <th className="num">
                  Same pace
                  <div className="small muted">in today’s ₹</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {p.table.map((y) => (
                <tr key={y.year}>
                  <td>{y.year === 0 ? `${y.calendarYear} (today)` : y.calendarYear}</td>
                  {y.ages.map((a, i) =>
                    showAges[i] ? (
                      <td key={i} className="num">
                        {a}
                      </td>
                    ) : null,
                  )}
                  {p.lines.map((l) => (
                    <td key={l.key} className={`num${l.key === 'same' ? ' gw-same' : ''}`}>
                      {formatInrCompact(l.values[y.year]!)}
                    </td>
                  ))}
                  <td className="num muted">{formatInrCompact(y.real)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" aria-labelledby="gw-detail-h">
        <h2 id="gw-detail-h">The same pace, in detail</h2>
        <div className="tablewrap">
          <table className="tbl lines gw-years">
            <thead>
              <tr>
                <th>Year</th>
                <th className="num">Added (SIPs)</th>
                <th className="num">Earned</th>
                <th className="num">Deposits</th>
                <th className="num">Funds</th>
                <th className="num">Cash</th>
                <th className="num">Others</th>
                <th className="num">Corpus</th>
              </tr>
            </thead>
            <tbody>
              {p.table.map((y) => (
                <tr key={y.year}>
                  <td>{y.calendarYear}</td>
                  <td className="num">{formatInrCompact(y.added)}</td>
                  <td className="num">{formatInrCompact(y.growth)}</td>
                  <td className="num">{formatInrCompact(y.byKind.fd)}</td>
                  <td className="num">{formatInrCompact(y.byKind.funds)}</td>
                  <td className="num">{formatInrCompact(y.byKind.cash)}</td>
                  <td className="num">{formatInrCompact(y.byKind.others)}</td>
                  <td className="num gw-same">{formatInrCompact(same.values[y.year]!)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <ul className="small muted gw-notes">
        <li>
          Each holding grows at the rate it earns today, after tax: deposits at their own rate
          (renewed at the same rate), savings at their rate, funds at their own yearly return.
          Interest and profit stay invested every year.
        </li>
        <li>
          The same pace grows every fund at its actual past return (XIRR)
          {p.fundsPace !== null ? `, ${pct(p.fundsPace)} a year across your funds` : ''}. A fund’s
          past few years can be far above what the next 20 bring, so “Funds at the long-run return”
          grows them at your retirement plan’s {pct(longRunEquity)} instead, with everything else
          unchanged. The slower lines show what a lower pace does.
        </li>
        <li>
          “Savings and deposits too at the funds’ actual past return” grows your savings, deposits
          and funds all at that same past return, as if the cash were invested the way the funds are
          (taxed only when sold). Property, retirement accounts and money lent keep their own pace.
        </li>
        <li>
          Slower and faster move every growing holding by the same points; money that earns nothing
          stays at nothing. “If the slow money is moved” makes the moves on the first tab today.
        </li>
        <li>
          SIPs running today continue and rise by the plan’s yearly step-up. Fund gains are taxed
          when sold, so the corpus is before that tax. Inflation is the plan’s ({pct(p.inflation)}).
        </li>
      </ul>
    </>
  );
}

export function GrowthView({
  work,
  projection,
  tab,
  base,
  ageNames,
  longRunEquity,
  today,
}: {
  work: MoneyAtWork;
  projection: GrowthProjection;
  tab: GrowthTab;
  base: string;
  ageNames: string[];
  longRunEquity: number;
  today: string;
}) {
  const tables = growthTables(work, projection, ageNames);
  return (
    <>
      <PageHead
        title="Money at work"
        subtitle="Which money is not growing, what would make it grow, and the corpus everything grows to if it keeps its pace."
        pills={[
          { label: `pace ${pct(work.paceNet)} a year after tax`, tone: 'info' },
          { label: `inflation ${pct(work.inflation)}`, tone: 'info' },
        ]}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <XlsxButton
              tables={tables}
              lines={[`As of ${today}.`]}
              fileName={`money-at-work-${today}`}
            />
            <PrintButton />
          </div>
        }
      />
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'slow', label: 'Is my money growing?' },
          { key: 'projection', label: `Corpus in ${projection.years} years` },
        ]}
      />
      {tab === 'slow' ? (
        <SlowTab work={work} />
      ) : (
        <ProjectionTab
          work={work}
          p={projection}
          ageNames={ageNames}
          longRunEquity={longRunEquity}
        />
      )}
    </>
  );
}
