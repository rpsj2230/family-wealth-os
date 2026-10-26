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
import '@/app/(app)/raise/raise.css';

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

/** Where the money ends up: the linked account for a deposit, else the account it is already in. */
function landsIn(x: RaisePick): string {
  if (x.creditTo) return x.creditTo;
  if (x.kind === 'cash') return 'Stays in this account';
  return 'Your bank account (confirm the credit)';
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

/** A long plan (many small accounts) shows the first steps and folds the rest away. */
function Steps({
  picks,
  styles,
  from = 1,
  limit = 8,
}: {
  picks: RaisePick[];
  styles: Record<string, PersonStyle>;
  from?: number;
  limit?: number;
}) {
  if (picks.length <= limit + 2) return <StepList picks={picks} styles={styles} from={from} />;
  return (
    <>
      <StepList picks={picks.slice(0, limit)} styles={styles} from={from} />
      <details className="disclose">
        <summary>
          Show the other {picks.length - limit} steps (
          {formatInr(picks.slice(limit).reduce((a, x) => a + x.cashIn, 0))})
        </summary>
        <div style={{ marginTop: 10 }}>
          <StepList picks={picks.slice(limit)} styles={styles} from={from + limit} />
        </div>
      </details>
    </>
  );
}

/** The steps of a plan as numbered cards: which account, what to do, what reaches the bank, by when, at what cost. */
function StepList({
  picks,
  styles,
  from = 1,
}: {
  picks: RaisePick[];
  styles: Record<string, PersonStyle>;
  from?: number;
}) {
  return (
    <ol className="rz-steps" start={from}>
      {picks.map((x, i) => (
        <li key={x.assetId + x.kind} className="rz-step">
          <span className="rz-n" aria-hidden="true">
            {from + i}
          </span>
          <div>
            <div className="rz-top">
              <PersonBadge p={styles[x.ownerId]} size={20} />
              <b>{holding(x)}</b>
              <span className="chip tiny">{KIND_LABEL[x.kind]}</span>
            </div>
            <p className="rz-do">{x.steps[0]}</p>
            {x.notes.map((n) => (
              <p className="rz-note" key={n}>
                {n}
              </p>
            ))}
            <dl className="rz-facts">
              <div>
                <dt>Take out</dt>
                <dd>{formatInr(x.gross)}</dd>
              </div>
              <div>
                <dt>Reaches the bank</dt>
                <dd>{formatInr(x.cashIn)}</dd>
              </div>
              <div>
                <dt>By</dt>
                <dd>{nice(x.availableOn)}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>{x.cost > 0 ? formatInr(x.cost) : 'nil'}</dd>
              </div>
              <div>
                <dt>Money lands in</dt>
                <dd>{landsIn(x)}</dd>
              </div>
            </dl>
          </div>
        </li>
      ))}
    </ol>
  );
}

function SaveSteps({
  picks,
  need,
  today,
  saveSteps,
}: {
  picks: RaisePick[];
  need: number;
  today: string;
  saveSteps?: ((f: FormData) => Promise<void>) | undefined;
}) {
  if (picks.length === 0 || !saveSteps) return null;
  return (
    <form action={saveSteps} className="rz-foot">
      <input
        type="hidden"
        name="steps"
        value={JSON.stringify(
          picks.map((x) => ({
            title: `[Raise ${formatInr(need)}] ${x.steps[0]} Expect ${formatInr(x.cashIn)} by ${x.availableOn}.`,
            due: x.availableOn < today ? today : x.availableOn,
          })),
        )}
      />
      <button className="btn compact">Make these steps into reminders</button>
    </form>
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
  saveSteps?: ((f: FormData) => Promise<void>) | undefined;
}) {
  const planBody = (p: RaisePlan) => (
    <>
      <Steps picks={p.picks} styles={styles} />
      <p className="small muted rz-foot">
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
      <SaveSteps picks={p.picks} need={need} today={today} saveSteps={saveSteps} />
    </>
  );

  return (
    <>
      <section className="kpis" aria-label="Summary">
        <article className="kpi main">
          <div className="kpi-label">To raise {formatInr(need)}: the cheapest way</div>
          {ans.cheapest.feasible ? (
            <>
              <div className="kpi-value">
                {ans.cheapest.cost > 0 ? formatInr(ans.cheapest.cost) : 'No cost'}
              </div>
              <div className="kpi-sub muted">
                {ans.cheapest.cost > 0 ? 'interest, charges and tax lost; ' : ''}all in the bank by{' '}
                {nice(ans.cheapest.completeBy)}
              </div>
            </>
          ) : (
            <div className="kpi-value">Not enough found</div>
          )}
        </article>
        <article className="kpi">
          <div className="kpi-label">The fastest way</div>
          {ans.fastest.feasible ? (
            <>
              <div className="kpi-value">{nice(ans.fastest.completeBy)}</div>
              <div className="kpi-sub muted">
                everything in the bank, costing about {formatInr(ans.fastest.cost)}
              </div>
            </>
          ) : (
            <>
              <div className="kpi-value">{formatInr(ans.fastest.cashIn)}</div>
              <div className="kpi-sub muted">
                is all the sources allowed can find, even the fastest way
              </div>
            </>
          )}
        </article>
        <article className="kpi">
          <div className="kpi-label">In the bank today</div>
          <div className="kpi-value">{formatInr(ans.capacity[0]?.available ?? 0)}</div>
          <div className="kpi-sub muted">most you could have at once</div>
        </article>
      </section>

      <section className="card" aria-labelledby="bywhen">
        <h2 id="bywhen">By when</h2>
        <p className="muted small">
          If you need the money by each date: the most you can have, what it costs, and what it
          takes.
        </p>
        <div className="rz-ladder">
          {ans.plans.map((p, i) => (
            <div key={p.label} className={`rz-rung ${p.feasible ? '' : 'short'}`}>
              <div className="k">
                <strong>{p.label}</strong> · {nice(p.deadline)}
              </div>
              <div className="v">{formatInr(ans.capacity[i]!.available)}</div>
              <div className="small">
                {p.feasible ? (
                  <>
                    Cost {p.cost > 0 ? formatInr(p.cost) : 'nil'}
                    <div className="muted">{summarise(p.picks)}</div>
                    <Accounts picks={p.picks} styles={styles} />
                  </>
                ) : (
                  `Short by ${formatInr(p.shortfall)}`
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <h2 className="rz-when" style={{ fontSize: '1.1rem' }}>
        Do this, step by step
      </h2>
      {[ans.cheapest, ans.fastest, ...ans.plans.filter((p) => p.feasible)].map((p, i) => (
        <details className="card" key={`${p.label}${i}`} open={i < 1}>
          <summary>
            <strong>{p.label}</strong>
            {p.feasible
              ? ` · ${formatInr(p.cashIn)} by ${nice(p.completeBy)} · cost ${p.cost > 0 ? formatInr(p.cost) : 'nil'}`
              : ` · short by ${formatInr(p.shortfall)}`}
          </summary>
          <div style={{ marginTop: 12 }}>{planBody(p)}</div>
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
  saveSteps?: ((f: FormData) => Promise<void>) | undefined;
}) {
  const p = ans.plan;
  let n = 1;
  return (
    <>
      <section className="kpis" aria-label="Summary">
        <article className="kpi main">
          <div className="kpi-label">
            To have {formatInr(ans.need)}, whatever it takes
            {ans.by ? `, by ${nice(ans.by)}` : ''}
          </div>
          {p.feasible ? (
            <>
              <div className="kpi-value">{nice(p.completeBy)}</div>
              <div className="kpi-sub muted">
                {ans.by && !ans.deadlineMissed
                  ? 'Cheapest way of having it all by your date. '
                  : 'The earliest the whole amount can be in the bank. '}
              </div>
            </>
          ) : (
            <>
              <div className="kpi-value">Not enough found</div>
              <div className="kpi-sub muted">
                Even using everything, {formatInr(p.cashIn)} can be found; {formatInr(p.shortfall)}{' '}
                is still missing.
              </div>
            </>
          )}
        </article>
        <article className="kpi">
          <div className="kpi-label">What it costs</div>
          <div className="kpi-value">{p.cost > 0 ? formatInr(p.cost) : 'Nothing'}</div>
          <div className="kpi-sub muted">interest, charges and tax lost</div>
        </article>
        {p.refundLater > 0 && (
          <article className="kpi">
            <div className="kpi-label">Comes back later</div>
            <div className="kpi-value">{formatInr(p.refundLater)}</div>
            <div className="kpi-sub muted">tax withheld now, refunded when you file</div>
          </article>
        )}
      </section>
      {ans.deadlineMissed && ans.by && (
        <p className="notice warn" role="alert">
          {ans.earliest
            ? `Your date, ${nice(ans.by)}, cannot be met. The quickest possible is ${nice(ans.earliest)}.`
            : `Your date, ${nice(ans.by)}, cannot be met.`}
        </p>
      )}

      <section className="card">
        <h2>Step by step</h2>
        <p className="muted small">
          Do the steps in the order shown. Nothing here is done for you.
        </p>
        {ans.tranches.map((t) => {
          const from = n;
          n += t.picks.length;
          return (
            <div key={t.date}>
              <div className="rz-when">
                <h3>
                  <strong>{t.label}</strong> <span className="muted small">{nice(t.date)}</span>
                </h3>
                <span className="small">
                  Total by then <b className="num">{formatInr(t.cumulative)}</b>
                </span>
              </div>
              <Steps picks={t.picks} styles={styles} from={from} />
            </div>
          );
        })}
        <p className="small muted rz-foot">
          {p.refundLater > 0
            ? `Tax withheld at source on fund sales, about ${formatInr(p.refundLater)}, comes back when you file. `
            : ''}
          {p.surplus > 0
            ? `${formatInr(p.surplus)} more than needed arrives because a whole deposit is used; it stays in your account. `
            : ''}
        </p>
        <SaveSteps picks={p.picks} need={ans.need} today={today} saveSteps={saveSteps} />
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
