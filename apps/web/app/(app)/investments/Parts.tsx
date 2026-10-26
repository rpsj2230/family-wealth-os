import Link from 'next/link';
import { formatInr, formatInrCompact, type PersonStyle } from '@fwos/core';
import { ActionForm, type ActionResult } from '@/components/ActionForm';
import { UpdatedCell } from '@/components/BankTable';
import { BarList, Sparkline } from '@/components/charts';
import { FundChart } from '@/components/FundChart';
import { GoalTag } from '@/components/GoalTag';
import { InvestHeadline, pct, rupees, tone } from '@/components/InvestHeadline';
import { KpiStrip } from '@/components/KpiStrip';
import { Meter } from '@/components/Meter';
import { PersonBadge } from '@/components/Person';
import { niceDate, niceMonth } from '@/lib/dates';
import type { InvestmentView, FundRow, fundPace } from '@/lib/investments';
import type { MatchRow } from '@/lib/match-data';
import { exitLoadPercentText, matchProgress, orderForMatching } from '@/lib/match-funds';
import './investments.css';

type Act = (prev: ActionResult | null, f: FormData) => Promise<ActionResult>;

export interface MatchActions {
  confirmMatch: Act;
  clearMatch: Act;
  setExitLoad: Act;
}

const rupee = (n: number) => formatInr(Math.round(n));

export function InvestKpis({
  view,
  noPrice,
  title,
}: {
  view: InvestmentView;
  noPrice: number;
  title?: string;
}) {
  const h = view.household;
  const running = view.groups.flatMap((g) => g.funds).filter((f) => f.sipMonthly && !f.sipStopped);
  return (
    <KpiStrip
      label={title ?? 'Mutual funds at a glance'}
      items={[
        {
          label: 'Value now',
          value: formatInrCompact(h.value),
          sub: `${rupee(h.value)} · ${formatInrCompact(h.invested)} put in`,
          main: true,
        },
        {
          label: 'Today',
          value: h.dayPct === null ? '–' : rupees(h.dayAmount),
          sub: h.dayPct === null ? 'no price change yet' : pct(h.dayPct),
          tone: h.dayPct === null ? undefined : h.dayAmount >= 0 ? 'gain' : 'fail',
        },
        {
          label: 'Total gain',
          value: rupees(h.gain),
          sub:
            h.xirr === null
              ? 'annual return not available'
              : `${pct(h.xirr, 1)} a year (XIRR)${h.xirrEstimated ? ', estimated' : ''}`,
          tone: h.gain >= 0 ? 'gain' : 'fail',
        },
        {
          label: 'SIP a month',
          value: formatInrCompact(h.sipMonthly),
          sub: `${running.length} fund${running.length === 1 ? '' : 's'} with a running SIP`,
        },
        {
          label: 'Without a live price',
          value: noPrice,
          sub: noPrice > 0 ? 'match them to follow the market' : 'every fund follows its price',
          tone: noPrice > 0 ? 'warn' : undefined,
          href: '/investments?tab=match',
        },
      ]}
    />
  );
}

/* ------------------------------------------------------------------------------------------- funds */

