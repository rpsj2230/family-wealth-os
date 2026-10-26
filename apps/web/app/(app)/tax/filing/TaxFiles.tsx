import { formatInr, reconcileTax, type Finding } from '@fwos/core';
import type { Ais, Form26as } from '@fwos/ingest';
import type { StoredStatement } from '@fwos/data';

const CAT: Record<string, string> = {
  interest_savings: 'Interest from savings accounts',
  interest_deposit: 'Interest from deposits',
  interest_other: 'Other interest',
  dividend: 'Dividends',
  mf_purchase: 'Purchase of fund units',
  mf_redemption: 'Sale of fund units',
  securities_purchase: 'Purchase of shares',
  securities_sale: 'Sale of shares',
  salary: 'Salary',
  rent: 'Rent',
  tax_paid: 'Tax paid',
  refund: 'Refund',
  other: 'Other',
};
const LEVEL: Record<Finding['level'], string> = { ok: 'ok', check: 'fail', info: 'muted' };

export interface Computed {
  fdInterestTaxable: number;
  fdInterestNre: number;
  interestTdsExpected: number;
  harvestTds: number;
  fundSaleProceeds: number;
}

/** What the tax department holds for one person, set beside what this app worked out. */
export function TaxFiles({
  name,
  statements,
  computed,
}: {
  name: string;
  statements: StoredStatement[];
  computed: Computed;
}) {
  const s26 = statements.find((s) => s.kind === '26as')?.parsed as Form26as | undefined;
  const ais = statements.find((s) => s.kind === 'ais')?.parsed as Ais | undefined;
  const findings = reconcileTax({ form26as: s26 ?? null, ais: ais ?? null, computed });
  return (
    <div>
      <h3>{name}</h3>
      <ul className="list small">
        {findings.map((f) => (
          <li key={f.text} className={LEVEL[f.level]}>
            {f.level === 'check' ? 'Check: ' : ''}
            {f.text}
          </li>
        ))}
      </ul>
      {s26 && (
        <details>
          <summary>
            Form 26AS: {formatInr(Math.round(s26.totalTds))} of tax credited, {s26.deductors.length}{' '}
            deductors
            {statements.find((s) => s.kind === '26as')?.readBy === 'ai'
              ? ' (read by AI: check the figures)'
              : ''}
          </summary>
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Deductor</th>
                <th>Sections</th>
                <th className="num">Paid or credited</th>
                <th className="num">Tax deducted</th>
              </tr>
            </thead>
            <tbody>
              {s26.deductors.map((d) => (
                <tr key={d.tan + d.name}>
                  <td data-label="Deductor">
                    {d.name} <span className="muted small">{d.tan}</span>
                  </td>
                  <td data-label="Sections">
                    {[...new Set(d.txns.map((t) => t.section))].join(', ') || '–'}
                  </td>
                  <td className="num" data-label="Paid or credited">
                    {formatInr(Math.round(d.paid))}
                  </td>
                  <td className="num" data-label="Tax deducted">
                    {formatInr(Math.round(d.tax))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s26.warnings.length > 0 && (
            <ul className="list small muted">
              {s26.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </details>
      )}
      {ais && (
        <details>
          <summary>
            AIS: {ais.lines.length} information lines
            {statements.find((s) => s.kind === 'ais')?.readBy === 'ai'
              ? ' (read by AI: check the figures)'
              : ''}
          </summary>
          <table className="tbl">
            <tbody>
              {Object.entries(ais.byCategory).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{CAT[k] ?? k}</th>
                  <td className="num">{formatInr(Math.round(v ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ais.warnings.length > 0 && (
            <ul className="list small muted">
              {ais.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </details>
      )}
    </div>
  );
}
