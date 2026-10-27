import Link from 'next/link';
import type { ReactNode } from 'react';
import type { Explain } from '@fwos/core';
import { Why } from './Why';
import '@/app/holdings.css';

export interface Kpi {
  label: string;
  value: ReactNode;
  /** one short line under the value: where it comes from or what to do */
  sub?: ReactNode;
  tone?: 'gain' | 'fail' | 'warn' | undefined;
  /** the headline tile: wider, tinted */
  main?: boolean;
  /** makes the whole tile a link to where the figure is explained */
  href?: string;
  /** the "?" that says how the figure was worked out */
  why?: Explain | undefined;
}

/** The row of headline figures under a page title (the `.kpis` pattern of the dashboard and Tax pages). Six tiles at most. */
export function KpiStrip({
  items,
  label = 'Key figures',
  six = false,
}: {
  items: Kpi[];
  label?: string;
  /** six tiles in one row on wide screens */
  six?: boolean;
}) {
  return (
    <section className={`kpis ${six ? 'kpis-six' : ''}`} aria-label={label}>
      {items.slice(0, 6).map((k) => {
        const body = (
          <>
            <div className="kpi-label">{k.label}</div>
            <div className={`kpi-value ${k.tone ?? ''}`}>{k.value}</div>
            {k.sub && <div className="kpi-sub muted">{k.sub}</div>}
          </>
        );
        return (
          <article key={k.label} className={`kpi ${k.main ? 'main' : ''}`}>
            {k.href ? (
              <Link href={k.href} className="kpi-link">
                {body}
              </Link>
            ) : (
              body
            )}
            {k.why && (
              <span className="kpi-why">
                <Why explain={k.why} />
              </span>
            )}
          </article>
        );
      })}
    </section>
  );
}
