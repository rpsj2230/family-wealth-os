import { describe, expect, it } from 'vitest';
import { effectiveDateIn, findRateLink } from '../src/rate-links';

const own = (h: string) => h === 'bank.example.test' || h.endsWith('.bank.example.test');
const PAGE = 'https://www.bank.example.test/nri-banking/';
const find = (html: string, text = /interest\s+rates/i, page = PAGE) =>
  findRateLink(html, page, { text }, own);

describe('findRateLink: a button on the bank’s own page', () => {
  it('finds the link by its visible text and prefers the PDF', () => {
    const html = `<a href="/about">About us</a>
      <a class="float" href="/strapi-dev/uploads/Interest_rates_pdf_ab12.pdf"><span>Interest Rates</span></a>`;
    expect(find(html)).toEqual({
      url: 'https://www.bank.example.test/strapi-dev/uploads/Interest_rates_pdf_ab12.pdf',
      text: 'Interest Rates',
      effectiveOn: null,
    });
  });

  it('resolves a relative address against the page it was found on, including after a redirect', () => {
    const html = '<a href="rates/sheet.pdf">Interest Rates</a>';
    expect(find(html)?.url).toBe('https://www.bank.example.test/nri-banking/rates/sheet.pdf');
    expect(find(html, /interest rates/i, 'https://www.bank.example.test/a/b/c')?.url).toBe(
      'https://www.bank.example.test/a/b/rates/sheet.pdf',
    );
  });

  it('matches on the aria-label or the title when the visible text is an icon', () => {
    expect(find('<a href="/r.pdf" aria-label="Interest Rates"><svg></svg></a>')?.url).toContain(
      '/r.pdf',
    );
    expect(find('<a href="/r.pdf" title="Our interest  rates"><i></i></a>')?.url).toContain(
      '/r.pdf',
    );
  });

  it('ignores a link to another domain', () => {
    const html = `<a href="https://www.bankbazaar.com/fixed-deposit/x.html">Interest Rates</a>
      <a href="https://bank.example.test.evil.example/x.pdf">Interest Rates</a>`;
    expect(find(html)).toBeNull();
    const both = `${html}<a href="https://docs.bank.example.test/rates.pdf">Interest Rates</a>`;
    expect(find(both)?.url).toBe('https://docs.bank.example.test/rates.pdf');
  });

  it('says nothing was found when the page has no such link, or only a script-made button', () => {
    expect(
      find('<a href="/about">About us</a><button onclick="openRates()">Interest Rates</button>'),
    ).toBeNull();
    expect(find('')).toBeNull();
  });

  it('skips fragments, scripts and mail links', () => {
    expect(
      find('<a href="#">Interest Rates</a><a href="javascript:void(0)">Interest Rates</a>'),
    ).toBeNull();
  });

  it('can also require the address to look like a PDF', () => {
    const html =
      '<a href="/interest-rates">Interest Rates</a><a href="/files/r.pdf">Interest Rates</a>';
    expect(findRateLink(html, PAGE, { text: /interest rates/i, href: /\.pdf/i }, own)?.url).toBe(
      'https://www.bank.example.test/files/r.pdf',
    );
    expect(findRateLink(html, PAGE, { href: /\.xlsx/i }, own)).toBeNull();
  });

  it('answers the same for the same page: the first match in page order', () => {
    const html = '<a href="/one">Interest Rates</a><a href="/two">Interest Rates</a>';
    expect(find(html)?.url).toBe('https://www.bank.example.test/one');
    expect(find(html)?.url).toBe('https://www.bank.example.test/one');
  });
});

describe('findRateLink: a hub with one row per product', () => {
  const hub = (fd: string, bulk: string, date = '01.09.2026') => `
    <div class="row"><p>Savings Account Interest Rate (w.e.f. 04.10.2026)</p><a data-gtm-clicktext="x" href="/sa">Read</a></div>
    <div class="row"><p>NRI Savings Account Interest Rate (NRE &amp; NRO) (w.e.f. 04.10.2026)</p><a href="/nri-sa">Read</a></div>
    <div class="row"><p>Bulk Deposit Interest Rate (Domestic, NRE, NRO) &gt;=Rs. 3 Crores (w.e.f. 23.10.2026)</p><a href="${bulk}">Read</a></div>
    <div class="row"><p>Fixed Deposit Interest Rate (Domestic, NRE, NRO) &lt;Rs. 3 Crores (w.e.f. ${date})</p><a href="${fd}">Read</a></div>`;
  const fdWords = /Deposit Interest Rate\s*\(\s*Domestic,\s*NRE,\s*NRO\s*\)/i;

  it('finds a row by the words of its own text, whatever the link says', () => {
    const r = findRateLink(
      hub('/fd.pdf', '/bulk.pdf'),
      PAGE,
      { text: /NRI\s+Savings\s+Account\s+Interest\s+Rate/i },
      own,
    );
    expect(r?.url).toBe('https://www.bank.example.test/nri-sa');
    expect(r?.effectiveOn).toBe('2026-10-04');
  });

  it('keeps matching when the date in the row changes', () => {
    for (const date of ['01.09.2026', '15.01.2027', '1/2/2027'])
      expect(
        findRateLink(hub('/fd.pdf', '/bulk.pdf', date), PAGE, { text: fdWords }, own)?.url,
      ).toBe('https://www.bank.example.test/fd.pdf');
  });

  it('prefers the row that is not a bulk (₹3 crore and above) row, wherever it sits', () => {
    const r = findRateLink(hub('/fd.pdf', '/bulk.pdf'), PAGE, { text: fdWords }, own);
    expect(r?.url).toBe('https://www.bank.example.test/fd.pdf');
    expect(r?.text).toMatch(/Fixed Deposit/);
    // the bulk row first in the page: still not preferred
    const reversed = `<div><p>Bulk Deposit Interest Rate (Domestic, NRE, NRO) &gt;=Rs. 3 Crores</p><a href="/bulk.pdf">Read</a></div>
      <div><p>Fixed Deposit Interest Rate (Domestic, NRE, NRO) &lt;Rs. 3 Crores</p><a href="/fd.pdf">Read</a></div>`;
    expect(findRateLink(reversed, PAGE, { text: fdWords }, own)?.url).toBe(
      'https://www.bank.example.test/fd.pdf',
    );
  });

  it('uses the bulk row only when it is the only one', () => {
    const only =
      '<div><p>Bulk Deposit Interest Rate (Domestic, NRE, NRO) &gt;=Rs. 3 Crores</p><a href="/bulk.pdf">Read</a></div>';
    expect(findRateLink(only, PAGE, { text: fdWords }, own)?.url).toBe(
      'https://www.bank.example.test/bulk.pdf',
    );
  });

  it('reads the date the bank gives for a row', () => {
    const r = findRateLink(hub('/fd.pdf', '/bulk.pdf'), PAGE, { text: fdWords }, own);
    expect(r?.effectiveOn).toBe('2026-09-01');
  });
});

describe('effectiveDateIn', () => {
  it('reads the usual ways a bank writes it', () => {
    expect(effectiveDateIn('rates (w.e.f. 04.10.2026)')).toBe('2026-10-04');
    expect(effectiveDateIn('W.E.F 1/9/2026')).toBe('2026-09-01');
    expect(effectiveDateIn('effective from 01-09-2026')).toBe('2026-09-01');
    expect(effectiveDateIn('no date here')).toBeNull();
    expect(effectiveDateIn('w.e.f. 45.13.2026')).toBeNull();
  });
});
