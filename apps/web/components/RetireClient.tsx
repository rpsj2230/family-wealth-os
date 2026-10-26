'use client';

import { useMemo, useState, useTransition } from 'react';
import {
  ageOn,
  assess,
  buildPlan,
  earliestRetirementAge,
  formatInr,
  formatInrCompact,
  type Holdings,
  type Lever,
  levers,
  monteCarlo,
  type MonteCarloResult,
  type PlanSettings,
  SCENARIOS,
} from '@fwos/core';
import { Tabs } from '@/components/Tabs';
import '@/app/(app)/retire/retire.css';

export interface RetireProps {
  initial: PlanSettings;
  holdings: Holdings;
  sipMonthly: number;
  asOf: string;
  /** share of the corpus (0..1) that rests on carried-forward or assumed values */
  softShare: number;
  sample?: boolean;
  /** which tab is open (from the address) and the page address the tabs link to */
  tab?: string | undefined;
  base?: string;
  save?: (s: PlanSettings) => Promise<{ ok: boolean; message: string }>;
}

const STATUS: Record<string, { text: string; cls: string }> = {
  meets_plan: { text: 'Projected to meet the plan under these assumptions', cls: 'ok' },
  shortfall: { text: 'Projected shortfall under these assumptions', cls: 'warn' },
  insufficient_data: { text: 'Insufficient data to assess', cls: 'warn' },
};

const pct = (x: number) => (x * 100).toFixed(1).replace(/\.0$/, '');
/** an age in years: 55 or 55.5 */
const yr = (x: number) => x.toFixed(1).replace(/\.0$/, '');
const parse = (s: string) => {
  const n = Number(s.replace(/[₹,\s]/g, ''));
  return s.trim() !== '' && Number.isFinite(n) ? n : NaN;
};

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  hint?: string;
  type?: string;
  min?: string;
  max?: string;
  step?: string;
}) {
  return (
    <label>
      {props.label}
      <span className="inputwrap">
        <input
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          inputMode={props.type === 'date' ? undefined : 'decimal'}
          type={props.type ?? 'text'}
          min={props.min}
          max={props.max}
          step={props.step}
        />
        {props.suffix && <span className="muted small suffix">{props.suffix}</span>}
      </span>
      {props.hint && <span className="muted small">{props.hint}</span>}
    </label>
  );
}

