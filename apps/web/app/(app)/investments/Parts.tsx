import Link from 'next/link';
import {
  avgCostPerUnit,
  formatInr,
  formatInrCompact,
  type PersonStyle,
  type StatBlock,
} from '@fwos/core';
import { ActionForm, type ActionResult } from '@/components/ActionForm';
import { UpdatedCell } from '@/components/BankTable';
import { Sparkline } from '@/components/charts';
import { GoalTag } from '@/components/GoalTag';
import { InvestHeadline, pct, rupees, rupeesCompact, tone } from '@/components/InvestHeadline';
import { KpiStrip } from '@/components/KpiStrip';
import { Meter } from '@/components/Meter';
import { PersonBadge } from '@/components/Person';
import { niceDate, niceMonth } from '@/lib/dates';
import type { InvestmentView, FundRow } from '@/lib/investments';
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
  stats,
}: {
  view: InvestmentView;
  noPrice: number;
  title?: string;
  stats?: StatBlock;
}) {
  const h = view.household;
  const hold = stats?.holding;
  const gainPct = stats?.unrealisedPct ?? null;
  const longShare = hold?.longShare ?? null;
  return (
    <KpiStrip
      label={title ?? 'Mutual funds at a glance'}
      six
      items={[
        {
          label: 'Value now',
          value: formatInrCompact(h.value),
          sub: `${formatInrCompact(h.invested)} put in · SIP ${formatInrCompact(h.sipMonthly)} a month`,
          main: true,
        },
        {
          label: 'Gain on units held',
          value: rupeesCompact(stats ? stats.unrealised : h.gain),
          sub: gainPct === null ? 'no cost recorded yet' : `${pct(gainPct, 1)} on the money put in`,
          tone: (stats ? stats.unrealised : h.gain) >= 0 ? 'gain' : 'fail',
        },
        {
          label: 'Return a year (XIRR)',
          value: h.xirr === null ? '–' : pct(h.xirr, 1),
          sub:
            h.xirr === null
              ? 'needs a start date or a fund statement'
              : h.xirrEstimated
                ? 'partly estimated from start dates'
                : 'from fund statement transactions',
          tone: h.xirr === null ? undefined : h.xirr >= 0 ? 'gain' : 'fail',
        },
        {
          label: 'Today',
          value: h.dayPct === null ? '–' : rupeesCompact(h.dayAmount),
          sub: h.dayPct === null ? 'no price change yet' : pct(h.dayPct),
          tone: h.dayPct === null ? undefined : h.dayAmount >= 0 ? 'gain' : 'fail',
        },
        {
          label: 'Already long-term',
          value: longShare === null ? '–' : `${Math.round(longShare * 100)}%`,
          sub:
            longShare === null
              ? 'needs a fund statement or prices'
              : `${formatInrCompact(hold?.longValue ?? 0)} of equity funds held over ${view.holdingMonths} months`,
          href: '/investments?tab=breakdown',
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
  const avg = avgCostPerUnit(f.invested, f.units);
  const share = view.household.value > 0 ? f.value / view.household.value : null;
  return (
    <tr>
      <td data-label="Fund">
        <div className="fundcell">
          <div>
            <Link href={`/asset/${f.assetId}`} className="fundlink">
              {f.name}
            </Link>
            <div className="small muted">
              <span
                className="kindchip"
                title={f.category.certain ? undefined : 'Guessed from the fund name'}
              >
                {f.category.label}
                {f.category.certain ? '' : ' ?'}
              </span>
              {f.amc ? ` · ${f.amc}` : ''}
            </div>
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
              {avg !== null && (
                <span title="Money put in divided by the units held">
                  average cost ₹
                  {avg.toLocaleString('en-IN', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  {' · '}
                </span>
              )}
              {f.startedOn ? `since ${niceMonth(f.startedOn)}` : ''}
              {f.dayTo ? ` · price of ${niceDate(f.dayTo)}` : ''}
              {!f.amfiCode && (
                <>
                  {f.startedOn || f.dayTo ? ' · ' : ''}
                  <Link href="/investments?tab=match">no live price: match it</Link>
                </>
              )}
            </div>
            <span className="fundspark">
              <Sparkline points={f.history.map((x) => x.value)} label={`${f.name} value`} />
            </span>
          </div>
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
        <div className="small muted">
          {share !== null && f.value > 0
            ? `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of the total · `
            : ''}
          {f.valueBasis}
        </div>
      </td>
      <td className={`num ${tone(f.dayAmount)}`} data-label="Today">
        {f.dayAmount === null ? '–' : rupees(f.dayAmount)}
        {f.dayPct !== null && <div className="small">{pct(f.dayPct)}</div>}
      </td>
      <td className={`num ${f.invested ? tone(f.gain) : ''}`} data-label="Gain">
        {f.invested ? rupees(f.gain) : '–'}
        {f.invested > 0 && f.value > 0 && (
          <div className="small">{pct(f.value / f.invested - 1, 1)}</div>
        )}
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
  stats,
}: {
  view: InvestmentView;
  styles: Record<string, PersonStyle>;
  stats: Record<string, StatBlock>;
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
                {stats[g.ownerId] && stats[g.ownerId]!.folios > 0
                  ? ` · ${stats[g.ownerId]!.folios} folio${stats[g.ownerId]!.folios === 1 ? '' : 's'}`
                  : ''}
                {stats[g.ownerId]?.holding.longShare !== null &&
                stats[g.ownerId]?.holding.longShare !== undefined
                  ? ` · ${Math.round(stats[g.ownerId]!.holding.longShare! * 100)}% long-term`
                  : ''}
                {stats[g.ownerId] && stats[g.ownerId]!.funds > 1
                  ? ` · largest ${stats[g.ownerId]!.concentration.top[0]?.label ?? ''} ${Math.round((stats[g.ownerId]!.concentration.top[0]?.share ?? 0) * 100)}%`
                  : ''}
              </div>
            </div>
            <InvestHeadline t={g.totals} />
          </header>
          <div className="xlwrap fundswrap">
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
          </div>
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
