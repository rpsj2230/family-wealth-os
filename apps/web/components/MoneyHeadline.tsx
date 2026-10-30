import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatInr, formatInrCompact, formatPct, type Explain } from '@fwos/core';
import { Why } from '@/components/Why';
import './headline.css';

/**
 * The parts of the money headlines (money words v6): one dark panel at the top of Home, Accounts and Deposits with the main figure,
 * its signed pills, the growth strip, the tiles of each kind of money and "Also on this page". Each page draws its own figures with
 * these, so the headlines look and read the same everywhere.
 */

/** A signed amount in full rupees: "+₹37,397", "−₹2,300". */
export const signed = (n: number) => `${n < 0 ? '−' : '+'}${formatInr(Math.abs(Math.round(n)))}`;
/** A signed percentage: "+5.3%". Only returns and changes carry a sign. */
export const signedPct = (r: number, digits = 1) =>
  `${r < 0 ? '−' : '+'}${formatPct(Math.abs(r), digits)}`;
/** A short amount without the rupee sign, for the parts of a sum ("7.45 L"). */
export const short = (n: number) =>
  `${n < 0 ? '−' : ''}${formatInrCompact(Math.abs(n)).replace('₹', '')}`;

/** The panel itself: the label with its "?", and the main figure in full rupees. */
export function HeadlinePanel({
  label,
  value,
  why,
  ariaLabel,
  testId,
  children,
}: {
  label: string;
  value: number;
  why?: Explain | undefined;
  ariaLabel: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="hl" aria-label={ariaLabel}>
      <div className="hl-lbl">
        <h2 className="hl-h">{label}</h2>
        {why && <Why explain={why} tone="on-dark" />}
      </div>
      <div className="hl-big num" data-testid={testId}>
        {formatInr(Math.round(value))}
      </div>
      {children}
    </section>
  );
}

/** A pill: a signed amount, its percentage and what it is, with an arrow and a word as well as the colour. */
export function Pill({
  amount,
  pct,
  label,
  why,
  testId,
  extra,
  extraWhy,
  pctNote,
}: {
  amount: number;
  pct: number | null;
  label: string;
  why?: Explain | undefined;
  testId: string;
  /** a few words after the label ("· XIRR 7.59% a year") */
  extra?: string | undefined;
  /** the "?" of the extra words (the XIRR after a profit), shown after them */
  extraWhy?: Explain | undefined;
  /** what kind of percentage it is, written after it: "overall" gives "(+7.8% overall)" */
  pctNote?: string | undefined;
}) {
  const dir = Math.round(amount) > 0 ? 'up' : Math.round(amount) < 0 ? 'down' : 'flat';
  return (
    <span className={`hl-pill ${dir}`} data-testid={testId}>
      <span className="hl-sig">
        <span aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}</span>
        <span className="sr-only">
          {dir === 'up' ? 'Up ' : dir === 'down' ? 'Down ' : 'No change '}
        </span>{' '}
        {signed(amount)}
        {pct !== null && ` (${signedPct(pct, pctNote ? 1 : 2)}${pctNote ? ` ${pctNote}` : ''})`}
      </span>{' '}
      <span className="hl-pl">{label}</span>
      {why && <Why explain={why} tone="on-dark" />}
      {extra ? <span className="hl-small">{extra}</span> : null}
      {extra && extraWhy && <Why explain={extraWhy} tone="on-dark" />}
    </span>
  );
}

/** The name of a tile, a link to its page when there is one. */
export function TileHead({
  label,
  href,
  why,
}: {
  label: string;
  href: string | null;
  why?: Explain | undefined;
}) {
  return (
    <div className="hl-tl">
      {href ? (
        <Link href={href} className="hl-tlink">
          {label}
        </Link>
      ) : (
        label
      )}
      {why && <Why explain={why} tone="on-dark" />}
    </div>
  );
}

/** One tile of the panel: its name, its figure, one line under it. */
export function Tile({
  label,
  value,
  sub,
  href = null,
  why,
  testId,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  href?: string | null;
  why?: Explain | undefined;
  testId: string;
}) {
  return (
    <li className="hl-tile" data-testid={testId}>
      <TileHead label={label} href={href} why={why} />
      <div className="hl-tv num">{value}</div>
      <div className="hl-ts">{sub}</div>
    </li>
  );
}

/** One of "Also on this page". */
export function Extra({
  label,
  value,
  sub,
  warn = false,
  href,
  why,
  testId,
}: {
  label: string;
  value: string;
  sub: ReactNode;
  warn?: boolean;
  href?: string | null;
  why?: Explain | undefined;
  testId: string;
}) {
  return (
    <li className={`hl-x${warn ? ' warn' : ''}`} data-testid={testId}>
      <div className="hl-xl">
        {href ? (
          <Link href={href} className="hl-tlink">
            {label}
          </Link>
        ) : (
          label
        )}
        {why && <Why explain={why} tone="on-dark" />}
      </div>
      <div className="hl-xv num">{value}</div>
      <div className="hl-xs">{sub}</div>
    </li>
  );
}

/** "Also on this page": the useful extras under the tiles. */
export function Extras({ children }: { children: ReactNode }) {
  return (
    <div className="hl-extras">
      <h3 className="hl-xh">Also on this page</h3>
      <ul className="hl-xg">{children}</ul>
    </div>
  );
}