export function RetireClient({
  initial,
  holdings,
  sipMonthly,
  asOf,
  softShare,
  sample,
  tab: tabIn,
  base = '/retire',
  save,
}: RetireProps) {
  const tab = ['inputs', 'compare', 'range', 'notes'].includes(tabIn ?? '') ? tabIn! : 'inputs';
  const [s, setS] = useState<PlanSettings>(initial);
  const [text, setText] = useState({
    spending: initial.monthlySpendingToday ? String(initial.monthlySpendingToday) : '',
    extraEq: String(initial.extraMonthlyEquity),
    extraCash: String(initial.extraMonthlyCash),
    legacy: String(initial.legacyToday),
  });
  const [leverRows, setLeverRows] = useState<Lever[] | null>(null);
  const [mc, setMc] = useState<MonteCarloResult | null>(null);
  const [busy, startBusy] = useTransition();
  const [calc, setCalc] = useState<'levers' | 'mc' | null>(null);
  /** run a heavy calculation after the browser has painted the "working" state */
  const later = (which: 'levers' | 'mc', fn: () => void) => {
    setCalc(which);
    setTimeout(() => {
      fn();
      setCalc(null);
    }, 30);
  };
  const [saved, setSaved] = useState<string | null>(null);

  const set = (patch: Partial<PlanSettings>) => {
    setS((x) => ({ ...x, ...patch }));
    setLeverRows(null);
    setMc(null);
    setSaved(null);
  };
  const setA = (patch: Partial<PlanSettings['assumptions']>) =>
    set({ assumptions: { ...s.assumptions, ...patch }, scenario: s.scenario });

  const plan = useMemo(
    () => buildPlan(s, holdings, sipMonthly, asOf),
    [s, holdings, sipMonthly, asOf],
  );
  const dobOk = /^\d{4}-\d{2}-\d{2}$/.test(s.primaryDob);
  const result = useMemo(() => assess(plan, s.assumptions), [plan, s.assumptions]);
  const byScenario = useMemo(
    () =>
      (['conservative', 'base', 'optimistic'] as const).map((k) => ({
        k,
        r: assess(plan, { ...SCENARIOS[k], ...(k === s.scenario ? s.assumptions : {}) }),
      })),
    [plan, s.assumptions, s.scenario],
  );
  const ages = useMemo(
    () => (dobOk ? earliestRetirementAge(plan, s.assumptions) : { earliest: null, table: [] }),
    [plan, s.assumptions, dobOk],
  );

  const st = STATUS[result.status]!;
  const ageNow = dobOk ? ageOn(s.primaryDob, asOf) : null;
  const corpus = holdings.cash + holdings.equity + holdings.locked;

  return (
    <div>
      {sample && (
        <p className="notice warn">
          These are sample numbers to show how the page works. They are not your data.
        </p>
      )}

      <section className={`card hero status-${st.cls}`} aria-live="polite">
        <p className="small muted">
          Valuation date {asOf} · scenario: {s.scenario} · all amounts in today&apos;s rupees unless
          marked &quot;future&quot;
        </p>
        <h2 className="statusline">{st.text}</h2>
        {result.status === 'insufficient_data' ? (
          <div>
            <p>To give you an answer I still need:</p>
            <ul className="list">
              {result.missing.map((m) => (
                <li key={m}>{m}</li>
              ))}
            </ul>
            <p className="muted small">
              I will not show a verdict when essential information is missing.
            </p>
          </div>
        ) : (
          <div className="kpis" style={{ margin: '10px 0' }}>
            <div className="kpi main">
              <div className="kpi-label">
                Projected corpus at {yr(result.retireAtAge)} (today&apos;s ₹)
              </div>
              <div className="kpi-value">{formatInrCompact(result.projectedAccessibleReal)}</div>
              <div className="kpi-sub muted">
                ≈ {formatInrCompact(result.projectedAccessible)} in future rupees
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Corpus needed (today&apos;s ₹)</div>
              <div className="kpi-value">
                {result.requiredAccessibleReal === null
                  ? 'Not reachable'
                  : formatInrCompact(result.requiredAccessibleReal)}
              </div>
              <div className="kpi-sub muted">
                {result.requiredAccessible === null
                  ? ''
                  : `≈ ${formatInrCompact(result.requiredAccessible)} in future rupees`}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">
                {result.surplusReal !== null && result.surplusReal < 0 ? 'Shortfall' : 'Surplus'}{' '}
                (today&apos;s ₹)
              </div>
              <div
                className={`kpi-value ${result.surplusReal !== null && result.surplusReal < 0 ? 'fail' : ''}`}
              >
                {result.surplusReal === null ? '—' : formatInrCompact(Math.abs(result.surplusReal))}
              </div>
            </div>
            <div className="kpi">
              <div className="kpi-label">Earliest age that meets the plan</div>
              <div className="kpi-value">
                {ages.earliest === null
                  ? dobOk
                    ? 'None up to 70'
                    : 'Enter date of birth'
                  : `${yr(ages.earliest)}${ageNow !== null && ages.earliest <= ageNow + 0.01 ? ' (now)' : ''}`}
              </div>
              <div className="kpi-sub muted">
                Spending assumed ₹{formatInr(s.monthlySpendingToday, { symbol: false })}/month
                (today&apos;s ₹)
              </div>
            </div>
          </div>
        )}
        <div className="chips">
          <span className="chip">
            Data quality: {softShare <= 0.1 ? 'good' : softShare <= 0.4 ? 'fair' : 'low'} (
            {pct(softShare)}% of the corpus rests on carried-forward or assumed values)
          </span>
          <span className="chip">
            {ages.earliest !== null || result.status === 'insufficient_data'
              ? 'Estimate, not a guarantee'
              : 'Not met within the tested ages'}
          </span>
        </div>
      </section>

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'inputs', label: 'Your inputs' },
          { key: 'compare', label: 'Compare' },
          { key: 'range', label: 'Range of outcomes' },
          { key: 'notes', label: 'Corpus and method' },
        ]}
      />

      {tab === 'inputs' && (
        <>
          <section className="card" aria-labelledby="ctl">
            <h2 id="ctl">About you</h2>
            <p className="muted small">
              Nothing here changes your records. Adjust and watch the answer above move, then save
              if you want to keep these assumptions.
            </p>
            <div className="formgrid">
              <Field
                label="Your date of birth"
                type="date"
                value={s.primaryDob}
                onChange={(v) => set({ primaryDob: v })}
              />
              <Field
                label="Spouse's date of birth"
                type="date"
                value={s.spouseDob}
                onChange={(v) => set({ spouseDob: v })}
                hint="The plan runs until the younger of you reaches the planning age."
              />
              <Field
                label="Retire at age"
                suffix="years"
                value={String(s.retireAtAge)}
                onChange={(v) => set({ retireAtAge: parse(v) || 0 })}
              />
              <Field
                label="Plan until the younger of you is"
                suffix="years"
                value={String(s.planningEndAge)}
                onChange={(v) => set({ planningEndAge: parse(v) || 0 })}
              />
            </div>
          </section>

          <section className="card" aria-labelledby="spend">
            <h2 id="spend">Spending and saving</h2>
            <div className="formgrid">
              <Field
                label="Monthly spending after retirement (today's ₹)"
                value={text.spending}
                onChange={(v) => {
                  setText({ ...text, spending: v });
                  const n = parse(v);
                  set({ monthlySpendingToday: Number.isFinite(n) && n >= 0 ? n : 0 });
                }}
                hint="Required. Include everything you expect to spend in India."
              />
              <Field
                label="Share of spending that is healthcare"
                suffix="%"
                value={pct(s.healthcareShare)}
                onChange={(v) =>
                  set({ healthcareShare: Math.min(1, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
              <Field
                label={`Extra investing per month beyond current SIPs (SIPs today: ${formatInr(sipMonthly)})`}
                value={text.extraEq}
                onChange={(v) => {
                  setText({ ...text, extraEq: v });
                  const n = parse(v);
                  set({ extraMonthlyEquity: Number.isFinite(n) && n >= 0 ? n : 0 });
                }}
              />
              <Field
                label="Savings into FDs/cash per month"
                value={text.extraCash}
                onChange={(v) => {
                  setText({ ...text, extraCash: v });
                  const n = parse(v);
                  set({ extraMonthlyCash: Number.isFinite(n) && n >= 0 ? n : 0 });
                }}
              />
              <Field
                label="Raise investing every year by"
                suffix="%"
                value={pct(s.annualStepUp)}
                onChange={(v) =>
                  set({ annualStepUp: Math.min(0.5, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
              <Field
                label="Tax lost on withdrawals"
                suffix="%"
                value={pct(s.withdrawalTaxRate)}
                onChange={(v) =>
                  set({ withdrawalTaxRate: Math.min(0.5, Math.max(0, (parse(v) || 0) / 100)) })
                }
                hint="0 means tax is not modelled."
              />
              <Field
                label="Keep for heirs (today's ₹)"
                value={text.legacy}
                onChange={(v) => {
                  setText({ ...text, legacy: v });
                  const n = parse(v);
                  set({ legacyToday: Number.isFinite(n) && n >= 0 ? n : 0 });
                }}
              />
              <Field
                label="Equity share at retirement"
                suffix="%"
                value={pct(s.retirementEquityShare)}
                onChange={(v) =>
                  set({ retirementEquityShare: Math.min(1, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
            </div>
          </section>

          <section className="card" aria-labelledby="mkt">
            <h2 id="mkt">Market and inflation assumptions</h2>
            <div className="row" role="group" aria-label="Scenario">
              {(['conservative', 'base', 'optimistic'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`btn compact ${s.scenario === k ? 'primary' : ''}`}
                  aria-pressed={s.scenario === k}
                  onClick={() => {
                    setS((x) => ({ ...x, scenario: k, assumptions: SCENARIOS[k] }));
                    setLeverRows(null);
                    setMc(null);
                  }}
                >
                  {k[0]!.toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <div className="formgrid">
              <Field
                label="Equity return a year"
                suffix="%"
                value={pct(s.assumptions.equityReturn)}
                onChange={(v) =>
                  setA({ equityReturn: Math.min(0.3, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
              <Field
                label="FD / cash return a year"
                suffix="%"
                value={pct(s.assumptions.cashReturn)}
                onChange={(v) =>
                  setA({ cashReturn: Math.min(0.2, Math.max(0, (parse(v) || 0) / 100)) })
                }
                hint="FDs are not assumed to renew at today's rates."
              />
              <Field
                label="Inflation a year"
                suffix="%"
                value={pct(s.assumptions.inflation)}
                onChange={(v) =>
                  setA({ inflation: Math.min(0.25, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
              <Field
                label="Healthcare inflation a year"
                suffix="%"
                value={pct(s.assumptions.healthcareInflation)}
                onChange={(v) =>
                  setA({ healthcareInflation: Math.min(0.3, Math.max(0, (parse(v) || 0) / 100)) })
                }
              />
            </div>
            <p className="muted small">
              Past returns are not a promise of future returns. These are assumptions you can
              change, not forecasts.
            </p>

            <div className="row">
              {save && (
                <button
                  className="btn primary"
                  disabled={busy}
                  onClick={() =>
                    startBusy(async () => {
                      const r = await save(s);
                      setSaved(r.message);
                    })
                  }
                >
                  Save these assumptions
                </button>
              )}
              {saved && (
                <span className="notice ok" role="status">
                  {saved}
                </span>
              )}
            </div>
          </section>
        </>
      )}

      {tab === 'compare' && (
        <>
          <section className="card" aria-labelledby="scen">
            <h2 id="scen">Three scenarios side by side</h2>
            <table className="tbl responsive">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="num">Projected (today&apos;s ₹)</th>
                  <th className="num">Needed (today&apos;s ₹)</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {byScenario.map(({ k, r }) => (
                  <tr key={k}>
                    <td data-label="Scenario">{k[0]!.toUpperCase() + k.slice(1)}</td>
                    <td className="num" data-label="Projected">
                      {formatInrCompact(r.projectedAccessibleReal)}
                    </td>
                    <td className="num" data-label="Needed">
                      {r.requiredAccessibleReal === null
                        ? '—'
                        : formatInrCompact(r.requiredAccessibleReal)}
                    </td>
                    <td data-label="Result">
                      {STATUS[r.status]!.text.replace(' under these assumptions', '')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card" aria-labelledby="ages">
            <h2 id="ages">Compare retirement ages</h2>
            {ages.table.length === 0 ? (
              <p className="muted">Enter your date of birth and spending to compare ages.</p>
            ) : (
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>Retire at</th>
                    <th className="num">Projected</th>
                    <th className="num">Needed</th>
                    <th className="num">Surplus / shortfall</th>
                  </tr>
                </thead>
                <tbody>
                  {ages.table.map((r) => (
                    <tr key={r.age}>
                      <td data-label="Retire at">
                        {yr(r.age)}
                        {ageNow !== null && Math.abs(r.age - ageNow) < 0.01 ? ' (now)' : ''}
                      </td>
                      <td className="num" data-label="Projected">
                        {formatInrCompact(r.projectedReal)}
                      </td>
                      <td className="num" data-label="Needed">
                        {r.requiredReal === null ? '—' : formatInrCompact(r.requiredReal)}
                      </td>
                      <td
                        className={`num ${r.surplusReal !== null && r.surplusReal < 0 ? 'fail' : ''}`}
                        data-label="Surplus / shortfall"
                      >
                        {r.surplusReal === null
                          ? '—'
                          : (r.surplusReal < 0 ? '−' : '+') +
                            formatInrCompact(Math.abs(r.surplusReal))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          <section className="card" aria-labelledby="help">
            <h2 id="help">What could change the answer</h2>
            {leverRows === null ? (
              <button
                className="btn"
                disabled={calc !== null || result.status === 'insufficient_data'}
                onClick={() => later('levers', () => setLeverRows(levers(plan, s.assumptions)))}
              >
                {calc === 'levers' ? 'Calculating…' : 'Show the effect of common changes'}
              </button>
            ) : (
              <table className="tbl responsive">
                <thead>
                  <tr>
                    <th>Change</th>
                    <th className="num">Earliest age</th>
                    <th className="num">At age {yr(s.retireAtAge)}</th>
                  </tr>
                </thead>
                <tbody>
                  {leverRows.map((l) => (
                    <tr key={l.label}>
                      <td data-label="Change">{l.label}</td>
                      <td className="num" data-label="Earliest age">
                        {l.earliestAge === null ? 'None up to 70' : yr(l.earliestAge)}
                      </td>
                      <td className="num" data-label={`At age ${yr(s.retireAtAge)}`}>
                        {l.surplusRealAtChosenAge === null
                          ? '—'
                          : (l.surplusRealAtChosenAge < 0 ? 'short ' : 'surplus ') +
                            formatInrCompact(Math.abs(l.surplusRealAtChosenAge))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      {tab === 'range' && (
        <>
          <section className="card" aria-labelledby="mc">
            <h2 id="mc">Range of outcomes</h2>
            <p className="muted small">
              Runs 2,000 possible market and inflation paths (the same seed gives the same answer).
              It shows how uncertain the result is; it is not a prediction.
            </p>
            <button
              className="btn"
              disabled={calc !== null || result.status === 'insufficient_data'}
              onClick={() =>
                later('mc', () => setMc(monteCarlo(plan, s.assumptions, 2000, 20261026)))
              }
            >
              {calc === 'mc' ? 'Simulating…' : 'Run the simulation'}
            </button>
            {mc && (
              <div>
                <p className="big2">
                  {Math.round(mc.successRate * 100)}% of paths last the whole plan
                </p>
                <p>
                  Money left at the end (today&apos;s ₹): bad luck (10th percentile){' '}
                  <strong>{formatInrCompact(mc.finalRealPercentiles.p10)}</strong> · middle{' '}
                  <strong>{formatInrCompact(mc.finalRealPercentiles.p50)}</strong> · good luck
                  (90th) <strong>{formatInrCompact(mc.finalRealPercentiles.p90)}</strong>
                </p>
                <p className="muted small">
                  Corpus at retirement (today&apos;s ₹):{' '}
                  {formatInrCompact(mc.corpusAtRetirementRealPercentiles.p10)} –{' '}
                  {formatInrCompact(mc.corpusAtRetirementRealPercentiles.p90)} (10th to 90th
                  percentile).
                </p>
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'notes' && (
        <>
          <section className="card" aria-labelledby="what">
            <h2 id="what">What counts as your corpus</h2>
            <table className="tbl">
              <tbody>
                <tr>
                  <th scope="row">Cash, bank balances and FDs</th>
                  <td className="num">{formatInr(holdings.cash)}</td>
                </tr>
                <tr>
                  <th scope="row">Mutual funds and stocks</th>
                  <td className="num">{formatInr(holdings.equity)}</td>
                </tr>
                <tr>
                  <th scope="row">Locked until age 60 (ULIP / NPS)</th>
                  <td className="num">{formatInr(holdings.locked)}</td>
                </tr>
                <tr className="sum">
                  <th scope="row">Available to fund retirement</th>
                  <td className="num">{formatInr(corpus)}</td>
                </tr>
                {holdings.excluded.map((e) => (
                  <tr key={e.label}>
                    <th scope="row" className="muted">
                      Not counted: {e.label}
                    </th>
                    <td className="num muted">{formatInr(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">
              Insurance cover is never counted. Property, money lent and money held by others are
              left out unless you sell or collect them.
            </p>
          </section>

          <section className="card">
            <h2>How this is calculated</h2>
            <ul className="list small">
              <li>
                Month-by-month cash flow from today to the day the younger of you reaches the
                planning age. Not a 25× rule and not a fixed 4% rule.
              </li>
              <li>
                Spending, one-off costs and pensions are entered in today&apos;s rupees and inflated
                each month. Healthcare inflates faster than other spending.
              </li>
              <li>
                Until retirement your SIPs and extra investing grow with the stated returns. At
                retirement the accessible assets are rebalanced to the equity share above;
                withdrawals come from cash, then equity, then locked assets once unlocked.
              </li>
              <li>
                &ldquo;Corpus needed&rdquo; is the smallest accessible corpus at retirement that
                keeps the plan alive to the end (and leaves the amount for heirs). It changes with
                every assumption.
              </li>
              <li>
                Property, money lent to others, and money held in other people&apos;s accounts are
                not counted as spendable. Insurance cover is never wealth.
              </li>
              <li>
                Taxes on withdrawals are only included if you enter a rate. Currency effects are
                ignored because spending is in India in rupees.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
