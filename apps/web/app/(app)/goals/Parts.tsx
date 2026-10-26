import Link from 'next/link';
import { formatInr, formatInrCompact, goalCardFigures, type GoalProjection } from '@fwos/core';
import { ConfirmButton } from '@/components/ConfirmButton';
import './goals.css';

export const KIND_OPTIONS: [string, string][] = [
  ['education', 'Education'],
  ['marriage', 'Marriage'],
  ['retirement', 'Retirement'],
  ['property', 'Property'],
  ['emergency', 'Emergency reserve'],
  ['other', 'Other'],
];
const kindLabel = (k: string) => KIND_OPTIONS.find(([v]) => v === k)?.[1] ?? 'Other';

const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export interface GoalFund {
  assetId: string;
  name: string;
  /** share of the holding set aside, in percent; null for a fixed amount */
  pct: number | null;
  /** what that share is worth today */
  share: number;
}

export interface GoalModel {
  id: string;
  name: string;
  kind: string;
  targetToday: number | null;
  targetDate: string | null;
  /** the goal's own cost inflation as typed, in percent; '' when the default is used */
  inflationPct: string;
  defaultInflationPct: string;
  yearsLeft: number | null;
  returnPct: string;
  inflation: number;
  allocated: number;
  monthly: number;
  proj: GoalProjection;
  funds: GoalFund[];
}

export interface GoalActions {
  update: (f: FormData) => Promise<void>;
  remove: (f: FormData) => Promise<void>;
  removeAllocation: (f: FormData) => Promise<void>;
  setAllocation: (f: FormData) => Promise<void>;
}

export interface HoldingChoice {
  id: string;
  name: string;
  value: number;
  freePct: number;
}

