import Link from 'next/link';
import { formatInr, goalCardFigures } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import {
  GoalCard,
  KIND_OPTIONS,
  type GoalActions,
  type GoalModel,
  type HoldingChoice,
} from './Parts';
import './goals.css';

export const GOAL_TABS = ['goals', 'free'] as const;
export type GoalTab = (typeof GOAL_TABS)[number];
export const parseGoalTab = (s: string | undefined): GoalTab =>
  (GOAL_TABS as readonly string[]).includes(s ?? '') ? (s as GoalTab) : 'goals';

/** What a holding is worth and how much of it no goal claims yet. */
export interface FreeHolding extends HoldingChoice {
  freeValue: number;
}

/**
 * Goals: a progress card per goal, and the money that no goal has claimed yet. Used by the signed-in page and the public sample
 * (which passes no actions).
 */
export function GoalsView({
  goals,
  choices,
  tab,
  base,
  error,
  actions,
  addGoal,
  setAllocation,
  title = 'Goals',
}: {
  goals: GoalModel[];
  choices: FreeHolding[];
  tab: GoalTab;
  base: string;
  error?: string | undefined;
  actions?: GoalActions | undefined;
  addGoal?: ((f: FormData) => Promise<void>) | undefined;
  setAllocation?: ((f: FormData) => Promise<void>) | undefined;
  title?: string;
}) {
  const figs = goals.map((g) => goalCardFigures({ proj: g.proj, allocated: g.allocated }));
  const short = figs.filter((f) => f.state === 'shortfall').length;
  const onTrack = figs.filter((f) => f.state === 'on_track').length;
  const unset = figs.filter((f) => f.state === 'no_target' || f.state === 'past_due').length;
  const topUp = figs.reduce((s, f) => s + f.topUp, 0);
  const earmarked = goals.reduce((s, g) => s + g.allocated, 0);
  const free = choices.reduce((s, c) => s + c.freeValue, 0);
  const freeRows = choices
    .filter((c) => c.freePct > 0 && c.value > 0)
    .sort((a, b) => b.freeValue - a.freeValue);

  return (
    <>
      <PageHead
        title={title}
        subtitle="What each goal needs, how much is set aside for it, and whether it will be enough. A holding can serve several goals, but its value is counted once: set-asides are shares of the same money."
        pills={[
          { label: `${goals.length} goal${goals.length === 1 ? '' : 's'}`, tone: 'info' },
          ...(onTrack > 0 ? [{ label: `${onTrack} on track`, tone: 'ok' as const }] : []),
          ...(short > 0 ? [{ label: `${short} short`, tone: 'warn' as const }] : []),
          ...(unset > 0 ? [{ label: `${unset} need a target`, tone: 'warn' as const }] : []),
        ]}
        actions={
          addGoal ? (
            <a className="btn primary" href="#add">
              Add a goal
            </a>
          ) : undefined
        }
      />
      {error && (
        <p className="notice warn" role="alert">
          {error === 'over'
            ? 'That would set aside more than 100% of this holding across goals.'
            : 'Enter a percentage between 1 and 100.'}
        </p>
      )}

      <section className="kpis" aria-label="Goals at a glance">
        <article className="kpi main">
          <div className="kpi-label">Set aside for goals</div>
          <div className="kpi-value">{formatInr(Math.round(earmarked))}</div>
          <div className="kpi-sub muted">
            {formatInr(Math.round(free))} not set aside for any goal
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Extra needed each month</div>
          <div className="kpi-value">{topUp > 0 ? formatInr(topUp) : 'None'}</div>
          <div className="kpi-sub muted">
            {short > 0
              ? `to close ${short} gap${short === 1 ? '' : 's'}`
              : 'every goal with a target is covered'}
          </div>
        </article>
      </section>

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'goals', label: 'Goals', badge: goals.length },
          { key: 'free', label: 'Money not set aside', badge: freeRows.length || null },
        ]}
      />

      {tab === 'goals' && (
        <>
          {goals.length === 0 && (
            <p className="empty">
              No goals yet. Add one below: a name is enough, and you can set a target and a date any
              time.
            </p>
          )}
          <div className="gl-grid">
            {goals.map((g) => (
              <GoalCard key={g.id} g={g} choices={choices} actions={actions} />
            ))}
          </div>
          {addGoal && (
            <section className="card" id="add" aria-labelledby="add-h" style={{ marginTop: 14 }}>
              <h2 id="add-h">Add a goal</h2>
              <form action={addGoal} className="form">
                <div className="gl-edit">
                  <label>
                    Name
                    <input
                      name="name"
                      placeholder="For example: Advika overseas education"
                      required
                    />
                  </label>
                  <label>
                    Kind
                    <select name="kind" defaultValue="education">
                      {KIND_OPTIONS.map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Target in today’s ₹ (optional)
                    <input name="target" inputMode="decimal" placeholder="for example 5000000" />
                  </label>
                  <label>
                    Needed by (optional)
                    <input name="date" type="date" />
                  </label>
                </div>
                <div className="gl-actions">
                  <button className="btn primary">Add goal</button>
                  <span className="muted small">
                    Cost inflation and the return assumed on the money are set for you; change them
                    under Edit.
                  </span>
                </div>
              </form>
            </section>
          )}
        </>
      )}

      {tab === 'free' && (
        <section className="card" aria-labelledby="free-h">
          <h2 id="free-h">Money not set aside for any goal</h2>
          <p className="muted small">
            Funds, deposits, savings and shares, with the part no goal claims yet. Choose a goal and
            a share to set it aside. Retirement is planned on{' '}
            <Link href="/retire">Can I retire now?</Link>.
          </p>
          {freeRows.length === 0 ? (
            <p className="empty">Every holding is fully set aside, or nothing is recorded yet.</p>
          ) : (
            <div role="list">
              {freeRows.map((c) => (
                <div key={c.id} className="gl-free" role="listitem">
                  <div>
                    <Link href={`/asset/${c.id}`}>
                      <b>{c.name}</b>
                    </Link>
                    <div className="muted small">
                      {formatInr(Math.round(c.value))} · {c.freePct}% free (
                      {formatInr(Math.round(c.freeValue))})
                    </div>
                  </div>
                  {setAllocation && goals.length > 0 ? (
                    <form action={setAllocation} className="gl-earmark">
                      <input type="hidden" name="asset" value={c.id} />
                      <label className="sr-only" htmlFor={`fg-${c.id}`}>
                        Goal for {c.name}
                      </label>
                      <select id={`fg-${c.id}`} name="goal" required defaultValue="">
                        <option value="" disabled>
                          Goal…
                        </option>
                        {goals.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                      <label className="sr-only" htmlFor={`fp-${c.id}`}>
                        Percent of {c.name}
                      </label>
                      <input
                        id={`fp-${c.id}`}
                        name="percent"
                        inputMode="decimal"
                        defaultValue={c.freePct}
                        required
                      />
                      <span aria-hidden="true">%</span>
                      <button className="btn compact">Set aside</button>
                    </form>
                  ) : (
                    <span className="muted small">
                      {goals.length === 0 ? 'Add a goal first' : ''}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}
