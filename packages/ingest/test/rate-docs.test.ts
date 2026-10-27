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
    expect(rateDocsFor('Some Other Bank')).toEqual({ official: [], reference: [] });
  });
  it('lists public comparison pages, labelled third party, for banks that refuse automated visits', () => {
    for (const b of ['ESAF Bank', 'HDFC Bank', 'IDFC First Bank', 'IndusInd Bank', 'RBL Bank']) {
      const d = rateDocsFor(b);
      expect(d.reference.length).toBeGreaterThan(0);
      for (const x of d.reference) expect(x.label).toContain('third party');
    }
  });
  it('reads HDFC and IDFC FIRST from their own published pages first', () => {
    for (const b of ['HDFC Bank', 'IDFC First Bank']) {
      const d = rateDocsFor(b);
      expect(d.official.length).toBeGreaterThanOrEqual(2);
      for (const x of d.official)
        expect(x.url).toMatch(/^https:\/\/www\.(hdfcbank|idfcfirstbank)\.com\//);
    }
  });
  it('only lists openly published https documents', () => {
    for (const b of ['AU Bank', 'Equitas', 'Yes Bank', 'ESAF Bank', 'HDFC Bank', 'RBL Bank'])
      for (const d of [...rateDocsFor(b).official, ...rateDocsFor(b).reference])
        expect(d.url.startsWith('https://')).toBe(true);
  });
  it('tells a PDF by its type or its address', () => {
    expect(isPdf('application/pdf', 'https://x/y')).toBe(true);
    expect(isPdf(null, 'https://x/y/English.pdf')).toBe(true);
    expect(isPdf('text/html', 'https://x/y')).toBe(false);
  });
});
