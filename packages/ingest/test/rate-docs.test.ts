import { describe, expect, it } from 'vitest';
import { isPdf, rateDocsFor } from '../src/rate-docs';

describe('rateDocsFor', () => {
  it('finds a bank under the names people use for it', () => {
    for (const name of ['AU Bank', 'AU Small Finance Bank', 'au small finance bank ltd'])
      expect(rateDocsFor(name).official).toHaveLength(2);
    expect(rateDocsFor('Equitas').reference.length).toBeGreaterThan(0);
    expect(rateDocsFor('Yes Bank').official).toEqual([]);
  });
  it('knows nothing about other banks, so their saved page is all that is read', () => {
    expect(rateDocsFor('HDFC Bank')).toEqual({ official: [], reference: [] });
  });
  it('only lists openly published https documents', () => {
    for (const b of ['AU Bank', 'Equitas', 'Yes Bank'])
      for (const d of [...rateDocsFor(b).official, ...rateDocsFor(b).reference])
        expect(d.url.startsWith('https://')).toBe(true);
  });
  it('tells a PDF by its type or its address', () => {
    expect(isPdf('application/pdf', 'https://x/y')).toBe(true);
    expect(isPdf(null, 'https://x/y/English.pdf')).toBe(true);
    expect(isPdf('text/html', 'https://x/y')).toBe(false);
  });
});
