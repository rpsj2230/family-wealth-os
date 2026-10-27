import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_FIGURE_IDS, FIGURES } from '@fwos/core';

const root = fileURLToPath(new URL('../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const files = [
  ...sources(join(root, 'app')),
  ...sources(join(root, 'components')),
  ...sources(join(root, 'lib')),
]
  .filter((f) => !/\.test\.ts$/.test(f))
  .map((f) => ({ f, text: readFileSync(f, 'utf8') }));

const guide = readFileSync(join(root, '../../docs/UI-GUIDE.md'), 'utf8');

describe('every registered headline figure has its "?"', () => {
  it('each registered figure id is used by a page component (not only built)', () => {
    const unused = ALL_FIGURE_IDS.filter(
      (id) =>
        !files.some(({ f, text }) => !f.includes('/lib/explain-') && text.includes(`['${id}']`)),
    );
    expect(unused, `figures with no "?" on any page: ${unused.join(', ')}`).toEqual([]);
  });

  it('each registered figure is listed in the coverage checklist of docs/UI-GUIDE.md', () => {
    const missing = ALL_FIGURE_IDS.filter((id) => !guide.includes(`\`${id}\``));
    expect(missing, `add these to the coverage checklist: ${missing.join(', ')}`).toEqual([]);
  });

  it('no page component names a figure id that is not registered', () => {
    const known = new Set(ALL_FIGURE_IDS);
    const stray: string[] = [];
    for (const { f, text } of files) {
      if (f.includes('/lib/explain-')) continue;
      for (const m of text.matchAll(
        /\['((?:invest|fund|home|accounts|deposits|cash|reports|tax|monthly|newmoney|rates|goals|raise|retire|others)\.[A-Za-z0-9]+)'\]/g,
      ))
        if (!known.has(m[1]!)) stray.push(`${f}: ${m[1]}`);
    }
    expect(stray).toEqual([]);
  });

  it('the registry has pages', () => {
    expect(Object.keys(FIGURES).length).toBeGreaterThan(0);
  });
});
