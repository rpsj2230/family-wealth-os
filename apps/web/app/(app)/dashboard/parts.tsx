import Link from 'next/link';
import type { ReactNode } from 'react';
import { formatInr, formatInrCompact, formatPct, type Explain } from '@fwos/core';
import { Est } from '@/components/Est';
import { Why, WhyHead } from '@/components/Why';

/** Pages that also exist as public samples under /demo; any other link is drawn as plain text in the sample. */
const SAMPLE_PAGES = [
  'accounts',
  'cash',
  'deposits',
  'goals',
  'inbox',
  'investments',
  'monthly',
  'new-money',
  'others',
  'raise',
  'reports',
  'retire',
  'settings',
  'tasks',
  'tax',
];

/**
 * Where a link on Home goes. In the sample, a page that has a sample twin goes there, a detail page goes to the sample's list or
 * detail view, and anything else has no link (null), so the sample never leaves the invented household.
 */
export function homeLink(path: string, sample: boolean): string | null {
  if (!sample) return path;
  const [route = '', query] = path.split('?');
  const top = route.split('/')[1] ?? '';
  const rest = route.split('/').length > 2;
  if (top === 'asset') return '/demo/asset';
  if (top === 'tasks' && rest) return '/demo/tasks';
  if (SAMPLE_PAGES.includes(top) && !rest) return `/demo${route}${query ? `?${query}` : ''}`;
  return null;
}

const sign = (n: number) => (n >= 0 ? '+' : '−');
/** A signed rupee amount, in full: +₹6,12,000. */
export const rupees = (n: number) => `${sign(n)}${formatInr(Math.abs(Math.round(n)))}`;
/** A signed percentage from a fraction: +13.2%. */
export const pct = (n: number, digits = 2) => `${sign(n)}${Math.abs(n * 100).toFixed(digits)}%`;
/** The text class of a signed figure: green for a gain, red for a loss, none when unknown. */
export const tone = (n: number | null) => (n === null ? '' : n >= 0 ? 'gain' : 'fail');

/** A link that falls back to plain text when the sample has no such page. */
export function MaybeLink({
  href,
  children,
  className,
}: {
  href: string | null;
  children: ReactNode;
  className?: string;
}) {
  return href ? (
    <Link href={href} className={className}>
      {children}
    </Link>
  ) : (
    <span className={className}>{children}</span>
  );
}

/** The heading line of a card: its title, and one link to where the full story lives. */
export function CardHead({
  title,
  id,
  href,
  linkLabel,
  aside,
  why,
}: {
  title: string;
  id?: string;
  href?: string | null;
  linkLabel?: string;
  aside?: ReactNode;
  /** the "?" that says how the card's figures were worked out */
  why?: Explain | undefined;
}) {
  return (
    <header className="hm-head">
      {why ? (
        <WhyHead why={why}>
          <h2 id={id}>{title}</h2>
        </WhyHead>
      ) : (
        <h2 id={id}>{title}</h2>
      )}
      {aside}
      {href && linkLabel && (
        <Link href={href} className="hm-more small">
          {linkLabel}
        </Link>
      )}
    </header>
  );
}

/**
 * A signed figure in one line: an arrow and a word as well as the colour, so a fall never reads as a rise by colour alone.
 * `estimate` adds the shared est. mark for figures worked out from rates rather than read from a statement.
 */
export function Signed({
  label,
  amount,
  pct,
  estimate = false,
  compact = true,
  why,
}: {
  label: string;
  amount: number;
  pct?: number | null;
  estimate?: boolean;
  compact?: boolean;
  why?: Explain | undefined;
}) {
  const rounded = Math.round(amount);
  const dir = rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat';
  return (
    <span className={`hm-signed ${dir}`}>
      <span className="hm-signed-label">{label}</span>
      <span aria-hidden="true" className="bv-arrow">
        {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '▬'}
      </span>
      <span className="sr-only">
        {dir === 'up' ? 'up ' : dir === 'down' ? 'down ' : 'no change '}
      </span>
      <strong>
        {compact ? formatInrCompact(Math.abs(amount)) : Math.abs(rounded).toLocaleString('en-IN')}
      </strong>
      {pct !== null && pct !== undefined && (
        <span className="hm-signed-pct">{formatPct(Math.abs(pct), 2)}</span>
      )}
      {estimate && <Est />}
      {why && <Why explain={why} />}
    </span>
  );
}

/** One row of a bar list: a name, an amount and a share with a thin bar under it. The bar is decoration; the figures are the text. */
export function BarRow({
  name,
  amount,
  share,
  sub,
  scale = 1,
  href,
}: {
  name: ReactNode;
  amount: string;
  share: string;
  sub?: ReactNode;
  /** 0 to 1: how long the bar is */
  scale?: number;
  href?: string | null;
}) {
  return (
    <li className="hm-bar">
      <div className="dv-line">
        <span className="dv-name">{href ? <Link href={href}>{name}</Link> : name}</span>
        <strong className="dv-amt">{amount}</strong>
        <span className="dv-pct">{share}</span>
      </div>
      <div className="dv-bar" aria-hidden="true">
        <span style={{ width: `${Math.max(2, Math.min(1, scale) * 100)}%` }} />
      </div>
      {sub && <div className="dv-sub">{sub}</div>}
    </li>
  );
}
