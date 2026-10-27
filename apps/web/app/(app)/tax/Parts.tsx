import Link from 'next/link';
import {
  formatInr,
  formatUnits,
  shortDate,
  type Explain,
  type ExplainSet,
  type HarvestView,
  type LossRow,
  type NotNowRow,
  type PersonStyle,
  type PersonView,
  type SellRow,
  type WorkingLot,
} from '@fwos/core';
import { PersonBadge } from '@/components/Person';
import { Why, WhyHead } from '@/components/Why';
import { CopyUnits } from './CopyUnits';
import './tax.css';

export const niceDate = shortDate;
const inr = (n: number) => formatInr(Math.round(n));
const signed = (n: number) => `${n < 0 ? '−' : ''}${inr(Math.abs(n))}`;

/** Used / this plan / still free, as one bar with the amounts written out underneath. */
function AllowanceMeter({ m }: { m: PersonView['meter'] }) {
  const base = Math.max(m.allowance, m.used + m.plan + m.free, 1);
  const w = (n: number) => `${(Math.max(0, n) / base) * 100}%`;
  return (
    <div className="tx-meter">
      <div
        className="tx-bar"
        role="img"
        aria-label={`Free allowance ${inr(m.allowance)}: used ${inr(m.used)}, this plan ${inr(m.plan)}, still free ${inr(m.free)}`}
      >
        <span className="tx-seg used" style={{ width: w(m.used) }} />
        <span className="tx-seg plan" style={{ width: w(m.plan) }} />
        <span className="tx-seg free" style={{ width: w(m.free) }} />
      </div>
      <ul className="tx-legend small">
        <li>
          <i className="tx-sw used" aria-hidden="true" />
          Used this year <b className="num">{inr(m.used)}</b>
        </li>
        <li>
          <i className="tx-sw plan" aria-hidden="true" />
          This plan <b className="num">{inr(m.plan)}</b>
        </li>
        <li>
          <i className="tx-sw free" aria-hidden="true" />
          Still free <b className="num">{inr(m.free)}</b>
        </li>
      </ul>
    </div>
  );
}

