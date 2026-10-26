import {
  KIND_LABEL,
  formatInr,
  type AppConfig,
  type PersonStyle,
  type RaiseAnswer,
  type RaisePlan,
} from '@fwos/core';
import type { HardAnswer, RaisePick } from '@fwos/core';
import { PersonBadge } from '@/components/Person';

const nice = (iso: string | null) =>
  iso
    ? new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '–';

const SHORT: Record<string, string> = {
  cash: 'Cash',
  fd_maturing: 'Deposits maturing',
  fd_break: 'Deposits broken early',
  mf: 'Mutual funds',
  stock: 'Shares',
  receivable: 'Money lent',
  property: 'Property',
};

/** "Cash ×22 ₹1,20,000 + Deposits maturing ×4 ₹80,000": one phrase per kind of source instead of one per account. */
function summarise(picks: RaisePlan['picks']): string {
  const by = new Map<string, { n: number; sum: number }>();
  for (const p of picks) {
    const g = by.get(p.kind) ?? { n: 0, sum: 0 };
    g.n += 1;
    g.sum += p.cashIn;
    by.set(p.kind, g);
  }
  return [...by.entries()]
    .map(([k, g]) => `${SHORT[k] ?? k}${g.n > 1 ? ` ×${g.n}` : ''} ${formatInr(g.sum)}`)
    .join(' + ');
}

/** Where a pick comes from, the way the sheet writes it: bank and account code, or the fund or property name. */
function holding(x: RaisePick): string {
  return x.kind === 'cash' || x.kind === 'fd_maturing' || x.kind === 'fd_break'
    ? `${x.bank} · ${x.code}`
    : x.name;
}