/** One goal: how much of its cost is covered, what is set aside for it, and what to do about a gap. */
export function GoalCard({
  g,
  choices,
  actions,
}: {
  g: GoalModel;
  choices: HoldingChoice[];
  /** absent on the public sample */
  actions?: GoalActions | undefined;
}) {
  const f = goalCardFigures({ proj: g.proj, allocated: g.allocated });
  const p = g.proj;
  const tone = f.state === 'shortfall' ? 'short' : f.state === 'on_track' ? 'ok' : '';
  return (
    <article
      className={`gl-card ${f.state === 'shortfall' ? 'short' : ''}`}
      aria-labelledby={`g-${g.id}`}
    >
      <div className="gl-head">
        <h2 id={`g-${g.id}`}>{g.name}</h2>
        <span className="chip tiny">{kindLabel(g.kind)}</span>
        {g.targetDate && (
          <span className="gl-when">
            needed by {niceDate(g.targetDate)}
            {g.yearsLeft !== null && g.yearsLeft > 0 ? ` (${g.yearsLeft.toFixed(1)} yrs)` : ''}
          </span>
        )}
      </div>

      {f.fundedPct !== null ? (
        <div>
          <div
            className={`gl-bar ${tone}`}
            role="img"
            aria-label={`${f.earmarkedPct}% of the cost is set aside today; the projection covers ${f.fundedPct}%`}
          >
            <span className="proj" style={{ width: `${f.fundedPct}%` }} />
            <span className="now" style={{ width: `${f.earmarkedPct ?? 0}%` }} />
          </div>
          <ul className="gl-legend">
            <li>
              Set aside today <b>{f.earmarkedPct}%</b> of the cost then
            </li>
            <li>
              Projected to cover <b>{f.fundedPct}%</b>
            </li>
          </ul>
        </div>
      ) : null}

      <p className={`gl-headline ${tone}`}>
        {p.status === 'no_target' || p.status === 'past_due' ? f.headline : p.message}
      </p>

      {p.futureCost !== null && (
        <dl className="gl-facts">
          <div>
            <dt>Cost then (grown at {(g.inflation * 100).toFixed(1)}% a year)</dt>
            <dd>{formatInrCompact(p.futureCost)}</dd>
          </div>
          <div>
            <dt>Projected funding (at {g.returnPct}% a year, assumed)</dt>
            <dd>{formatInrCompact(p.projectedValue ?? 0)}</dd>
          </div>
          <div>
            <dt>{(p.gap ?? 0) > 0 ? 'Shortfall' : 'Surplus'} (in today’s ₹)</dt>
            <dd className={(p.gap ?? 0) > 0 ? 'fail' : 'gain'}>
              {formatInrCompact(Math.abs(p.gapToday ?? 0))}
            </dd>
          </div>
          <div>
            <dt>Extra needed each month</dt>
            <dd>{f.topUp > 0 ? formatInr(f.topUp) : 'None'}</dd>
          </div>
        </dl>
      )}

      <div>
        <p className="gl-sub">
          Funds and deposits set aside ({g.funds.length}) · {formatInr(Math.round(g.allocated))}
          {g.monthly > 0 ? ` · SIP share ${formatInr(Math.round(g.monthly))}/month` : ''}
        </p>
        {g.funds.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            Nothing is set aside yet. Set aside a holding below, or from the “Money not set aside”
            tab.
          </p>
        ) : (
          <ul className="gl-funds">
            {g.funds.map((x) => (
              <li key={x.assetId}>
                <span className="nm">
                  <Link href={`/asset/${x.assetId}`}>{x.name}</Link>{' '}
                  <span className="muted small">
                    {x.pct !== null ? `${x.pct}% of it` : 'fixed amount'} ·{' '}
                    {formatInr(Math.round(x.share))}
                  </span>
                </span>
                {actions && (
                  <form action={actions.removeAllocation}>
                    <input type="hidden" name="goal" value={g.id} />
                    <input type="hidden" name="asset" value={x.assetId} />
                    <button
                      className="btn compact ghost"
                      aria-label={`Stop using ${x.name} for ${g.name}`}
                    >
                      Remove
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {actions && (
        <>
          <form action={actions.setAllocation} className="gl-actions gl-earmark">
            <input type="hidden" name="goal" value={g.id} />
            <label className="sr-only" htmlFor={`h-${g.id}`}>
              Holding to set aside for {g.name}
            </label>
            <select
              id={`h-${g.id}`}
              name="asset"
              required
              defaultValue=""
              style={{ flex: '1 1 200px' }}
            >
              <option value="" disabled>
                Set aside a holding…
              </option>
              {choices
                .filter((c) => c.freePct > 0)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.freePct}% free)
                  </option>
                ))}
            </select>
            <label className="sr-only" htmlFor={`pc-${g.id}`}>
              Percent of the holding
            </label>
            <input
              id={`pc-${g.id}`}
              name="percent"
              inputMode="decimal"
              placeholder="% of it"
              required
              style={{ width: 92 }}
            />
            <button className="btn compact">Set aside</button>
          </form>
          <details className="disclose" style={{ marginTop: 0 }}>
            <summary>Edit this goal</summary>
            <form action={actions.update} className="form" style={{ paddingTop: 10 }}>
              <input type="hidden" name="id" value={g.id} />
              <div className="gl-edit">
                <label>
                  Name
                  <input name="name" defaultValue={g.name} required />
                </label>
                <label>
                  Kind
                  <select name="kind" defaultValue={g.kind}>
                    {KIND_OPTIONS.map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Target in today’s ₹
                  <input
                    name="target"
                    inputMode="decimal"
                    defaultValue={g.targetToday ? String(g.targetToday) : ''}
                  />
                </label>
                <label>
                  Needed by
                  <input name="date" type="date" defaultValue={g.targetDate ?? ''} />
                </label>
                <label>
                  Cost inflation % a year
                  <input
                    name="inflation"
                    inputMode="decimal"
                    defaultValue={g.inflationPct}
                    placeholder={`${g.defaultInflationPct} (default)`}
                  />
                </label>
              </div>
              <div className="gl-actions">
                <button className="btn compact primary">Save changes</button>
              </div>
            </form>
            <form action={actions.remove} style={{ paddingTop: 8 }}>
              <input type="hidden" name="id" value={g.id} />
              <ConfirmButton
                message={`Delete the goal "${g.name}"? Holdings are not touched.`}
                label={`Delete the goal ${g.name}`}
              >
                Delete this goal
              </ConfirmButton>
              <span className="muted small"> Holdings are not touched.</span>
            </form>
          </details>
        </>
      )}
    </article>
  );
}
