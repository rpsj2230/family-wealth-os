import Link from 'next/link';
import {
  CENTRE_TEMPLATES,
  GROUP_LABEL,
  PERIOD_PRESETS,
  formatInr,
  kindLabel,
  paramsToQuery,
  queryToParams,
  readPhrase,
  runReport,
  type CentreKpi,
  type CentreQuery,
  type SavedReport,
} from '@fwos/core';
import { PrintButton, RecentReports as RecentList, XlsxButton } from '@/components/CentreTools';
import { CsvButton, ReportSheet } from '@/components/ReportTable';
import { KpiStrip } from '@/components/KpiStrip';
import type { CentreData } from '@/lib/report-centre-data';
import './centre.css';

type Params = Record<string, string | undefined>;

const BASIS: Record<'A' | 'B' | 'C', string> = {
  A: 'From recorded figures',
  B: 'From recorded figures, with a limit stated below',
  C: 'Estimated from terms (see below)',
};

const KINDS = [
  'purchase',
  'sip',
  'switch_in',
  'redeem',
  'switch_out',
  'dividend_reinvest',
  'bonus',
  'other',
];

function kpiValue(k: CentreKpi): string {
  if (k.value === null) return 'Not available';
  if (k.kind === 'int') return k.value.toLocaleString('en-IN');
  if (k.kind === 'pct') return `${(k.value * 100).toFixed(1)}%`;
  return formatInr(Math.round(k.value));
}
function kpiSub(k: CentreKpi, prevLabel: string | null): string | undefined {
  if (k.previous === undefined || !prevLabel) return k.note;
  if (k.previous === null || k.value === null) return `${prevLabel}: not available`;
  const diff = k.value - k.previous;
  const sign = diff > 0 ? '+' : diff < 0 ? '−' : '';
  const amount =
    k.kind === 'int'
      ? Math.abs(diff).toLocaleString('en-IN')
      : formatInr(Math.abs(Math.round(diff)));
  return `${prevLabel}: ${k.kind === 'int' ? k.previous.toLocaleString('en-IN') : formatInr(Math.round(k.previous))} (${sign}${amount})`;
}

const hrefOf = (base: string, q: CentreQuery) =>
  `${base}?${new URLSearchParams({ tab: 'centre', ...queryToParams(q) }).toString()}`;

/**
 * The Report Centre: pick a report, a period and filters (or describe it in words and check the filters it reads), see the figures
 * with what they rest on, compare with the period before, and download them as Excel, CSV or a printed page. Saved reports rerun
 * against the data of the day they are opened.
 */