/** One line per account: who, where, how much, by when. */
function Accounts({ picks, styles }: { picks: RaisePick[]; styles: Record<string, PersonStyle> }) {
  return (
    <details className="small">
      <summary>Show the accounts</summary>
      <ul className="list">
        {picks.map((x) => (
          <li key={x.assetId + x.kind}>
            <PersonBadge p={styles[x.ownerId]} size={16} /> {holding(x)}: {formatInr(x.cashIn)} by{' '}
            {nice(x.availableOn)}
            {x.cost > 0 ? ` (cost ${formatInr(x.cost)})` : ''}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function RaiseResult({
  ans,
  need,
  today,
  styles,
  cfg,
  saveSteps,
}: {
  ans: RaiseAnswer;
  need: number;
  today: string;
  styles: Record<string, PersonStyle>;
  cfg: AppConfig['liquidity'];
  /** server action that turns a plan into reminder tasks; absent on the public sample */
  saveSteps?: (f: FormData) => Promise<void>;
}) {
  const planBody = (p: RaisePlan) => (
    <>
      <table className="tbl lines responsive">
        <thead>
          <tr>
            <th>Take it from</th>
            <th>How</th>
            <th className="num">Take out</th>
            <th className="num">Reaches bank</th>
            <th>By</th>
            <th className="num">Cost</th>
          </tr>
        </thead>
        <tbody>
          {p.picks.map((x) => (
            <tr key={x.assetId + x.kind}>
              <td data-label="Take it from">
                <PersonBadge p={styles[x.ownerId]} size={18} /> <strong>{holding(x)}</strong>
                <div className="muted small">{KIND_LABEL[x.kind]}</div>
              </td>
              <td data-label="How" className="small">
                {x.steps[0]}
                {x.notes.map((n) => (
                  <div className="muted" key={n}>
                    {n}
                  </div>
                ))}
              </td>
              <td className="num" data-label="Take out">
                {formatInr(x.gross)}
              </td>
              <td className="num" data-label="Reaches bank">
                {formatInr(x.cashIn)}
              </td>
              <td data-label="By">{nice(x.availableOn)}</td>
              <td className="num" data-label="Cost">
                {x.cost > 0 ? formatInr(x.cost) : 'nil'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="small muted" style={{ padding: '4px 18px' }}>
        {p.feasible
          ? `${formatInr(p.cashIn)} in the bank by ${nice(p.completeBy)}${p.surplus > 0 ? `, ${formatInr(p.surplus)} more than you asked for because a whole deposit is used` : ''}. `
          : `Only ${formatInr(p.cashIn)} can be found this way; ${formatInr(p.shortfall)} is still missing. `}
        {p.cost > 0
          ? `Real cost (interest lost, charges, tax): about ${formatInr(p.cost)}. `
          : 'Nothing is lost on this plan. '}
        {p.refundLater > 0
          ? `Tax withheld at source now, about ${formatInr(p.refundLater)}, comes back when you file.`
          : ''}
      </p>
      {p.picks.length > 0 && saveSteps && (
        <form action={saveSteps} style={{ padding: '0 18px 14px' }}>
          <input
            type="hidden"
            name="steps"
            value={JSON.stringify(
              p.picks.map((x) => ({
                title: `[Raise ${formatInr(need)}] ${x.steps[0]} Expect ${formatInr(x.cashIn)} by ${x.availableOn}.`,
                due: x.availableOn < today ? today : x.availableOn,
              })),
            )}
          />
          <button className="btn compact">Make these steps into reminders</button>
        </form>
      )}
    </>
  );

  return (
    <>
      <section className="card hero" aria-label="Summary">
        <p className="muted small">To raise {formatInr(need)}</p>
        {ans.cheapest.feasible ? (
          <>
            <p className="big">
              {ans.cheapest.cost > 0 ? formatInr(ans.cheapest.cost) : 'No cost'}
            </p>
            <p className="small">
              {ans.cheapest.cost > 0
                ? 'Cheapest way: interest, charges and tax lost; '
                : 'Cheapest way: '}
              all in the bank by {nice(ans.cheapest.completeBy)}.
            </p>
          </>
        ) : (
          <p className="big">Not enough found</p>
        )}
        <p className="small">
          {ans.fastest.feasible
            ? `Fastest: everything is in the bank by ${nice(ans.fastest.completeBy)}, costing about ${formatInr(ans.fastest.cost)}.`
            : `Even the fastest way only finds ${formatInr(ans.fastest.cashIn)} from the sources allowed.`}
        </p>
      </section>

      <section className="card">
        <h2>By when</h2>
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>If you need it</th>
              <th className="num">Most you can have by then</th>
              <th className="num">Cost</th>
              <th style={{ paddingLeft: 18 }}>What it takes</th>
            </tr>
          </thead>
          <tbody>
            {ans.plans.map((p, i) => (
              <tr key={p.label}>
                <td data-label="If you need it">
                  <strong>{p.label}</strong>
                  <div className="muted small">{nice(p.deadline)}</div>
                </td>
                <td className="num" data-label="Most you can have by then">
                  {formatInr(ans.capacity[i]!.available)}
                </td>
                <td className="num" data-label="Cost">
                  {p.feasible ? (p.cost > 0 ? formatInr(p.cost) : 'nil') : '–'}
                </td>
                <td data-label="What it takes" className="small" style={{ paddingLeft: 18 }}>
                  {p.feasible ? (
                    <>
                      {summarise(p.picks)}
                      <Accounts picks={p.picks} styles={styles} />
                    </>
                  ) : (
                    `Short by ${formatInr(p.shortfall)}`
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {[ans.cheapest, ans.fastest, ...ans.plans.filter((p) => p.feasible)].map((p, i) => (
        <details className="card" key={`${p.label}${i}`} open={i < 1}>
          <summary>
            <strong>{p.label}</strong>
            {p.feasible
              ? ` · ${formatInr(p.cashIn)} by ${nice(p.completeBy)} · cost ${p.cost > 0 ? formatInr(p.cost) : 'nil'}`
              : ` · short by ${formatInr(p.shortfall)}`}
          </summary>
          {planBody(p)}
        </details>
      ))}

      <details className="card">
        <summary>How this is worked out, and its limits</summary>
        <ul className="list small">
          <li>
            Each holding is dated by when its money could be in your bank: cash today, a deposit on
            its maturity date or a day or so after breaking it, funds and shares after their
            settlement days, property after the sale period you set.
          </li>
          <li>
            Early deposit breaks assume your bank pays {(cfg.fdPenaltyPoints * 100).toFixed(2)}{' '}
            points less interest than the deposit rate. The real penalty is in your bank&apos;s
            terms.
          </li>
          <li>
            Funds and shares: gain comes from the amount invested and first purchase date. Tax uses
            this year&apos;s rules from Settings; as a non-resident, tax on the gain is withheld
            when you sell and the part above what you owe comes back when you file. Selling inside
            the tax-free allowance also counts as harvesting.
          </li>
          <li>
            Where a cost price is not recorded the gain is assumed (Settings), and the plan says so.
          </li>
          <li>Property and money lent out are shown last because they are slow and uncertain.</li>
        </ul>
      </details>
    </>
  );
}

/** "I must have it": when each part arrives, from which account, and what it costs; the money first, the cost second. */
export function HardResult({
  ans,
  today,
  styles,
  saveSteps,
}: {
  ans: HardAnswer;
  today: string;
  styles: Record<string, PersonStyle>;
  saveSteps?: (f: FormData) => Promise<void>;
}) {
  const p = ans.plan;
  return (
    <>
      <section className="card hero" aria-label="Summary">
        <p className="muted small">
          To have {formatInr(ans.need)}, whatever it takes
          {ans.by ? `, by ${nice(ans.by)}` : ''}
        </p>
        {p.feasible ? (
          <>
            <p className="big">{nice(p.completeBy)}</p>
            <p className="small">
              {ans.by && !ans.deadlineMissed
                ? 'Cheapest way of having it all by your date. '
                : 'The earliest the whole amount can be in the bank. '}
              {p.cost > 0
                ? `It costs about ${formatInr(p.cost)} in interest, charges and tax.`
                : 'Nothing is lost.'}
            </p>
          </>
        ) : (
          <>
            <p className="big">Not enough found</p>
            <p className="small">
              Even using everything, {formatInr(p.cashIn)} can be found; {formatInr(p.shortfall)} is
              still missing.
            </p>
          </>
        )}
        {ans.deadlineMissed && ans.by && (
          <p className="small">
            {ans.earliest
              ? `Your date, ${nice(ans.by)}, cannot be met. The quickest possible is ${nice(ans.earliest)}.`
              : `Your date, ${nice(ans.by)}, cannot be met.`}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Step by step</h2>
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>When</th>
              <th>From which account, and what to do</th>
              <th className="num">Reaches bank</th>
              <th className="num">Cost</th>
              <th className="num">Total by then</th>
            </tr>
          </thead>
          <tbody>
            {ans.tranches.map((t) =>
              t.picks.map((x, i) => (
                <tr key={t.date + x.assetId + x.kind}>
                  <td data-label="When">
                    {i === 0 && (
                      <>
                        <strong>{t.label}</strong>
                        <div className="muted small">{nice(t.date)}</div>
                      </>
                    )}
                  </td>
                  <td data-label="From which account, and what to do" className="small">
                    <PersonBadge p={styles[x.ownerId]} size={16} /> <strong>{holding(x)}</strong>{' '}
                    <span className="muted">({KIND_LABEL[x.kind].toLowerCase()})</span>
                    <div>{x.steps[0]}</div>
                    {x.notes.map((n) => (
                      <div className="muted" key={n}>
                        {n}
                      </div>
                    ))}
                  </td>
                  <td className="num" data-label="Reaches bank">
                    {formatInr(x.cashIn)}
                  </td>
                  <td className="num" data-label="Cost">
                    {x.cost > 0 ? formatInr(x.cost) : 'nil'}
                  </td>
                  <td className="num" data-label="Total by then">
                    {i === t.picks.length - 1 ? formatInr(t.cumulative) : ''}
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
        <p className="small muted" style={{ padding: '4px 18px' }}>
          {p.refundLater > 0
            ? `Tax withheld at source on fund sales, about ${formatInr(p.refundLater)}, comes back when you file. `
            : ''}
          {p.surplus > 0
            ? `${formatInr(p.surplus)} more than needed arrives because a whole deposit is used; it stays in your account. `
            : ''}
          Do the steps in the order shown. Nothing here is done for you.
        </p>
        {p.picks.length > 0 && saveSteps && (
          <form action={saveSteps} style={{ padding: '0 18px 14px' }}>
            <input
              type="hidden"
              name="steps"
              value={JSON.stringify(
                p.picks.map((x) => ({
                  title: `[Raise ${formatInr(ans.need)}] ${x.steps[0]} Expect ${formatInr(x.cashIn)} by ${x.availableOn}.`,
                  due: x.availableOn < today ? today : x.availableOn,
                })),
              )}
            />
            <button className="btn compact">Make these steps into reminders</button>
          </form>
        )}
      </section>

      {ans.cheaperIfWaiting && (
        <section className="card">
          <h2>If you can wait</h2>
          <p className="small">
            Waiting until {nice(ans.cheaperIfWaiting.completeBy)} would cost about{' '}
            {ans.cheaperIfWaiting.cost > 0 ? formatInr(ans.cheaperIfWaiting.cost) : 'nothing'}{' '}
            instead of {p.cost > 0 ? formatInr(p.cost) : 'nothing'}, a saving of{' '}
            {formatInr(Math.max(0, p.cost - ans.cheaperIfWaiting.cost))}. Choose &ldquo;soft
            need&rdquo; above to see that plan.
          </p>
        </section>
      )}

      <details className="card">
        <summary>How this is worked out, and its limits</summary>
        <ul className="list small">
          <li>
            Every source is allowed, including breaking deposits early and selling property,
            whatever you have switched off in Settings. The money is brought in as soon as possible,
            and among the ways of finishing by then the cheapest is chosen.
          </li>
          <li>
            Early deposit breaks, fund exit loads and tax are estimates from what is recorded; your
            bank and fund house have the final say. Property takes months and costs are rough.
          </li>
          <li>
            Withdrawals from NRO accounts abroad are limited and need a form; moving money within
            India is free.
          </li>
        </ul>
      </details>
    </>
  );
}
