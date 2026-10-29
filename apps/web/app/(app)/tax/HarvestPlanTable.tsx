import Link from 'next/link';
import { formatInr, harvestReportTable, type HarvestTable } from '@fwos/core';
import { PrintButton, XlsxButton } from '@/components/CentreTools';
import { niceDate } from './Parts';

const inr = (n: number) => formatInr(Math.round(n));
const signed = (n: number) =>
  Math.round(n) === 0 ? '–' : `${n < 0 ? '−' : '+'}${inr(Math.abs(n))}`;
const price = (n: number | null) =>
  n === null
    ? '–'
    : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * The whole family's harvest as one table: whose, which fund, units to sell, cost, value, the gain by term, exit load, when to sell,
 * what and when to buy back, when the new units are long-term again, and the tax it saves. Downloads as Excel or prints as a PDF.
 */
export function HarvestPlanTable({ t }: { t: HarvestTable }) {
  const sheet = harvestReportTable(t);
  return (
    <section className="card tx-plan" aria-labelledby="tx-plan-h" data-testid="harvest-plan">
      <div className="tx-plan-head">
        <h2 id="tx-plan-h">Harvest plan, FY {t.fy}</h2>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <XlsxButton tables={[sheet]} lines={t.notes} fileName={`harvest-plan-${t.fy}`} />
          <PrintButton />
        </div>
      </div>
      <p className="small">
        Sell by <b>{niceDate(t.sellBy)}</b> · buy back on <b>{niceDate(t.buyBackOn)}</b> · year ends{' '}
        {niceDate(t.deadline)}
      </p>
      {t.rows.length === 0 ? (
        <p className="muted">
          Nothing to harvest right now. The cards below say when funds turn ready.
        </p>
      ) : (
        <div className="tablewrap">
          <table className="tbl lines responsive tx-plan-table">
            <thead>
              <tr>
                <th>Whose</th>
                <th>Fund</th>
                <th className="num">Units to sell</th>
                <th className="num">Price used</th>
                <th className="num">Cost</th>
                <th className="num">Value now</th>
                <th className="num">Long-term gain</th>
                <th className="num">Short-term gain</th>
                <th className="num">Exit load</th>
                <th>Sell by</th>
                <th className="num">Buy back</th>
                <th className="num">Buy-back units (about)</th>
                <th>Buy back on</th>
                <th>Long-term again from</th>
                <th className="num">Tax saved</th>
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r) => (
                <tr
                  key={`${r.ownerId}-${r.assetId}-${r.kind}`}
                  className={r.kind === 'loss' ? 'tx-plan-loss' : undefined}
                >
                  <td data-label="Whose">{r.person}</td>
                  <td data-label="Fund">
                    <Link href={`/asset/${r.assetId}`}>{r.fund}</Link>
                    <div className="small muted">
                      {r.kind === 'gain' ? 'Gain, inside the tax-free allowance' : 'Loss to book'}
                      {r.note ? ` · ${r.note}` : ''}
                    </div>
                  </td>
                  <td className="num" data-label="Units to sell">
                    <b>{r.unitsText}</b>
                  </td>
                  <td className="num" data-label="Price used">
                    {price(r.price)}
                  </td>
                  <td className="num" data-label="Cost">
                    {inr(r.cost)}
                  </td>
                  <td className="num" data-label="Value now">
                    {inr(r.value)}
                  </td>
                  <td
                    className={`num ${r.longTerm < 0 ? 'fail' : 'gain'}`}
                    data-label="Long-term gain"
                  >
                    {signed(r.longTerm)}
                  </td>
                  <td
                    className={`num ${r.shortTerm < 0 ? 'fail' : r.shortTerm > 0 ? 'gain' : ''}`}
                    data-label="Short-term gain"
                  >
                    {signed(r.shortTerm)}
                  </td>
                  <td className="num" data-label="Exit load">
                    {r.exitLoad > 0 ? inr(r.exitLoad) : 'none'}
                  </td>
                  <td data-label="Sell by">{niceDate(r.sellBy)}</td>
                  <td className="num" data-label="Buy back">
                    {inr(r.buyBack)}
                  </td>
                  <td className="num" data-label="Buy-back units (about)">
                    {r.buyBackUnits === null ? '–' : r.buyBackUnits.toFixed(3)}
                  </td>
                  <td data-label="Buy back on">{niceDate(r.buyBackOn)}</td>
                  <td data-label="Long-term again from">{niceDate(r.longTermAgainOn)}</td>
                  <td className="num" data-label="Tax saved">
                    {inr(r.taxEffect)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {t.people.map((p) => (
                <tr key={p.ownerId}>
                  <td colSpan={15} data-label={p.person}>
                    <b>{p.person}</b>: gain booked {inr(p.gain)}
                    {p.loss < 0 ? ` · loss booked ${inr(-p.loss)}` : ''} · put back {inr(p.buyBack)}{' '}
                    · allowance left after this {inr(p.allowanceLeft)}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}
      <ul className="small muted tx-plan-notes">
        {t.notes.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
    </section>
  );
}