export function Centre({
  data,
  sp,
  base,
  sample = false,
  actions,
}: {
  data: CentreData;
  sp: Params;
  base: string;
  sample?: boolean;
  actions?: {
    save: (f: FormData) => Promise<void>;
    favourite: (f: FormData) => Promise<void>;
    remove: (f: FormData) => Promise<void>;
  };
}) {
  const i = data.input;
  const q = paramsToQuery(sp);
  const t = CENTRE_TEMPLATES.find((x) => x.key === q.template)!;
  const report = runReport(i, q);
  const people = Object.entries(i.people);
  const ask = (sp.ask ?? '').trim().slice(0, 200);
  const read = ask
    ? readPhrase(ask, { today: i.today, people: i.people, banks: data.banks, amcs: data.amcs })
    : null;
  const self = hrefOf(base, q);
  const lines = [
    `Period: ${report.range.label}${t.usesPeriod ? '' : ' (today’s figures)'}`,
    ...(report.applied.length ? [`Filters: ${report.applied.join('; ')}`] : []),
    `Made on ${i.today} by Family Wealth OS. ${BASIS[report.basis]}.`,
  ];
  const has = (f: (typeof t.filters)[number]) => t.filters.includes(f);
  const prevLabel = report.previous ? report.previous.label : null;

  return (
    <div className="centre" data-testid="centre">
      <section className="card centre-ask no-print" aria-labelledby="centre-ask-h">
        <h2 id="centre-ask-h">Ask in words</h2>
        <form method="get" action={base} className="centre-askform">
          <input type="hidden" name="tab" value="centre" />
          <label className="sr-only" htmlFor="centre-ask-input">
            Describe the report
          </label>
          <input
            id="centre-ask-input"
            name="ask"
            defaultValue={ask}
            placeholder="e.g. FDs maturing in the next 90 days above 5 lakh, or SIPs last FY by month"
          />
          <button className="btn" type="submit">
            Read it
          </button>
        </form>
        {read && (
          <div className="centre-read" data-testid="centre-read">
            <p className="small">
              <strong>Understood:</strong>{' '}
              {read.understood.length ? (
                read.understood.map((u) => (
                  <span key={u} className="chip">
                    {u}
                  </span>
                ))
              ) : (
                <span className="muted">
                  nothing yet; try naming a report, a person or a period.
                </span>
              )}
            </p>
            {read.unknown.length > 0 && (
              <p className="small muted" data-testid="centre-unknown">
                Not understood, so not used: {read.unknown.join(', ')}
              </p>
            )}
            <p className="small">
              Check the filters above, then{' '}
              <Link className="btn compact primary" href={hrefOf(base, read.query)}>
                Run this report
              </Link>
            </p>
          </div>
        )}
      </section>

      <nav className="centre-templates no-print" aria-label="Reports">
        {CENTRE_TEMPLATES.map((x) => (
          <Link
            key={x.key}
            href={
              x.link && !sample
                ? x.link
                : hrefOf(base, { template: x.key, period: x.defaultPeriod })
            }
            className={`chip ${x.key === t.key ? 'on' : ''}`}
            aria-current={x.key === t.key ? 'page' : undefined}
            title={x.about}
          >
            {x.label}
            {x.link ? ' ↗' : ''}
          </Link>
        ))}
      </nav>

      {!t.link && (
        <form
          method="get"
          action={base}
          className="card centre-filters no-print"
          aria-label="Filters"
        >
          <input type="hidden" name="tab" value="centre" />
          <input type="hidden" name="t" value={t.key} />
          {t.usesPeriod && (
            <label>
              Period
              <select name="period" defaultValue={q.period}>
                {PERIOD_PRESETS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          {t.usesPeriod && (
            <>
              <label>
                From (chosen dates)
                <input type="date" name="from" defaultValue={q.from ?? ''} />
              </label>
              <label>
                To (chosen dates)
                <input type="date" name="to" defaultValue={q.to ?? ''} />
              </label>
            </>
          )}
          {has('owner') && (
            <label>
              Person
              <select name="p" defaultValue={q.owner ?? ''}>
                <option value="">Everyone</option>
                {people.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has('cls') && (
            <label>
              Kind
              <select name="cls" defaultValue={q.cls ?? ''}>
                <option value="">All kinds</option>
                <option value="cash">Cash</option>
                <option value="fd">Fixed deposits</option>
                <option value="funds">Mutual funds</option>
                <option value="others">Others</option>
              </select>
            </label>
          )}
          {has('bank') && data.banks.length > 0 && (
            <label>
              Bank
              <select name="bank" defaultValue={q.bank ?? ''}>
                <option value="">All banks</option>
                {data.banks.map((b) => (
                  <option key={b}>{b}</option>
                ))}
              </select>
            </label>
          )}
          {has('currency') && (
            <label>
              Currency
              <select name="cur" defaultValue={q.currency ?? ''}>
                <option value="">All</option>
                {['INR', ...i.fx.map((f) => f.currency)].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          )}
          {has('amc') && data.amcs.length > 0 && (
            <label>
              Fund house
              <select name="amc" defaultValue={q.amc ?? ''}>
                <option value="">All</option>
                {data.amcs.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            </label>
          )}
          {has('plan') && (
            <label>
              Plan
              <select name="plan" defaultValue={q.plan ?? ''}>
                <option value="">Direct and Regular</option>
                <option value="direct">Direct</option>
                <option value="regular">Regular</option>
              </select>
            </label>
          )}
          {has('option') && (
            <label>
              Option
              <select name="opt" defaultValue={q.option ?? ''}>
                <option value="">Growth and IDCW</option>
                <option value="growth">Growth</option>
                <option value="idcw">IDCW (dividend)</option>
              </select>
            </label>
          )}
          {has('kind') && (
            <label>
              Transaction type
              <select name="kind" defaultValue={q.kind ?? ''}>
                <option value="">All types</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {kindLabel(k)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {has('amount') && (
            <>
              <label>
                Amount at least (₹)
                <input name="min" inputMode="decimal" defaultValue={q.min ?? ''} />
              </label>
              <label>
                Amount at most (₹)
                <input name="max" inputMode="decimal" defaultValue={q.max ?? ''} />
              </label>
            </>
          )}
          {has('q') && (
            <label>
              Name contains
              <input name="q" defaultValue={q.q ?? ''} />
            </label>
          )}
          {t.groups.length > 1 && (
            <label>
              Group by
              <select name="g" defaultValue={q.group ?? t.groups[0]}>
                {t.groups.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABEL[g]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {t.usesPeriod && (
            <label className="centre-check">
              <input type="checkbox" name="cmp" value="1" defaultChecked={!!q.compare} /> Compare
              with the period before
            </label>
          )}
          <div className="centre-run">
            <button className="btn primary" type="submit">
              Run report
            </button>
            <Link
              className="btn ghost"
              href={hrefOf(base, { template: t.key, period: t.defaultPeriod })}
            >
              Clear filters
            </Link>
          </div>
        </form>
      )}

      <section
        className="card centre-result"
        aria-labelledby="centre-h"
        data-testid="centre-result"
      >
        <header className="centre-head">
          <div>
            <h2 id="centre-h">{t.label}</h2>
            <p className="small muted">{t.about}</p>
            <p className="small" data-testid="centre-range">
              <strong>
                {t.usesPeriod
                  ? report.range.label
                  : `Today, ${report.range.label.replace(/^Today, /, '')}`}
              </strong>
              {prevLabel ? <span className="muted"> · compared with {prevLabel}</span> : null}
            </p>
            {report.applied.length > 0 && (
              <p className="small" data-testid="centre-applied">
                {report.applied.map((a) => (
                  <span key={a} className="chip">
                    {a}
                  </span>
                ))}
              </p>
            )}
          </div>
          <span
            className={`pill ${report.basis === 'A' ? 'ok' : 'warn'}`}
            data-testid="centre-basis"
          >
            {BASIS[report.basis]}
          </span>
        </header>

        {t.link ? (
          <p>
            {sample ? (
              <span className="muted">This report has its own page in the app.</span>
            ) : (
              <Link className="btn primary" href={t.link}>
                Open {t.label}
              </Link>
            )}
          </p>
        ) : (
          <>
            {report.kpis.length > 0 && (
              <KpiStrip
                label="Report figures"
                items={report.kpis.map((k) => ({
                  label: k.label,
                  value: kpiValue(k),
                  sub: kpiSub(k, prevLabel),
                }))}
              />
            )}
            <div className="centre-exports no-print">
              <XlsxButton
                tables={report.tables}
                lines={lines}
                fileName={`${t.key}-${report.range.from}-${report.range.to}`}
              />
              <PrintButton />
              <span className="small muted">Each table also has its own CSV download.</span>
            </div>
            {report.tables.map((table) => (
              <section key={table.id} className="centre-table" aria-label={table.title}>
                <div className="rpthead">
                  <h3>{table.title}</h3>
                  <span className="no-print">
                    <CsvButton table={table} />
                  </span>
                </div>
                {table.note && <p className="small muted">{table.note}</p>}
                {table.rows.length === 0 ? (
                  <p className="empty">Nothing matches this period and these filters.</p>
                ) : (
                  <ReportSheet table={table} />
                )}
              </section>
            ))}
          </>
        )}
        {report.notes.length > 0 && (
          <div className="centre-notes">
            <h3>What the figures rest on</h3>
            <ul className="small muted">
              {report.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <div className="centre-side no-print">
        <SavedPanel
          saved={data.saved}
          base={base}
          current={queryToParams(q)}
          title={`${t.label}, ${report.range.label}`}
          sample={sample}
          actions={actions}
        />
        <section className="card" aria-labelledby="centre-recent-h">
          <h2 id="centre-recent-h">Recently opened on this device</h2>
          <RecentList href={self} title={`${t.label} · ${report.range.label}`} />
        </section>
      </div>
    </div>
  );
}

function SavedPanel({
  saved,
  base,
  current,
  title,
  sample,
  actions,
}: {
  saved: SavedReport[];
  base: string;
  current: Record<string, string>;
  title: string;
  sample: boolean;
  actions?:
    | {
        save: (f: FormData) => Promise<void>;
        favourite: (f: FormData) => Promise<void>;
        remove: (f: FormData) => Promise<void>;
      }
    | undefined;
}) {
  const href = (p: Record<string, string>) =>
    `${base}?${new URLSearchParams({ tab: 'centre', ...p }).toString()}`;
  return (
    <section className="card" aria-labelledby="centre-saved-h" data-testid="centre-saved">
      <h2 id="centre-saved-h">Saved reports</h2>
      {saved.length === 0 ? (
        <p className="muted small">
          No saved report yet. A saved report keeps its settings and shows that day’s figures each
          time.
        </p>
      ) : (
        <ul className="list small">
          {saved.map((s) => (
            <li key={s.id} className="listlink">
              <span>
                {s.favourite ? <span aria-label="Favourite">★ </span> : null}
                <Link href={href(s.params)}>{s.name}</Link>
              </span>
              {actions && (
                <span className="centre-saved-acts">
                  <form action={actions.favourite}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn compact ghost" type="submit">
                      {s.favourite ? 'Unstar' : 'Star'}
                    </button>
                  </form>
                  <form action={actions.remove}>
                    <input type="hidden" name="id" value={s.id} />
                    <button className="btn compact ghost" type="submit">
                      Remove
                    </button>
                  </form>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {sample || !actions ? (
        <p className="small muted">Saving is available in your own app.</p>
      ) : (
        <form action={actions.save} className="centre-saveform">
          <input type="hidden" name="params" value={JSON.stringify(current)} />
          <label className="sr-only" htmlFor="centre-save-name">
            Name for this report
          </label>
          <input id="centre-save-name" name="name" defaultValue={title} maxLength={80} required />
          <button className="btn compact" type="submit">
            Save this report
          </button>
        </form>
      )}
    </section>
  );
}
