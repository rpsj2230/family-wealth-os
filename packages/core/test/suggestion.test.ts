import { describe, expect, it } from 'vitest';
import { CANNOT_TELL, approveText, suggestion, suggestionText } from '../src';

const options = [
  { id: 'leave', label: 'Leave it alone', action: 'leave it alone' },
  { id: 'link:a', label: 'Same as A', action: 'link to A' },
  { id: 'new', label: 'A new fund', action: 'add it as a new fund' },
];

describe('suggestion', () => {
  it('has the four parts: what I found, what I suggest and why, Approve, and the other choices', () => {
    const s = suggestion({
      found: 'The statement has A.',
      suggest: 'Link it to A.',
      why: 'The units are equal.',
      recommended: 'link:a',
      options,
    });
    expect(s.found).toBe('The statement has A.');
    expect(s.suggest).toBe('Link it to A.');
    expect(s.why).toBe('The units are equal.');
    expect(s.approve).toBe('Approve: link to A');
    expect(approveText('link to A')).toBe(s.approve);
    // the suggested option comes first, the others keep their order
    expect(s.options.map((o) => o.id)).toEqual(['link:a', 'leave', 'new']);
    expect(s.recommended).toBe('link:a');
  });

  it('says it cannot tell, and offers no Approve button, when there is no evidence', () => {
    const s = suggestion({ found: 'Two funds fit.', suggest: null, why: 'Nothing separates them.', options });
    expect(s.suggest).toBe(CANNOT_TELL);
    expect(s.approve).toBeNull();
    expect(s.recommended).toBeNull();
    expect(s.options.map((o) => o.id)).toEqual(['leave', 'link:a', 'new']);
  });

  it('refuses a suggestion that points at nothing', () => {
    expect(() =>
      suggestion({ found: 'x', suggest: 'y', why: 'z', recommended: 'nope', options }),
    ).toThrow(/not among the options/);
    expect(() => suggestion({ found: 'x', suggest: 'y', why: 'z', options })).toThrow(
      /needs the id/,
    );
    expect(() =>
      suggestion({ found: 'x', suggest: null, why: 'z', options: [...options, options[0]!] }),
    ).toThrow(/twice/);
  });

  it('reads as plain sentences for a log line', () => {
    const t = suggestionText(
      suggestion({
        found: 'F.',
        suggest: 'Do A.',
        why: 'Because.',
        recommended: 'link:a',
        options,
      }),
    );
    expect(t).toBe('F. I suggest: Do A. Because. Other choices: Leave it alone; A new fund.');
  });

  it('carries a field and a link with the option or the prompt', () => {
    const s = suggestion({
      found: 'x',
      suggest: 'Mark it sold.',
      why: 'y',
      recommended: 'sold',
      options: [
        {
          id: 'sold',
          label: 'Mark as sold',
          action: 'mark it sold',
          input: { kind: 'date', label: 'Sold on', value: '2026-10-25', required: true },
        },
        { id: 'keep', label: 'Leave as it is', action: 'leave it' },
      ],
      links: [{ href: '/settings?tab=people', text: 'Add this person' }],
    });
    expect(s.options[0]!.input).toMatchObject({ kind: 'date', value: '2026-10-25' });
    expect(s.links).toEqual([{ href: '/settings?tab=people', text: 'Add this person' }]);
  });
});