function Chips({ checks }: { checks: SellRow['checks'] }) {
  return (
    <ul className="tx-checks">
      {checks.map((c) => (
        <li key={c.text} className={`tx-chk ${c.tone}`}>
          <span aria-hidden="true">{c.tone === 'ok' ? '✓' : '⚠'}</span>
          <span className="sr-only">{c.tone === 'ok' ? 'Good: ' : 'Check: '}</span>
          <span>{c.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Lot by lot, oldest first: when each purchase was made, what it cost, what it is worth, the gain. */
function LotsTable({ lots, gainLabel }: { lots: WorkingLot[]; gainLabel: string }) {
  return (
    <table className="tbl lines responsive tx-lots">
      <thead>
        <tr>
          <th>Bought on</th>
          <th className="num">Units sold</th>
          <th className="num">Cost</th>
          <th className="num">Worth now</th>
          <th className="num">{gainLabel}</th>
          <th>Term</th>
        </tr>
      </thead>
      <tbody>
        {lots.map((l) => (
          <tr key={l.acquiredOn + l.units}>
            <td data-label="Bought on">
              {l.acquiredOn < '1000' ? 'Before the statement' : shortDate(l.acquiredOn)}
            </td>
            <td className="num" data-label="Units sold">
              {formatUnits(l.units)}
              {l.partial && <div className="small muted">part of {formatUnits(l.unitsInLot)}</div>}
            </td>
            <td className="num" data-label="Cost">
              {inr(l.cost)}
            </td>
            <td className="num" data-label="Worth now">
              {inr(l.value)}
            </td>
            <td className={`num ${l.gain < 0 ? 'fail' : 'gain'}`} data-label={gainLabel}>
              {signed(l.gain)}
            </td>
            <td data-label="Term">{l.longTerm ? 'Long-term' : 'Short-term'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SellWorkingBlock({ r }: { r: SellRow }) {
  const w = r.working;
  return (
    <details className="disclose tx-working">
      <summary>Show the working</summary>
      <p className="small">
        <span className={`pill ${w.exact ? 'ok' : 'warn'}`}>{w.exact ? 'Exact' : 'Estimated'}</span>{' '}
        {w.basisLabel} The fund house sells the oldest units first.
      </p>
      {w.lots.length > 0 && <LotsTable lots={w.lots} gainLabel="Gain" />}
      <dl className="tx-facts small">
        <dt>Total cost of these units</dt>
        <dd>{inr(w.totals.cost)}</dd>
        <dt>Worth now</dt>
        <dd>{inr(w.totals.value)}</dd>
        <dt>Long-term gain (inside the free allowance)</dt>
        <dd className="gain">{inr(w.longTermGain)}</dd>
        <dt>Short-term gain</dt>
        <dd>{inr(w.shortTermGain)}</dd>
        <dt>Amount to put back into the fund afterwards</dt>
        <dd>{inr(w.buyBack)}</dd>
        <dt>Transaction tax (STT) on the sale</dt>
        <dd>{inr(w.costs.stt)}</dd>
        <dt>Stamp duty</dt>
        <dd>{inr(w.costs.stampDuty)}</dd>
        <dt>Exit load</dt>
        <dd>{w.costs.exitLoad > 0 ? inr(w.costs.exitLoad) : 'none'}</dd>
      </dl>
      {w.notes.map((n) => (
        <p key={n} className="small muted">
          {n}
        </p>
      ))}
    </details>
  );
}

/** The one list a person acts from. */
function SellList({ rows }: { rows: SellRow[] }) {
  return (
    <ul className="tx-list" aria-label="Funds to sell">
      <li className="tx-cols" aria-hidden="true">
        <span>Fund</span>
        <span>Units to sell</span>
        <span className="r">Worth about</span>
        <span className="r">Gain you lock in tax-free</span>
        <span>Checks</span>
      </li>
      {rows.map((r) => (
        <li key={r.assetId} className="tx-item">
          <div className="tx-row">
            <div className="tx-c tx-fund">
              <Link href={`/asset/${r.assetId}`}>{r.fund}</Link>
              <div className="small muted">{r.scope}</div>
            </div>
            <div className="tx-c">
              <span className="tx-lab">Units to sell</span>
              <CopyUnits units={r.unitsText} fund={r.fund} />
            </div>
            <div className="tx-c r">
              <span className="tx-lab">Worth about</span>
              <span className="num">{inr(r.worth)}</span>
            </div>
            <div className="tx-c r">
              <span className="tx-lab">Gain you lock in tax-free</span>
              <span className="num gain">+{inr(r.gain)}</span>
            </div>
            <div className="tx-c tx-chkcell">
              <span className="tx-lab">Checks</span>
              <Chips checks={r.checks} />
            </div>
          </div>
          <SellWorkingBlock r={r} />
        </li>
      ))}
    </ul>
  );
}

function NotNowList({ rows }: { rows: NotNowRow[] }) {
  return (
    <ul className="tx-notnow">
      {rows.map((r) => (
        <li key={r.assetId} className="tx-nn">
          <div className="tx-nn-name">
            <Link href={`/asset/${r.assetId}`}>{r.fund}</Link>
            {r.estimated && <span className="pill warn">estimated lots</span>}
          </div>
          <div className="tx-nn-body">
            <p>{r.reason}</p>
            {r.dates.length > 0 && (
              <ul className="tx-dates">
                {r.dates.map((d) => (
                  <li key={d.text}>
                    {d.text} <b>{shortDate(d.on)}</b>
                  </li>
                ))}
                {r.okOn && (
                  <li>
                    Fine to sell from <b>{shortDate(r.okOn)}</b>
                  </li>
                )}
              </ul>
            )}
            {r.dates.length === 0 && r.okOn && (
              <p className="small">
                Fine to sell from <b>{shortDate(r.okOn)}</b>
              </p>
            )}
            {r.later.length > 1 && (
              <details className="disclose tx-working">
                <summary>Show every date</summary>
                <table className="tbl lines responsive">
                  <thead>
                    <tr>
                      <th>Ready from</th>
                      <th className="num">Purchases</th>
                      <th className="num">Units</th>
                      <th className="num">Gain then</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.later.map((t) => (
                      <tr key={t.on}>
                        <td data-label="Ready from">{shortDate(t.on)}</td>
                        <td className="num" data-label="Purchases">
                          {t.lots}
                        </td>
                        <td className="num" data-label="Units">
                          {formatUnits(t.units)}
                        </td>
                        <td className="num" data-label="Gain then">
                          {signed(t.gain)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function LossList({ rows }: { rows: LossRow[] }) {
  return (
    <ul className="tx-notnow">
      {rows.map((r) => (
        <li key={r.assetId} className="tx-nn">
          <div className="tx-nn-name">
            <Link href={`/asset/${r.assetId}`}>{r.fund}</Link>
            {r.estimated && <span className="pill warn">estimated lots</span>}
          </div>
          <div className="tx-nn-body">
            <p>{r.sentence}</p>
            <p className="small muted">
              {r.scope}. Short-term loss {inr(r.shortLoss)}, long-term loss {inr(r.longLoss)}.
            </p>
            <details className="disclose tx-working">
              <summary>Show the working</summary>
              <LotsTable lots={r.lots} gainLabel="Gain or loss" />
            </details>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PersonHarvest({
  pv,
  person,
  ex,
}: {
  pv: PersonView;
  person: PersonStyle | undefined;
  ex: ExplainSet<'tax'>;
}) {
  return (
    <section
      className="card personcard tx-person"
      style={{ ['--person' as string]: person?.colour }}
      aria-label={`Tax harvest for ${pv.name}`}
    >
      <header className="tx-head">
        <h2>
          <PersonBadge p={person} name size={26} />
        </h2>
        <span className="small muted">
          Free allowance {inr(pv.meter.allowance)} a year
          <Why explain={ex['tax.allowance']} />
        </span>
      </header>
      <p className="tx-headline">{pv.headline}</p>
      <p className="tx-sub muted">{pv.sub}</p>
      <AllowanceMeter m={pv.meter} />

      {pv.sell.length > 0 && (
        <>
          <WhyHead why={ex['tax.sell']}>
            <h3 className="tx-h">Sell this</h3>
          </WhyHead>
          <SellList rows={pv.sell} />
          {pv.working.length > 0 && (
            <details className="disclose tx-working">
              <summary>Show the working for {pv.name}</summary>
              <ul className="list small">
                {pv.working.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      {pv.notNow.length > 0 && (
        <>
          <h3 className="tx-h">
            Do not sell yet <span className="tx-count">{pv.notNow.length}</span>
          </h3>
          <NotNowList rows={pv.notNow} />
        </>
      )}

      <WhyHead why={ex['tax.losses']}>
        <h3 className="tx-h" id={`losses-${pv.ownerId}`}>
          Losses you can book{' '}
          {pv.losses.rows.length > 0 && <span className="tx-count">{pv.losses.rows.length}</span>}
        </h3>
      </WhyHead>
      {pv.losses.rows.length === 0 ? (
        <p className="small muted">{pv.losses.summary}</p>
      ) : (
        <>
          <p className="tx-lossnote">{pv.losses.summary}</p>
          <LossList rows={pv.losses.rows} />
          <details className="disclose tx-working">
            <summary>Show the working for losses</summary>
            <ul className="list small">
              {pv.losses.working.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        </>
      )}

      {pv.leftOut.length > 0 && (
        <details className="disclose tx-working">
          <summary>
            {pv.leftOut.length} fund{pv.leftOut.length === 1 ? '' : 's'} left out (not
            equity-oriented)
          </summary>
          <ul className="list small">
            {pv.leftOut.map((f) => (
              <li key={f.assetId}>
                <Link href={`/asset/${f.assetId}`}>{f.fund}</Link>: {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

/** What to do on the platform, in five short lines, with this year's dates filled in. */
export function Checklist({ view }: { view: HarvestView }) {
  return (
    <section className="card tx-check" aria-labelledby="tx-check-h">
      <h2 id="tx-check-h">On the platform</h2>
      <ol className="stepper">
        {view.checklist.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </section>
  );
}

/** One small footnote at the very bottom: what the sales will cost. */
export function CostsNote({ view, why }: { view: HarvestView; why?: Explain }) {
  return (
    <div className="tx-costsrow">
      <details className="tx-costs small">
        <summary>
          Costs to expect: stamp duty, STT, exit load <b className="num">{inr(view.costs.total)}</b>
        </summary>
        <ul className="list">
          <li>Stamp duty: {inr(view.costs.stampDuty)}</li>
          <li>Securities transaction tax (STT): {inr(view.costs.stt)}</li>
          <li>Exit load: {view.costs.exitLoad > 0 ? inr(view.costs.exitLoad) : 'none'}</li>
        </ul>
        <p className="muted">These come from the rates in Settings. Nothing is sold for you.</p>
      </details>
      {why && <Why explain={why} />}
    </div>
  );
}
