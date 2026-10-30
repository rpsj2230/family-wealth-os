import Link from 'next/link';
import { formatInr, unitsText, type Explain, type FundTaxPanel, type PanelRow } from '@fwos/core';
import { Est, LEDGER_EST_TITLE } from '@/components/Est';
import { rupees, tone } from '@/components/InvestHeadline';
import { WhyHead } from '@/components/Why';
import { niceDate } from '@/lib/dates';
import { TakeOutBox } from './TakeOutBox';
import './invest.css';

const inr = (n: number) => formatInr(Math.round(n));

function Chip({ c }: { c: PanelRow['chips'][number] }) {
  return <span className={`ledgerchip ${c.tone}`}>{c.label}</span>;
}

/** One tile of the totals: a heading, the units and, under it, the money. */
function Tile({
  label,
  units,
  sub,
  cls,
}: {
  label: string;
  units: string;
  sub?: string | undefined;
  cls?: string | null | undefined;
}) {
  return (
    <div className="tp-tile">
      <dt>{label}</dt>
      <dd className={`v ${cls ?? ''}`}>{units}</dd>
      {sub && <dd className="s">{sub}</dd>}
    </div>
  );
}

/**
 * "Exit load and tax" on a fund's page: whether any unit is still under an exit load, which units are short-term or long-term and
 * which are at a loss, and (for equity funds) what to sell now to use the person's tax-free allowance. Everything is worked out in
 * packages/core (fund-tax-panel); this lays it out.
 */
