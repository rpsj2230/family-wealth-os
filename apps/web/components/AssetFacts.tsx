import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PersonStyle } from '@fwos/core';
import '@/app/detail.css';
import { PersonBadge } from './Person';

export interface Fact {
  label: string;
  value: string;
  /** small line under the value */
  note?: string | undefined;
  href?: string | undefined;
}

export interface Crumb {
  label: string;
  href?: string;
}

/** Breadcrumb, heading with whose it is, the headline figure and the actions. */
export function DetailHeader({
  crumbs,
  title,
  subtitle,
  person,
  headline,
  headlineNote,
  actions,
}: {
  crumbs: Crumb[];
  title: string;
  subtitle?: string;
  person?: PersonStyle;
  headline?: string;
  headlineNote?: string;
  actions?: ReactNode;
}) {
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => (
          <span key={c.label}>
            {c.href ? (
              <Link href={c.href}>{c.label}</Link>
            ) : (
              <span aria-current="page">{c.label}</span>
            )}
            {i < crumbs.length - 1 && <span aria-hidden> › </span>}
          </span>
        ))}
      </nav>
      <header className="detailhead" style={{ ['--person' as string]: person?.colour }}>
        {person && <PersonBadge p={person} name size={28} />}
        <h1>{title}</h1>
        {headline && (
          <span>
            <span className="bigvalue">{headline}</span>
            {headlineNote && <span className="small muted"> {headlineNote}</span>}
          </span>
        )}
        {actions && <div className="actions">{actions}</div>}
        {subtitle && <p className="sub">{subtitle}</p>}
      </header>
    </>
  );
}

export function AssetFacts({ facts }: { facts: Fact[] }) {
  return (
    <section className="detailsection" aria-label="Key facts">
      <dl className="facts">
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>
              {f.href ? <Link href={f.href}>{f.value}</Link> : f.value}
              {f.note && <span className="small muted">{f.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
