import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RETIRED_WORDS } from '@fwos/core';

/**
 * Money words v6: one list of terms (core terms.ts). This test reads every page component, the web helpers and the core functions that
 * write text a person reads (the "?" explainers, reports, downloads, the e-mail), and fails when a retired word is in a string or in
 * JSX text: "put in", "value today", "worth today", "value now", "amount invested now", "own money brought in", CAGR, "is growth",
 * "earned today", "taken out", and "gain" in the sense of profit. The Income Tax words (capital gains, short-term and long-term gains,
 * harvesting) stay on the tax pages and in the tax functions.
 */
const root = fileURLToPath(new URL('../../../', import.meta.url));

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === 'node_modules' || name === '.next') return [];
    return statSync(p).isDirectory()
      ? sources(p)
      : /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)
        ? [p]
        : [];
  });
}

const files = [
  ...sources(join(root, 'apps/web/app')),
  ...sources(join(root, 'apps/web/components')),
  ...sources(join(root, 'apps/web/lib')),
  ...sources(join(root, 'packages/core/src')),
].filter((f) => !f.endsWith('terms.ts'));

const RETIRED: [string, RegExp][] = [
  ...RETIRED_WORDS.map((r): [string, RegExp] => [r.source, new RegExp(r.source, 'i')]),
  ['earned today', /\bearned today\b/i],
  ['taken out', /\btaken out\b/i],
  ['gain', /\bgains?\b/i],
];
/** where "gain" is the Income Tax word, not profit */
const TAX_FILE = /(tax|harvest|capital-gains|loss-harvest|RaiseResult|TakeOut|settings)/i;
const TAX_WORDS =
  /capital gains?|short-term|long-term|LTCG|STCG|gains? (tax|harvest)|tax-free (long-term )?gain|harvest|112A|exempt|tax|allowance|set off|locks in|sale|sold/i;
/** a piece of code caught between two quotes, not text */
const CODE =
  /\?\s*'|;\s*\n|\bconst \w|===|!==|&&|\|\||=>|\)\);|\b\w+\.\w+\(|\bc\.key\b|^[a-z -]*\bnum\b[a-z -]*$/;
/** tax wording in the harvest explainers that shares a function with other text */
const ALLOW = ['gains already booked this year', 'the gain is only as good as that estimate'];

/** A template literal without its \${…} parts (nested braces included). */
function withoutExpressions(t: string): string {
  let out = '';
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    if (depth === 0 && t[i] === '$' && t[i + 1] === '{') {
      depth = 1;
      i++;
      out += ' ';
      continue;
    }
    if (depth > 0) {
      if (t[i] === '{') depth++;
      else if (t[i] === '}') depth--;
      continue;
    }
    out += t[i];
  }
  return out;
}

/** The text of string literals and JSX text in a source file, comments left out. */
function texts(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const out: string[] = [];
  const re =
    /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`|>([^<>{}]*[A-Za-z][^<>{}]*)</g;
  for (const m of code.matchAll(re)) {
    const t = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    // identifiers, keys and class names have no space; template expressions are code
    const words = withoutExpressions(t);
    if (/\s/.test(words.trim()) && !CODE.test(words)) out.push(words);
  }
  return out;
}

describe('money words v6: no retired word is shown anywhere', () => {
  it('no page, helper or core text uses a retired word', () => {
    const found: string[] = [];
    for (const f of files) {
      for (const t of texts(readFileSync(f, 'utf8'))) {
        for (const [word, re] of RETIRED) {
          if (!re.test(t)) continue;
          if (word === 'gain' && (TAX_FILE.test(f) || TAX_WORDS.test(t))) continue;
          if (ALLOW.some((a) => t.includes(a))) continue;
          found.push(`${f.replace(root, '')}: "${word}" in “${t.trim().slice(0, 90)}”`);
        }
      }
    }
    expect(found, found.join('\n')).toEqual([]);
  });
});
