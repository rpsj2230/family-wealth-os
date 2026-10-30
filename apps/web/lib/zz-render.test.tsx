import { renderToStaticMarkup } from 'react-dom/server';
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildHandbook } from '@fwos/core';
import { HandbookGuide } from '@/app/(app)/emergency/HandbookGuide';
import { demoHandbookInput } from './demo-handbook';

it('renders', () => {
  const doc = buildHandbook(demoHandbookInput(true));
  const html = renderToStaticMarkup(
    <HandbookGuide guide={doc.guide!} generatedAt="2026-10-26T01:30:00Z" initialTicks={{}} member />,
  );
  writeFileSync('/tmp/claude-0/-home-user-family-wealth-os/6d36a264-fa60-5e1e-b43f-02b215e4ced0/scratchpad/hb.html', html);
  writeFileSync('/tmp/claude-0/-home-user-family-wealth-os/6d36a264-fa60-5e1e-b43f-02b215e4ced0/scratchpad/hb.json', JSON.stringify(doc).length + '');
});
