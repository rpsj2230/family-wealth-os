import { formatInrCompact, type ExplainSet } from '@fwos/core';
import type { HomeModel } from '@/lib/home';
import { CardHead, MaybeLink, homeLink } from './parts';

const STATUS: Record<string, { word: string; cls: string }> = {
  shortfall: { word: 'Falls short', cls: 'fail' },
  on_track: { word: 'On track', cls: 'gain' },
  no_target: { word: 'No target set', cls: 'muted' },
  past_due: { word: 'Date passed', cls: 'muted' },
};

/** Each goal with how much of its future cost is covered, in words as well as a bar. */
export function Goals({
  m,
  sample,
  ex,
}: {
  m: HomeModel;
  sample: boolean;
  ex: ExplainSet<'home'>;
}) {
  const goals = m.goals.list;
  return (
    <section className="card hm-card" aria-labelledby="hm-goals">
      <CardHead
        title="Goals"
        id="hm-goals"
        why={ex['home.goals']}
        href={homeLink('/goals', sample)}
        linkLabel="All goals"
      />
      {goals.length === 0 ? (
        <p className="muted small">No goals yet. Add one to see whether it is funded.</p>
      ) : (
        <ul className="goalbars">
          {goals.map((g) => {
            const funded = g.proj.fundedPct;
            const st = STATUS[g.proj.status] ?? STATUS.no_target!;
            return (
              <li key={g.id}>
                <div className="barhead">
                  <MaybeLink href={homeLink('/goals', sample)}>{g.name}</MaybeLink>
                  <span className={st.cls}>
                    {st.word}
                    {funded !== null &&
                    g.proj.status !== 'no_target' &&
                    g.proj.status !== 'past_due'
                      ? ` · ${Math.round(funded * 100)}% funded`
                      : ''}
                  </span>
                </div>
                <div className="bartrack" role="presentation">
                  <div
                    className="barfill"
                    style={{
                      width: `${Math.min(100, Math.round((funded ?? 0) * 100))}%`,
                      background:
                        g.proj.status === 'shortfall'
                          ? 'var(--bad, #b91c1c)'
                          : 'var(--ok, #15803d)',
                    }}
                  />
                </div>
                <div className="small muted">
                  {formatInrCompact(g.allocated)} earmarked
                  {g.futureCost ? ` · needs ${formatInrCompact(g.futureCost)}` : ''}
                  {g.targetDate ? ` by ${g.targetDate.slice(0, 7)}` : ''}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
