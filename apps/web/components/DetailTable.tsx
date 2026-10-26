import Link from 'next/link';
import '@/app/detail.css';
import { ListingTools } from './ListingTools';

export interface DetailTableData {
  title: string;
  /** shown under the title */
  hint?: string;
  columns: string[];
  /** indexes of columns that hold numbers (right-aligned) */
  numeric?: number[];
  /** `href` makes the first cell a link to the item's own page */
  rows: { cells: string[]; dim?: boolean; href?: string }[];
  empty?: string;
}

/** A plain table for a history or ledger. The column headings are real <th>, so search, sort and export can work on it. */
export function DetailTable({ t }: { t: DetailTableData }) {
  return (
    <section className="detailsection" aria-label={t.title}>
      <h2>{t.title}</h2>
      {t.hint && <p className="small muted">{t.hint}</p>}
      {t.rows.length === 0 ? (
        <p className="detail-empty">{t.empty ?? 'Nothing recorded yet.'}</p>
      ) : (
        <div className="dtable-wrap">
          <table className="dtable">
            <thead>
              <tr>
                {t.columns.map((c, i) => (
                  <th key={c} className={t.numeric?.includes(i) ? 'num' : undefined}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {t.rows.map((r, ri) => (
                <tr key={ri} className={r.dim ? 'dim' : undefined}>
                  {r.cells.map((c, i) => (
                    <td key={i} className={t.numeric?.includes(i) ? 'num' : undefined}>
                      {i === 0 && r.href ? <Link href={r.href}>{c}</Link> : c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** The tables of a detail page; a long one gets search, sort and export. */
export function DetailTables({ tables }: { tables: DetailTableData[] }) {
  return (
    <>
      {tables.map((t) =>
        t.rows.length > 5 ? (
          <ListingTools key={t.title} name={t.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}>
            <DetailTable t={t} />
          </ListingTools>
        ) : (
          <DetailTable key={t.title} t={t} />
        ),
      )}
    </>
  );
}
