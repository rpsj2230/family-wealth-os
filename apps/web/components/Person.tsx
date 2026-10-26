import Link from 'next/link';
import type { PersonStyle } from '@fwos/core';

/** Whose it is: colour, initial and (optionally) name together, so colour is never the only cue. */
export function PersonBadge({
  p,
  name = false,
  size = 22,
}: {
  p: PersonStyle | undefined;
  name?: boolean;
  size?: number;
}) {
  if (!p) return <span className="muted">?</span>;
  return (
    <span className="person" title={p.name}>
      <span
        className="avatar"
        style={{ background: p.colour, width: size, height: size, fontSize: size * 0.5 }}
        aria-hidden
      >
        {p.initial}
      </span>
      {name ? <span>{p.name}</span> : <span className="sr-only">{p.name}</span>}
    </span>
  );
}

/** Everyone / one person. Plain links, so it works without scripts and keeps the page address shareable. */
export function PersonFilter({
  people,
  basePath,
  current,
  totals,
  keep,
}: {
  people: PersonStyle[];
  basePath: string;
  current: string | null;
  totals?: Record<string, string>;
  /** other query values to carry along, such as the open tab */
  keep?: Record<string, string>;
}) {
  const href = (id: string | null) => {
    const q = new URLSearchParams(keep);
    if (id) q.set('p', id);
    const text = q.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  return (
    <nav className="chipbar" aria-label="Show whose">
      <Link
        href={href(null)}
        className={`fchip ${current === null ? 'on' : ''}`}
        aria-current={current === null ? 'true' : undefined}
      >
        Everyone
      </Link>
      {people.map((p) => (
        <Link
          key={p.id}
          href={href(p.id)}
          className={`fchip ${current === p.id ? 'on' : ''}`}
          aria-current={current === p.id ? 'true' : undefined}
        >
          <PersonBadge p={p} size={18} />
          {p.name}
          {totals?.[p.id] && <span className="muted small">{totals[p.id]}</span>}
        </Link>
      ))}
    </nav>
  );
}
