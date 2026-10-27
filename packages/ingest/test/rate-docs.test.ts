import { describe, expect, it } from 'vitest';
import { isLinkDoc, isOfficialHost, isPdf, rateDocsFor, registeredBanks } from '../src/rate-docs';

const addressOf = (d: ReturnType<typeof rateDocsFor>['official'][number]) =>
  isLinkDoc(d) ? d.page : d.url;

describe('rateDocsFor', () => {
  it('finds a bank under the names people use for it', () => {
    for (const name of ['AU Bank', 'AU Small Finance Bank', 'au small finance bank ltd'])
      expect(rateDocsFor(name).official).toHaveLength(2);
    expect(rateDocsFor('Equitas').official.length).toBeGreaterThan(0);
    expect(rateDocsFor('Yes Bank').official.length).toBeGreaterThan(0);
  });

  it('knows nothing about other banks, so their saved page is all that is read', () => {
    expect(rateDocsFor('Some Other Bank')).toEqual({ official: [], domains: [] });
  });

  it('has no concept of a third-party or reference page', () => {
    for (const b of registeredBanks())
      expect(Object.keys(rateDocsFor(b)).sort()).toEqual(['domains', 'official']);
  });

  it('lists an official source for every bank that had only comparison pages', () => {
    for (const b of [
      'Equitas Small Finance Bank',
      'Yes Bank',
      'ESAF Small Finance Bank',
      'IndusInd Bank',
      'RBL Bank',
      'HDFC Bank',
      'IDFC First Bank',
      'AU Small Finance Bank',
    ])
      expect(rateDocsFor(b).official.length, b).toBeGreaterThan(0);
  });
});

describe('the registry only names the bank’s own pages', () => {
  it('every address belongs to one of the bank’s own domains', () => {
    for (const b of registeredBanks()) {
      const d = rateDocsFor(b);
      expect(d.domains.length, b).toBeGreaterThan(0);
      for (const doc of d.official) {
        const u = new URL(addressOf(doc));
        expect(u.protocol, addressOf(doc)).toBe('https:');
        expect(isOfficialHost(b, u.hostname), `${b}: ${addressOf(doc)}`).toBe(true);
      }
    }
  });

  it('names no comparison or aggregator site anywhere', () => {
    const banned =
      /bankbazaar|policybazaar|paisabazaar|scripbox|fi\.money|stablemoney|jainam|creditmantri|wishfin|groww|cleartax|moneycontrol|economictimes/i;
    for (const b of registeredBanks()) {
      const d = rateDocsFor(b);
      for (const doc of d.official) expect(addressOf(doc)).not.toMatch(banned);
      for (const host of d.domains) expect(host).not.toMatch(banned);
      for (const doc of d.official) expect(doc.label).not.toMatch(/third.party|reference only/i);
    }
  });

  it('tells a bank’s own host from a look-alike', () => {
    expect(isOfficialHost('HDFC Bank', 'www.hdfcbank.com')).toBe(true);
    expect(isOfficialHost('HDFC Bank', 'HDFCBANK.com')).toBe(true);
    expect(isOfficialHost('HDFC Bank', 'hdfcbank.com.evil.example')).toBe(false);
    expect(isOfficialHost('HDFC Bank', 'nothdfcbank.com')).toBe(false);
    expect(isOfficialHost('HDFC Bank', 'www.bankbazaar.com')).toBe(false);
    expect(isOfficialHost('Some Other Bank', 'www.hdfcbank.com')).toBe(false);
  });

  it('keeps both the old and the new domain of a bank that moved', () => {
    expect(isOfficialHost('IndusInd Bank', 'www.indusind.bank.in')).toBe(true);
    expect(isOfficialHost('IndusInd Bank', 'www.indusind.com')).toBe(true);
    expect(isOfficialHost('ESAF Bank', 'www.esaf.bank.in')).toBe(true);
    expect(isOfficialHost('Yes Bank', 'www.yes.bank.in')).toBe(true);
  });
});

describe('banks that rotate their rate PDF', () => {
  it('finds Equitas’ rate PDF from its own page, never from a stored PDF address', () => {
    const d = rateDocsFor('Equitas Small Finance Bank');
    const links = d.official.filter(isLinkDoc);
    expect(links.length).toBeGreaterThan(0);
    for (const l of links) {
      expect(l.page).toMatch(/^https:\/\/equitas\.bank\.in\//);
      expect(l.link.text?.test('Interest Rates')).toBe(true);
    }
    for (const doc of d.official) if (!isLinkDoc(doc)) expect(doc.url).not.toMatch(/\.pdf/i);
  });

  it('finds IDFC FIRST’s fixed deposit and NRI savings rows on its rates hub, by their stable words', () => {
    const d = rateDocsFor('IDFC First Bank');
    const links = d.official.filter(isLinkDoc);
    expect(links.map((l) => l.kind)).toEqual(['fd', 'savings']);
    for (const l of links) expect(l.page).toBe('https://www.idfcfirst.bank.in/interest-rate');
    const [fd, sv] = links;
    expect(
      fd!.link.text?.test(
        'Fixed Deposit Interest Rate (Domestic, NRE, NRO) <Rs. 3 Crores (w.e.f. 01.09.2026)',
      ),
    ).toBe(true);
    expect(
      fd!.link.text?.test(
        'Fixed Deposit Interest Rate (Domestic, NRE, NRO) <Rs. 3 Crores (w.e.f. 15.01.2027)',
      ),
    ).toBe(true);
    expect(
      sv!.link.text?.test('NRI Savings Account Interest Rate (NRE & NRO) (w.e.f. 04.10.2026)'),
    ).toBe(true);
    expect(sv!.link.text?.test('Savings Account Interest Rate (w.e.f. 04.10.2026)')).toBe(false);
  });
});

describe('typed documents', () => {
  it('gives savings and deposit pages their own kind', () => {
    const idfc = rateDocsFor('IDFC First Bank').official;
    expect(idfc.map((d) => d.kind ?? 'both')).toEqual(['fd', 'savings']);
    const hdfc = rateDocsFor('HDFC Bank').official;
    expect(hdfc.map((d) => d.kind)).toEqual(['fd', 'savings']);
    for (const b of registeredBanks())
      for (const d of rateDocsFor(b).official)
        expect(['savings', 'fd', 'both', undefined]).toContain(d.kind);
  });
});

describe('isPdf', () => {
  it('tells a PDF by its type or its address', () => {
    expect(isPdf('application/pdf', 'https://x/y')).toBe(true);
    expect(isPdf(null, 'https://x/y/English.pdf')).toBe(true);
    expect(isPdf('text/html', 'https://x/y')).toBe(false);
  });
});