function FundRowView({ f, view }: { f: FundRow; view: InvestmentView }) {
  const goalName = new Map(view.goals.map((g) => [g.id, g.name]));
  return (
    <tr>
      <td data-label="Fund">
        <div className="fundcell">
          <div>
            <Link href={`/asset/${f.assetId}`} className="fundlink">
              {f.name}
            </Link>
            <div className="small muted">
              {f.units !== null && f.nav !== null
                ? `${f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units × ₹${f.nav.toLocaleString(
                    'en-IN',
                    { minimumFractionDigits: 2, maximumFractionDigits: 4 },
                  )}`
                : f.units !== null
                  ? `${f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`
                  : 'units not recorded'}
            </div>
            <div className="small muted">
              {f.startedOn ? `since ${niceMonth(f.startedOn)}` : ''}
              {f.dayTo ? ` · price of ${niceDate(f.dayTo)}` : ''}
              {!f.amfiCode && (
                <>
                  {f.startedOn || f.dayTo ? ' · ' : ''}
                  <Link href="/investments?tab=match">no live price: match it</Link>
                </>
              )}
            </div>
          </div>
          <span className="fundspark">
            <Sparkline points={f.history.map((x) => x.value)} label={`${f.name} value`} />
          </span>
        </div>
      </td>
      <td data-label="Goal">
        <GoalTag assetId={f.assetId} goals={view.goals} current={f.goalIds} fundName={f.name} />
        {f.goalIds.length === 1 && <span className="sr-only">{goalName.get(f.goalIds[0]!)}</span>}
      </td>
      <td className="num" data-label="Invested">
        {f.invested ? rupee(f.invested) : '–'}
      </td>
      <td className="num amount" data-label="Value today">
        {f.value ? rupee(f.value) : '–'}
        <div className="small muted">{f.valueBasis}</div>
      </td>
      <td className={`num ${tone(f.dayAmount)}`} data-label="Today">
        {f.dayAmount === null ? '–' : rupees(f.dayAmount)}
        {f.dayPct !== null && <div className="small">{pct(f.dayPct)}</div>}
      </td>
      <td className={`num ${f.invested ? tone(f.gain) : ''}`} data-label="Gain">
        {f.invested ? rupees(f.gain) : '–'}
      </td>
      <td className={`num ${tone(f.xirr)}`} data-label="XIRR">
        {f.xirr === null ? '–' : pct(f.xirr, 1)}
        {f.xirr !== null && f.xirrEstimated && (
          <span
            className="muted"
            title="Estimated from the start date and SIP; exact once the fund statement is imported"
          >
            {' '}
            ~
          </span>
        )}
      </td>
      <td className="num" data-label="SIP">
        {f.sipMonthly ? (
          f.sipStopped ? (
            <span className="muted">stopped</span>
          ) : (
            formatInr(f.sipMonthly)
          )
        ) : (
          '–'
        )}
      </td>
      <td className="upd" data-label="Updated">
        <UpdatedCell asOf={f.updatedOn} source={f.updatedSource} />
      </td>
    </tr>
  );
}

