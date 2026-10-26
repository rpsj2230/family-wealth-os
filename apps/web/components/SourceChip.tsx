import type { SourceTag } from '@fwos/core';

const ICON: Record<SourceTag['kind'], string> = {
  auto: '⚡',
  manual: '✎',
  calc: 'ƒ',
  import: '⇪',
  none: '–',
};

/** Where a figure came from; ⚡ means it arrived by itself. */
export function SourceChip({ s }: { s: SourceTag }) {
  return (
    <span
      className={`src src-${s.kind}`}
      title={s.kind === 'auto' ? 'Updated automatically' : undefined}
    >
      <span aria-hidden>{ICON[s.kind]}</span> {s.label}
    </span>
  );
}