export function TaxPanel({
  panel,
  taxHref,
  setExitLoadHref,
  fundName,
  why,
}: {
  why?: Explain;
  panel: FundTaxPanel;
  taxHref: string;
  setExitLoadHref: string;
  fundName: string;
}) {
  const p = panel;
  const x = p.exitLoad;
  const t = p.totals;
  const h = p.harvest;
  const noLots = p.rows.length === 0;
  return (
    <section className="card wide taxpanel" aria-labelledby="tp-h" data-testid="tax-panel">
      <div className="cardhead">
        {why ? (
          <WhyHead why={why}>
            <h2 id="tp-h">Exit load and tax</h2>
          </WhyHead>
        ) : (
          <h2 id="tp-h">Exit load and tax</h2>
        )}
        <span className="small muted">
          {p.classLabel}
          {p.classCertain ? '' : ' (guessed from the name)'}
        </span>
      </div>

      {p.estimated && (
        <p className="tp-warn small" role="note">
          <Est title={LEDGER_EST_TITLE} />{' '}
          {p.ledgerStatus !== 'complete'
            ? 'This fund’s history does not add up (see “Does this add up?” below), so the units by purchase are only as good as the lines on file.'
            : p.basis === 'estimated'
              ? 'The purchases are estimated from the monthly investment plan and the prices, not read from a statement.'
              : 'No purchases are on file, so the split below cannot be made.'}
        </p>
      )}

      <div className={`tp-status ${x.state === 'under_load' ? 'warn' : 'ok'}`} role="status">
        <b data-testid="exit-load-status">{x.headline}</b>
        {x.state === 'not_set' || x.offerSet ? (
          <>
            {' · '}
            <Link href={setExitLoadHref}>Set it for this fund</Link>
          </>
        ) : null}
        {x.detail && <span className="small"> {x.detail}</span>}
      </div>

      {noLots ? (
        <p className="empty small">
          {p.basis === 'none'
            ? 'No purchases are on file for this fund, so its units cannot be split by age. Import a detailed statement or add the transactions.'
            : 'No units are held.'}
        </p>
      ) : (
        <>
          <dl className="tp-totals" aria-label={`${fundName}: units by exit load and tax term`}>
            <Tile
              label="Under exit load"
              units={`${unitsText(t.unitsUnderLoad)} units`}
              sub={t.unitsUnderLoad > 0 ? inr(t.valueUnderLoad) : 'none'}
              cls={t.unitsUnderLoad > 0 ? 'fail' : null}
            />
            <Tile
              label="Free of exit load"
              units={`${unitsText(t.unitsLoadFree)} units`}
              sub={x.rule ? undefined : 'no rule set'}
            />
            {p.taxClass === 'equity' || p.taxClass === 'other_long' ? (
              <>
                <Tile
                  label="Short-term (STCG)"
                  units={`${unitsText(t.stcgUnits)} units`}
                  sub={t.stcgUnits > 0 ? `gain ${rupees(t.stcgGain)}` : 'none'}
                  cls={t.stcgUnits > 0 ? tone(t.stcgGain) : null}
                />
                <Tile
                  label="Long-term (LTCG)"
                  units={`${unitsText(t.ltcgUnits)} units`}
                  sub={t.ltcgUnits > 0 ? `gain ${rupees(t.ltcgGain)}` : 'none'}
                  cls={t.ltcgUnits > 0 ? tone(t.ltcgGain) : null}
                />
              </>
            ) : (
              <Tile
                label="Tax term"
                units={p.taxClass === 'debt_slab' ? 'Slab rate' : 'Check'}
                sub={p.classNote}
              />
            )}
            <Tile
              label="At a loss"
              units={`${unitsText(t.lossUnits)} units`}
              sub={t.lossUnits > 0 ? rupees(t.lossAmount) : 'none'}
              cls={t.lossUnits > 0 ? 'fail' : null}
            />
            {t.unknownCostUnits > 0.0005 && (
              <Tile
                label="Cost not known"
                units={`${unitsText(t.unknownCostUnits)} units`}
                sub="gain cannot be stated"
              />
            )}
          </dl>

          <details className="tp-lots" open={p.rows.length <= 8}>
            <summary>
              {p.rows.length} purchase{p.rows.length === 1 ? '' : 's'} still held, oldest first
            </summary>
            <div className="cmpwrap">
              <table className="tbl lines cmp tp-table">
                <thead>
                  <tr>
                    <th>Bought</th>
                    <th className="num">Units</th>
                    <th className="num">Cost</th>
                    <th className="num">Current value</th>
                    <th className="num">Gain</th>
                    <th className="num">Days held</th>
                    <th className="num">Exit-load free from</th>
                    <th className="num">Long-term from</th>
                    <th>Term today</th>
                  </tr>
                </thead>
                <tbody>
                  {p.rows.map((r) => (
                    <tr key={r.key} className={r.underLoad ? 'underload' : ''}>
                      <td data-label="Bought">
                        {r.acquiredOn ? niceDate(r.acquiredOn) : 'Before the first line'}
                      </td>
                      <td className="num" data-label="Units">
                        {unitsText(r.units)}
                      </td>
                      <td className="num" data-label="Cost">
                        {r.cost === null ? '–' : inr(r.cost)}
                      </td>
                      <td className="num" data-label="Current value">
                        {r.value === null ? '–' : inr(r.value)}
                      </td>
                      <td className={`num ${tone(r.gain)}`} data-label="Gain">
                        {r.gain === null ? '–' : rupees(r.gain)}
                      </td>
                      <td className="num" data-label="Days held">
                        {r.daysHeld === null ? '–' : r.daysHeld}
                      </td>
                      <td className="num" data-label="Exit-load free from">
                        {r.loadFreeOn === null
                          ? '–'
                          : r.underLoad
                            ? niceDate(r.loadFreeOn)
                            : 'already'}
                      </td>
                      <td className="num" data-label="Long-term from">
                        {r.longTermOn === null
                          ? '–'
                          : r.term === 'LTCG'
                            ? 'already'
                            : niceDate(r.longTermOn)}
                      </td>
                      <td data-label="Term today">
                        <span className="tp-chips">
                          {r.chips.map((c) => (
                            <Chip key={c.label} c={c} />
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>All {p.rows.length}</td>
                    <td className="num" data-label="Units">
                      {unitsText(t.units)}
                    </td>
                    <td className="num" data-label="Cost">
                      {t.unknownCostUnits > 0.0005
                        ? '–'
                        : inr(p.rows.reduce((a, r) => a + (r.cost ?? 0), 0))}
                    </td>
                    <td className="num" data-label="Current value">
                      {inr(p.rows.reduce((a, r) => a + (r.value ?? 0), 0))}
                    </td>
                    <td className="num" data-label="Gain">
                      {t.unknownCostUnits > 0.0005
                        ? '–'
                        : rupees(p.rows.reduce((a, r) => a + (r.gain ?? 0), 0))}
                    </td>
                    <td className="num" data-label="Days held" />
                    <td className="num" data-label="Exit-load free from">
                      {unitsText(t.unitsUnderLoad)} under · {unitsText(t.unitsLoadFree)} free
                    </td>
                    <td className="num" data-label="Long-term from">
                      {p.taxClass === 'equity' || p.taxClass === 'other_long'
                        ? `${unitsText(t.stcgUnits)} short · ${unitsText(t.ltcgUnits)} long`
                        : '–'}
                    </td>
                    <td data-label="Term today" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </details>
        </>
      )}

      <div className={`tp-harvest ${h.state}`} data-testid="harvest-advice">
        <h3>Tax-gain harvest this year</h3>
        <p className="tp-head">
          <b>{h.headline}</b>
          {h.estimated && h.state !== 'not_applicable' && <Est title={LEDGER_EST_TITLE} />}
        </p>
        {h.allowance && (
          <p className="small muted">
            Tax-free long-term gain for {h.allowance.fy}: {inr(h.allowance.exemption)}, used{' '}
            {inr(h.allowance.used)}, left {inr(h.allowance.room)}. Use it before{' '}
            {niceDate(h.allowance.deadline)}.
          </p>
        )}
        {h.lines.length > 0 && (
          <ul className="small">
            {h.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}
        {h.pick && h.pick.lots.length > 0 && (
          <div className="cmpwrap">
            <table className="tbl lines cmp tp-pick">
              <thead>
                <tr>
                  <th>Sell from</th>
                  <th className="num">Units</th>
                  <th className="num">Value</th>
                  <th className="num">Gain</th>
                </tr>
              </thead>
              <tbody>
                {h.pick.lots.map((l, i) => (
                  <tr key={i}>
                    <td data-label="Sell from">
                      {l.acquiredOn.startsWith('1900') || l.acquiredOn.startsWith('0001')
                        ? 'Before the first line'
                        : niceDate(l.acquiredOn)}
                      {l.partial && <span className="muted small"> (part of it)</span>}
                    </td>
                    <td className="num" data-label="Units">
                      {unitsText(l.units)}
                    </td>
                    <td className="num" data-label="Value">
                      {inr(l.value)}
                    </td>
                    <td className={`num ${tone(l.gain)}`} data-label="Gain">
                      {rupees(l.gain)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {h.caution && <p className="tp-warn small">{h.caution}</p>}
        <p className="small">
          <Link href={taxHref}>See the whole plan for every fund on the Tax page</Link>
        </p>
      </div>

      {!noLots && (
        <TakeOutBox
          rows={p.rows}
          exitLoad={x.rule}
          rates={p.rates}
          room={h.allowance?.room ?? 0}
          equity={p.equity}
        />
      )}
      <p className="small muted tp-foot">
        Units are sold oldest first, so the oldest units leave the exit load and turn long-term
        first. These are gains, not tax advice: check the figures before you sell.
      </p>
    </section>
  );
}
