import { CATEGORIES } from '@fwos/core';

/** The tags a statement line can carry (core statement-categories.ts), money out or money in, with "work it out" first. */
export function CategoryOptions({ side }: { side: 'in' | 'out' | 'any' }) {
  const list = (
    Object.entries(CATEGORIES) as [string, { label: string; side: 'in' | 'out' | 'both' }][]
  ).filter(([, c]) => side === 'any' || c.side === side || c.side === 'both');
  return (
    <>
      <option value="">Work it out from the narration</option>
      {list.map(([id, c]) => (
        <option key={id} value={id}>
          {c.label}
        </option>
      ))}
    </>
  );
}
