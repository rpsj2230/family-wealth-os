import Link from 'next/link';
import { bankRowFigures, formatInr, type BankBlock, type PersonStyle } from '@fwos/core';
import { UpdatedCell, pctText } from '@/components/BankTable';
import { BankBadge } from '@/components/BankBadge';
import { PersonBadge } from '@/components/Person';
import type { CashRate } from '@/lib/rates-view';

/** Every savings account on one line: bank, person, type, rate, balance, value today and the interest it earns in a year (an estimate). */
export function CashRegister({
  blocks,
  rates,
  tdsRate,
  defaultRate,
  styles,
  sample = false,
}: {
  blocks: BankBlock[];
  rates: Record<string, CashRate | undefined>;
  tdsRate: number;
  defaultRate: number;
  styles: Record<string, PersonStyle>;
  sample?: boolean;
}) {
  const rows = blocks
    .flatMap((b) => b.sections.flatMap((s) => s.rows.map((r) => ({ r, bank: b.name }))))
    .filter((x) => bankRowFigures(x.r).counted)
    .sort((a, b) => (b.r.current ?? 0) - (a.r.current ?? 0));
  if (rows.length === 0) return <p className="empty">No savings account is recorded.</p>;
  return (
    <section className="card cashreg" aria-labelledby="cash-reg-h">
      <h2 id="cash-reg-h">All savings accounts</h2>
      <table className="tbl lines responsive">
        <thead>
          <tr>
            <th>Account</th>
            <th>Person</th>
            <th>Type</th>
            <th className="num">Rate</th>
            <th className="num">Last recorded</th>
            <th className="num">Value today</th>
            <th className="num">Interest a year</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, bank }) => {
            const rate = rates[r.assetId]?.rate ?? defaultRate;
            const inr = r.currency === 'INR';
            return (
              <tr key={r.assetId}>
                <td data-label="Account">
                  <div className="codeline">
                    <BankBadge name={bank} size={26} />
                    <div>
                      <Link href={sample ? '/demo/asset' : `/asset/${r.assetId}`}>{r.code}</Link>
                      <div className="small muted">{bank}</div>
                    </div>
                  </div>
                </td>
                <td data-label="Person">
                  <PersonBadge p={styles[r.ownerId]} name size={18} />
                </td>
                <td data-label="Type">
                  {r.accountKind ?? '–'}
                  {r.joint ? ' · joint' : ''}
                  {!inr ? ` · ${r.currency}` : ''}
                </td>
                <td data-label="Rate" className="num">
                  {inr ? pctText(rate) : '–'}
                </td>
                <td data-label="Last recorded" className="num">
                  {r.recorded === null ? '–' : formatInr(Math.round(r.recorded))}
                </td>
                <td data-label="Value today" className="num">
                  <b>{formatInr(Math.round(r.current ?? 0))}</b>
                </td>
                <td data-label="Interest a year" className="num">
                  {inr
                    ? formatInr(Math.round(Math.max(0, r.current ?? 0) * rate * (1 - tdsRate)))
                    : '–'}
                </td>
                <td data-label="Updated">
                  <UpdatedCell asOf={r.asOf} source={r.source} />
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr data-totals className="sumrow">
            <th scope="row" data-count>
              Total · <span data-count-n>{rows.length}</span> accounts
            </th>
            <td />
            <td />
            <td />
            <td className="num" data-sum>
              –
            </td>
            <td className="num" data-sum>
              –
            </td>
            <td className="num" data-sum>
              –
            </td>
            <td />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}
