import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium',
  {
    variants: {
      tone: {
        neutral: 'border-[var(--border)] bg-[var(--soft)] text-[var(--fg)]',
        ok: 'border-transparent bg-[var(--ok-bg)] text-[var(--ok-fg)]',
        warn: 'border-transparent bg-[var(--warn-bg)] text-[var(--warn-fg)]',
        bad: 'border-transparent bg-[var(--bad-bg)] text-[var(--fail)]',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export function Badge({
  className,
  tone,
  ...p
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...p} />;
}
