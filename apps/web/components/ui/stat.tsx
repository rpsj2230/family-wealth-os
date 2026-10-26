import * as React from 'react';
import { cn } from '@/lib/utils';
import { Card } from './card';

/** A key figure with a label and an optional note: the tiles on the dashboard. */
export function Stat({
  label,
  value,
  note,
  icon,
  className,
}: {
  label: string;
  value: string;
  note?: string;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('p-4', className)}>
      <div className="flex items-center justify-between text-sm text-[var(--muted)]">
        <span>{label}</span>
        {icon}
      </div>
      <p className="m-0 mt-1 text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
      {note && <p className="m-0 mt-1 text-xs text-[var(--muted)]">{note}</p>}
    </Card>
  );
}
