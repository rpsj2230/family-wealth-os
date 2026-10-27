/**
 * Following a link on a bank's own page to its rate document, for banks that publish the rates as a PDF (or a page) whose address
 * changes. The link is found in the page's own HTML text, the way a person would look for the button: no script is run and nothing is
 * worked around. Pure: the page text comes in, the address of the document (or nothing) comes out.
 */
import type { DocKind } from '@fwos/core';
import { isPdf } from './rate-docs';

export { DOC_KINDS, DOC_KIND_LABEL, isDocKind, type DocKind } from '@fwos/core';
/** How the kind is told to the reader. */
export const DOC_KIND_FOR_READER: Record<DocKind, string> = {
  both: 'savings and fixed deposit rates',
  savings: 'savings account rates only',
  fd: 'fixed deposit rates only',
};

export interface LinkSpec {
  /** the words on the link: tested against its visible text, aria-label, title and the text of the row it sits in */
  text?: RegExp | undefined;
  /** tested against the full address the link points to */
  href?: RegExp | undefined;
  /** rows to use only when no other row matches (default: "bulk" and "≥" deposits) */
  avoid?: RegExp | undefined;
}

export interface FoundLink {
  /** the full address, resolved against the page */
  url: string;
  /** the words that identified the link (the row's text) */
  text: string;
  /** the date in "w.e.f. 01.09.2026" in that text, as 2026-09-01 */
  effectiveOn: string | null;
}

const DEFAULT_AVOID = /\bbulk\b|>=|≥|&gt;=|&ge;/i;

const decode = (s: string): string =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;/g, "'");

const flat = (s: string): string =>
  decode(s.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();

const attr = (tag: string, name: string): string => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return decode(m?.[2] ?? m?.[3] ?? '').trim();
};

/** "w.e.f. 01.09.2026" or "w.e.f 1/9/2026" or "effective from 01-09-2026" in some words, as an ISO date. */
export function effectiveDateIn(text: string): string | null {
  const m =
    /(?:w\.?\s?e\.?\s?f\.?|effective(?:\s+from)?)\s*[:-]?\s*(\d{1,2})[./-](\d{1,2})[./-](\d{4})/i.exec(
      text,
    );
  if (!m) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The text of the row an anchor sits in: from the nearest opening block tag before it to the end of the anchor. */
function rowText(html: string, at: number, end: number): string {
  const before = html.slice(Math.max(0, at - 700), at);
  const open = Math.max(
    before.lastIndexOf('<div'),
    before.lastIndexOf('<li'),
    before.lastIndexOf('<tr'),
    before.lastIndexOf('<section'),
    before.lastIndexOf('<article'),
    before.lastIndexOf('<p'),
  );
  return flat(open >= 0 ? before.slice(open) + html.slice(at, end) : html.slice(at, end));
}

/**
 * The link to the rate document: every anchor on the page is looked at, and the ones whose words and address match the spec are
 * candidates. Only links to the bank's own domain count (`allowedHost`). Of several, a row that is not an "avoid" row (bulk deposits)
 * is preferred, then a PDF, then the first in page order, so the same page always gives the same answer.
 */
export function findRateLink(
  html: string,
  pageUrl: string,
  spec: LinkSpec,
  allowedHost: (host: string) => boolean,
): FoundLink | null {
  const avoid = spec.avoid ?? DEFAULT_AVOID;
  const found: { link: FoundLink; avoided: boolean; pdf: boolean; order: number }[] = [];
  const re = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  let order = 0;
  while ((m = re.exec(html))) {
    const tag = m[1] ?? '';
    const href = attr(tag, 'href');
    if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let url: URL;
    try {
      url = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !allowedHost(url.hostname)) continue;
    const visible = flat(m[2] ?? '');
    const row = rowText(html, m.index, m.index + m[0].length);
    const names = [
      visible,
      attr(tag, 'aria-label'),
      attr(tag, 'title'),
      attr(tag, 'data-gtm-clicktext'),
      attr(tag, 'data-clicktext'),
      row,
    ].filter(Boolean);
    const words = spec.text;
    const matchedBy = words ? names.find((n) => words.test(n)) : (names[0] ?? row);
    if (words && !matchedBy) continue;
    if (spec.href && !spec.href.test(url.href)) continue;
    if (!words && !spec.href) continue;
    // the row's own text is the most telling name; a bare "Read" is not
    const text =
      names.filter((n) => n.length > 5 && (!words || words.test(n)))[0] ?? matchedBy ?? visible;
    const clean = new URL(url.href);
    clean.hash = '';
    found.push({
      link: { url: clean.href, text, effectiveOn: effectiveDateIn(`${row} ${names.join(' ')}`) },
      avoided: avoid.test(`${row} ${names.join(' ')}`),
      pdf: isPdf(null, clean.href),
      order: order++,
    });
  }
  if (found.length === 0) return null;
  found.sort(
    (a, b) =>
      Number(a.avoided) - Number(b.avoided) || Number(b.pdf) - Number(a.pdf) || a.order - b.order,
  );
  return found[0]!.link;
}
