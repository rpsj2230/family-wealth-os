import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every stylesheet is global once loaded, and Next keeps a page's styles after moving on to another page. A class name defined in
 * two stylesheets for two different things therefore breaks one of them on some pages only: the Google Sheet card's ".gs-key"
 * (a masked key box) once turned the growth strip's ".gs-key" note into dots in a tall box on every page with a headline.
 * A component's own prefix belongs to its own stylesheets.
 */
const OWNED: Record<string, string[]> = {
  // the growth strip ("How is my money growing?"), also placed inside the dark headline panel
  gs: ['components/growth-strip.css', 'components/headline.css'],
  // the Google Sheet card and sync
  gsheet: ['components/sheetsync.css'],
};

const root = join(__dirname, '..');
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (name === 'node_modules' || name.startsWith('.')) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? cssFiles(p) : name.endsWith('.css') ? [p] : [];
  });
}

/** The class names a stylesheet defines (in its selectors, comments left out). */
function classesIn(css: string): Set<string> {
  const out = new Set<string>();
  for (const [, sel] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g))
    if (!sel!.trim().startsWith('@'))
      for (const [, c] of sel!.matchAll(/\.([a-zA-Z][\w-]*)/g)) out.add(c!);
  return out;
}

describe('class name prefixes', () => {
  it('a component prefix is defined only in that component’s stylesheets', () => {
    const wrong: string[] = [];
    for (const file of cssFiles(root)) {
      const rel = relative(root, file);
      for (const c of classesIn(readFileSync(file, 'utf8')))
        for (const [prefix, owners] of Object.entries(OWNED))
          if ((c === prefix || c.startsWith(`${prefix}-`)) && !owners.includes(rel))
            wrong.push(`${rel}: .${c} (the "${prefix}-" prefix belongs to ${owners.join(', ')})`);
    }
    expect(wrong).toEqual([]);
  });
});