/** A card per person (PAN holder) with a row per fund. */
export function FundsTab({
  view,
  styles,
}: {
  view: InvestmentView;
  styles: Record<string, PersonStyle>;
}) {
  if (view.groups.length === 0)
    return (
      <p className="empty">
        No mutual funds yet. Import your workbook or a fund statement on the{' '}
        <Link href="/import">Import page</Link>.
      </p>
    );
  return (
    <>
      {view.groups.map((g) => (
        <section
          className="card bank personcard"
          key={g.ownerId}
          style={{ ['--person' as string]: styles[g.ownerId]?.colour }}
        >
          <header className="bankhead personhead">
            <div>
              <h2>
                <PersonBadge p={styles[g.ownerId]} name size={26} />{' '}
                <span className="panlabel">
                  PAN
                  {g.panLast4 ? <span className="muted"> ••••{g.panLast4}</span> : ' not saved'}
                </span>
              </h2>
              <div className="muted small">
                {g.totals.funds} fund{g.totals.funds === 1 ? '' : 's'}
              </div>
            </div>
            <InvestHeadline t={g.totals} />
          </header>
          <table className="tbl lines responsive funds">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Goal</th>
                <th className="num">Invested</th>
                <th className="num">Value today</th>
                <th className="num">Today</th>
                <th className="num">Gain</th>
                <th className="num">XIRR</th>
                <th className="num">SIP</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {g.funds.map((f) => (
                <FundRowView key={f.assetId} f={f} view={view} />
              ))}
            </tbody>
          </table>
        </section>
      ))}
      {view.household.xirrEstimated && (
        <p className="muted small">
          XIRR marked with ~ is estimated from each fund&apos;s start date and SIP until its fund
          statement is imported (<Link href="/import">Import</Link>).
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------ growth */

export function GrowthTab({
  view,
  pace,
  who,
  styles,
}: {
  view: InvestmentView;
  pace: ReturnType<typeof fundPace>;
  who: string | null;
  styles: Record<string, PersonStyle>;
}) {
  const h = view.household;
  return (
    <>
      <section className="card" aria-labelledby="gr">
        <div className="cardhead">
          <h2 id="gr">{who ? `${styles[who]?.name}'s funds` : 'All funds'} over time</h2>
          <span className="small muted">Value against the money put in</span>
        </div>
        <FundChart
          history={view.series}
          today={view.today}
          caption="Value of all mutual funds against the money put in"
          projection={pace.path}
        />
      </section>
      <section className="card pace" aria-labelledby="pc">
        <div className="cardhead">
          <h2 id="pc">If you carry on like this</h2>
          <span className="small muted">Arithmetic, not a promise</span>
        </div>
        <p className="muted small">
          {formatInr(Math.round(h.sipMonthly))} a month in SIPs and {(pace.rate * 100).toFixed(1)}%
          a year ({h.xirr === null ? 'assumed' : 'your return so far'}), with a range of ±3 points.
        </p>
        <div className="pacegrid">
          {pace.projections.map((x) => (
            <div key={x.years} className="pacecell">
              <div className="muted small">
                In {x.years} year{x.years === 1 ? '' : 's'}
              </div>
              <b className="num">{formatInr(x.expected)}</b>
              <div className="muted small">
                {formatInr(x.low)} – {formatInr(x.high)}
              </div>
            </div>
          ))}
        </div>
      </section>
      {!who && view.groups.length > 1 && (
        <section className="card" aria-labelledby="share">
          <div className="cardhead">
            <h2 id="share">Who holds what</h2>
          </div>
          <BarList
            caption="Value of mutual funds by person"
            format={formatInrCompact}
            items={view.groups.map((g) => ({
              label: <PersonBadge p={styles[g.ownerId]} name size={18} />,
              value: g.totals.value,
              colour: styles[g.ownerId]?.colour ?? 'var(--primary, #4f46e5)',
              sub: `${rupees(g.totals.gain)} gain${g.totals.xirr === null ? '' : ` · ${pct(g.totals.xirr, 1)} a year`}`,
            }))}
          />
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------------------------------ match */

function ExitLoadForm({ r, action }: { r: MatchRow; action: Act }) {
  return (
    <ActionForm action={action} submit="Save" className="exitform" keepAfterSave busy="…">
      <input type="hidden" name="asset" value={r.assetId} />
      <input
        className="mini"
        name="pct"
        inputMode="decimal"
        placeholder="default"
        defaultValue={exitLoadPercentText(r.exitLoadFraction)}
        aria-label={`Exit load percent for ${r.name}`}
      />
      <span className="muted small">% for</span>
      <input
        className="mini"
        name="days"
        inputMode="numeric"
        placeholder="days"
        defaultValue={r.exitLoadDays === null ? '' : String(r.exitLoadDays)}
        aria-label={`Exit load days for ${r.name}`}
      />
    </ActionForm>
  );
}

function FundCell({ r }: { r: MatchRow }) {
  return (
    <>
      <Link href={`/asset/${r.assetId}`}>
        <strong>{r.name}</strong>
      </Link>
      <div className="muted small">
        {r.ownerName} ·{' '}
        {r.sipStopped
          ? 'SIP stopped'
          : r.sipMonthly
            ? `SIP ${formatInr(r.sipMonthly)}/month`
            : 'no SIP'}
        {r.navHint ? ` · sheet note NAV ${r.navHint}` : ''}
      </div>
    </>
  );
}

function LastValue({ r }: { r: MatchRow }) {
  return (
    <>
      {r.lastValue ? rupee(r.lastValue.amount) : '–'}
      <div className="muted small">{r.lastValue ? niceDate(r.lastValue.asOf) : ''}</div>
    </>
  );
}

/** Tie each fund to the official scheme once, so its price follows the market every day. */
export function MatchTab({
  rows,
  haveList,
  actions,
}: {
  rows: MatchRow[];
  haveList: boolean;
  actions: MatchActions;
}) {
  const ordered = orderForMatching(rows);
  const progress = matchProgress(rows);
  const todo = ordered.filter((r) => !r.amfiCode);
  const done = ordered.filter((r) => r.amfiCode);
  return (
    <>
      <p className="lead muted">
        To move each fund with the market, the portal needs to know which official scheme it is.
        Check the suggested scheme (name, Direct or Regular) and confirm it once. Until then a
        fund&apos;s value is only what you last recorded.
      </p>
      {!haveList && (
        <p className="notice warn">
          The official scheme list has not been loaded yet. It is fetched by the daily market-data
          job (GitHub, Actions, &ldquo;Refresh market data&rdquo;); this tab fills in after its
          first run.
        </p>
      )}
      {rows.length > 0 && (
        <section className="card" aria-label="Matching progress">
          <Meter
            total={progress.total}
            format={(n) => `${n} fund${n === 1 ? '' : 's'}`}
            parts={[
              { label: 'Matched', value: progress.matched, colour: 'var(--primary, #4f46e5)' },
              { label: 'To check', value: progress.pending, colour: '#d1d5db' },
            ]}
          />
        </section>
      )}

      {todo.length > 0 && (
        <section className="card" aria-labelledby="todo">
          <div className="cardhead">
            <h2 id="todo">To check ({todo.length})</h2>
            <span className="small muted">Funds that do not yet follow a daily price</span>
          </div>
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Your fund</th>
                <th className="num">Last value</th>
                <th>Suggested scheme</th>
                <th>Exit load</th>
              </tr>
            </thead>
            <tbody>
              {todo.map((r) => (
                <tr key={r.assetId} className={r.sipStopped ? 'dim' : ''}>
                  <td data-label="Your fund">
                    <FundCell r={r} />
                  </td>
                  <td className="num" data-label="Last value">
                    <LastValue r={r} />
                  </td>
                  <td data-label="Suggested scheme">
                    {r.candidates.length > 0 ? (
                      <ul className="list nobullet">
                        {r.candidates.map((c, i) => (
                          <li key={c.code}>
                            <ActionForm
                              action={actions.confirmMatch}
                              submit={r.confident && i === 0 ? 'Confirm' : 'Use this'}
                              className="taskrow"
                              primary={r.confident && i === 0}
                              busy="…"
                            >
                              <input type="hidden" name="asset" value={r.assetId} />
                              <input type="hidden" name="code" value={c.code} />
                              <span>
                                {c.name}{' '}
                                <span className="muted small">
                                  ({c.plan}, {c.amc})
                                </span>
                                {c.navGap !== null ? (
                                  <span className="muted small">
                                    {' '}
                                    · price differs {(c.navGap * 100).toFixed(0)}% from your note
                                  </span>
                                ) : null}
                              </span>
                            </ActionForm>
                          </li>
                        ))}
                      </ul>
                    ) : haveList ? (
                      <span className="muted">
                        No automatic match. This fund&apos;s name may not match the official list;
                        leave it for now. You can still update it by hand under Update funds.
                      </span>
                    ) : (
                      <span className="muted">Waiting for the scheme list</span>
                    )}
                  </td>
                  <td data-label="Exit load">
                    <ExitLoadForm r={r} action={actions.setExitLoad} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {done.length > 0 && (
        <section className="card" aria-labelledby="done">
          <div className="cardhead">
            <h2 id="done">Matched ({done.length})</h2>
            <span className="small muted">
              Exit load is optional: leave it empty to use the default in Settings.
            </span>
          </div>
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Your fund</th>
                <th className="num">Last value</th>
                <th>Scheme</th>
                <th>Exit load</th>
              </tr>
            </thead>
            <tbody>
              {done.map((r) => (
                <tr key={r.assetId} className={r.sipStopped ? 'dim' : ''}>
                  <td data-label="Your fund">
                    <FundCell r={r} />
                  </td>
                  <td className="num" data-label="Last value">
                    <LastValue r={r} />
                  </td>
                  <td data-label="Scheme">
                    <ActionForm
                      action={actions.clearMatch}
                      submit="Change"
                      className="taskrow"
                      busy="…"
                    >
                      <input type="hidden" name="asset" value={r.assetId} />
                      <span>Confirmed: scheme {r.amfiCode}</span>
                    </ActionForm>
                  </td>
                  <td data-label="Exit load">
                    <ExitLoadForm r={r} action={actions.setExitLoad} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {rows.length === 0 && (
        <p className="empty">
          No mutual funds to match yet. Import your workbook or a fund statement on the{' '}
          <Link href="/import">Import page</Link>.
        </p>
      )}
    </>
  );
}
