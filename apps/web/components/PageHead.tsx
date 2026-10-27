import type { ReactNode } from 'react';
import type { Explain } from '@fwos/core';
import { Why } from './Why';

/** The top of every page: title, one line of what it is for, status pills and the main actions. */
export function PageHead({
  title,
  subtitle,
  pills,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  pills?: { label: string; tone?: 'ok' | 'warn' | 'bad' | 'info'; why?: Explain }[];
  actions?: ReactNode;
}) {
  return (
    <header className="pagehead2">
      <div className="ph-main">
        <h1>{title}</h1>
        {pills && pills.length > 0 && (
          <div className="ph-pills">
            {pills.map((p) => (
              <span key={p.label} className={`pill ${p.tone ?? ''}`}>
                {p.label}
                {p.why && <Why explain={p.why} />}
              </span>
            ))}
          </div>
        )}
        {subtitle && <p className="ph-sub muted">{subtitle}</p>}
      </div>
      {actions && <div className="ph-actions">{actions}</div>}
    </header>
  );
}
