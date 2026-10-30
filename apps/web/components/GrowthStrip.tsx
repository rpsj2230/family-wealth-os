import { formatPct, type Explain } from '@fwos/core';
import { Why } from '@/components/Why';
import './growth-strip.css';

export interface GrowthItem {
  key: string;
  label: string;
  /** a yearly rate, 0.0766 = 7.66%; null shows a dash */
  rate: number | null;
  /** the lead figure: drawn larger, in the return colour */
  main?: boolean;
  why?: Explain;
}

/** The bars run from 0 to the next whole two points above the largest rate shown (14% at least), so a bar never overflows. */
export function growthScale(rates: (number | null)[], inflation: number | null): number {
  const top = Math.max(0.14, inflation ?? 0, ...rates.filter((r): r is number => r !== null));
  return Math.ceil(top / 0.02) * 0.02;
}

/**
 * How is my money growing? One compact strip of yearly rates: the lead figure (all the money at today's rates), then each kind of
 * holding, each with a thin bar and a mark at the inflation rate of the retirement plan, so "is it beating inflation" reads at a glance.
 * Four columns or more on a wide card; two on a phone, the lead figure across the top.
 */
export function GrowthStrip({
  title,
  items,
  inflation,
  testId,
  tone,
}: {
  title: string;
  items: GrowthItem[];
  inflation: number | null;
  testId?: string;
  /** on-dark: drawn inside a dark headline panel */
  tone?: 'on-dark';
}) {
  const scale = growthScale(
    items.map((i) => i.rate),
    inflation,
  );
  const at = (r: number) => `${Math.max(0, Math.min(1, r / scale)) * 100}%`;
  return (
    <section className={`gs${tone ? ` ${tone}` : ''}`} aria-label={title} data-testid={testId}>
      <div className="gs-head">
        <h3 className="gs-title">{title}</h3>
        <span className="gs-key small muted">
          % a year
          {inflation !== null && (
            <>
              {' · '}
              <span className="gs-tick" aria-hidden="true" /> inflation {formatPct(inflation, 1)}
            </>
          )}
        </span>
      </div>
      <ul className="gs-grid" style={{ ['--n' as string]: items.length }}>
        {items.map((i) => (
          <li
            key={i.key}
            className={`gs-item${i.main ? ' main' : ''}`}
            data-testid={testId ? `${testId}-${i.key}` : undefined}
          >
            <div className="gs-label">
              {i.label}
              {i.why && <Why explain={i.why} {...(tone ? { tone } : {})} />}
            </div>
            <div className="gs-rate num">{i.rate === null ? '–' : formatPct(i.rate, 2)}</div>
            <div
              className="gs-bar"
              role="img"
              aria-label={
                i.rate === null
                  ? `${i.label}: not available yet`
                  : `${i.label} ${formatPct(i.rate, 2)} a year${inflation !== null ? `, inflation ${formatPct(inflation, 1)}` : ''}`
              }
            >
              {i.rate !== null && i.rate > 0 && <i style={{ width: at(i.rate) }} />}
              {inflation !== null && <s style={{ left: at(inflation) }} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
