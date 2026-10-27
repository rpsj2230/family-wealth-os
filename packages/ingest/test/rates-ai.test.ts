import { describe, expect, it } from 'vitest';
import { buildRatesRequest, focusRates, htmlToText, parseRatesResponse } from '../src/rates-ai';

const wrap = (offers: unknown) => ({
  choices: [{ message: { content: JSON.stringify({ offers }) } }],
});

describe('htmlToText', () => {
  it('keeps the visible words and table structure, drops scripts and tags', () => {
    const t = htmlToText(
      '<html><script>var x=1</script><style>a{}</style><table><tr><td>1 year</td><td>7.25%</td></tr></table><p>NRE&nbsp;rates &amp; more</p></html>',
    );
    expect(t).toContain('1 year | 7.25%');
    expect(t).toContain('NRE rates & more');
    expect(t).not.toContain('var x');
  });
  it('caps the length', () => {
    expect(htmlToText('<p>' + 'x'.repeat(100_000) + '</p>').length).toBe(30_000);
  });
});

describe('parseRatesResponse', () => {
  it('turns percent into a fraction and keeps valid rows', () => {
    const r = parseRatesResponse(
      'groq',
      wrap([
        {
          product: 'fd',
          accountKind: 'NRE',
          tenureFromMonths: 12,
          tenureToMonths: 23,
          ratePct: 7.25,
          conditions: 'senior +0.5%',
        },
        {
          product: 'savings',
          accountKind: 'resident',
          ratePct: '4%',
          tenureFromMonths: 0,
          tenureToMonths: 0,
        },
      ]),
      'Sample Bank',
    );
    expect(r).toEqual([
      {
        bank: 'Sample Bank',
        product: 'fd',
        accountKind: 'NRE',
        tenureFromMonths: 12,
        tenureToMonths: 23,
        rate: 0.0725,
        conditions: 'senior +0.5%',
        balanceFrom: null,
        balanceTo: null,
      },
      {
        bank: 'Sample Bank',
        product: 'savings',
        accountKind: 'resident',
        balanceFrom: null,
        balanceTo: null,
        tenureFromMonths: 0,
        tenureToMonths: 0,
        rate: 0.04,
        conditions: null,
      },
    ]);
  });
  it('drops impossible rates, bad tenures, unknown products and duplicates', () => {
    const r = parseRatesResponse(
      'groq',
      wrap([
        { product: 'fd', ratePct: 72, tenureFromMonths: 12, tenureToMonths: 12 },
        { product: 'fd', ratePct: 7, tenureFromMonths: 24, tenureToMonths: 12 },
        { product: 'loan', ratePct: 9 },
        { product: 'fd', ratePct: 7, tenureFromMonths: 12, tenureToMonths: 12 },
        { product: 'fd', ratePct: 8, tenureFromMonths: 12, tenureToMonths: 12 },
      ]),
      'B',
    );
    expect(r).toHaveLength(1);
    expect(r[0]!.rate).toBe(0.07);
  });
  it('returns nothing for broken output and survives the Gemini shape', () => {
    expect(
      parseRatesResponse('groq', { choices: [{ message: { content: 'sorry' } }] }, 'B'),
    ).toEqual([]);
    const gem = {
      candidates: [
        {
          content: {
            parts: [
              {
                text: '{"offers":[{"product":"fd","ratePct":6.5,"tenureFromMonths":6,"tenureToMonths":11}]}',
              },
            ],
          },
        },
      ],
    };
    expect(parseRatesResponse('gemini', gem, 'B')[0]).toMatchObject({
      rate: 0.065,
      tenureFromMonths: 6,
    });
  });
  it('asks for the right bank and puts the key in the header, not the address', () => {
    const q = buildRatesRequest('gemini', 'KEY', 'Sample Bank', 'page text');
    expect(q.init.body).toContain('Sample Bank');
    expect(q.url).not.toContain('KEY');
  });
});

describe('parseRatesResponse: savings slabs and what is ignored', () => {
  const wrapIt = (offers: unknown[]) => ({
    choices: [{ message: { content: JSON.stringify({ offers }) } }],
  });
  it('keeps each savings slab and drops NRO deposits', () => {
    const r = parseRatesResponse(
      'groq',
      wrapIt([
        {
          product: 'savings',
          accountKind: 'any',
          ratePct: 2.5,
          balanceFromRupees: 0,
          balanceToRupees: 100000,
        },
        {
          product: 'savings',
          accountKind: 'any',
          ratePct: 3.5,
          balanceFromRupees: 100000,
          balanceToRupees: 500000,
        },
        {
          product: 'savings',
          accountKind: 'any',
          ratePct: 7,
          balanceFromRupees: 5000000,
          balanceToRupees: null,
        },
        { product: 'fd', accountKind: 'NRO', tenureFromMonths: 24, tenureToMonths: 24, ratePct: 7 },
        { product: 'fd', accountKind: 'NRE', tenureFromMonths: 24, tenureToMonths: 24, ratePct: 8 },
        {
          product: 'savings',
          accountKind: 'any',
          ratePct: 3,
          balanceFromRupees: 500000,
          balanceToRupees: 100,
        },
      ]),
      'Jana',
    );
    expect(r.map((o) => [o.product, o.rate, o.balanceFrom, o.balanceTo])).toEqual([
      ['savings', 0.025, null, 100000],
      ['savings', 0.035, 100000, 500000],
      ['savings', 0.07, 5000000, null],
      ['fd', 0.08, null, null],
    ]);
  });
});

describe('buildRatesRequest: corrections are passed to the reader', () => {
  it('adds the rules for the bank to the instructions, and nothing when there are none', () => {
    const plain = JSON.stringify(buildRatesRequest('groq', 'k', 'Jana', 'page text'));
    const hinted = JSON.stringify(
      buildRatesRequest('groq', 'k', 'Jana', 'page text', undefined, [
        'For NRE fixed deposit, 24 months: the right rate is 8%.',
      ]),
    );
    expect(plain).not.toContain('Known corrections');
    expect(hinted).toContain('Known corrections for this bank');
    expect(hinted).toContain('the right rate is 8%');
  });
});

describe('the most you would put with one bank', () => {
  const wrapIt = (offers: unknown[]) => ({
    choices: [{ message: { content: JSON.stringify({ offers }) } }],
  });
  const slabs = [
    {
      product: 'savings',
      accountKind: 'any',
      ratePct: 3,
      balanceFromRupees: 0,
      balanceToRupees: 5_000_000,
    },
    {
      product: 'savings',
      accountKind: 'any',
      ratePct: 4,
      balanceFromRupees: 5_000_000,
      balanceToRupees: 20_000_000,
    },
    {
      product: 'savings',
      accountKind: 'any',
      ratePct: 7.5,
      balanceFromRupees: 10_000_000,
      balanceToRupees: null,
    },
  ];
  it('drops a savings slab that starts at or above the ceiling and keeps one that reaches into the range below it', () => {
    const r = parseRatesResponse('groq', wrapIt(slabs), 'X', { maxAmount: 10_000_000 });
    expect(r.map((o) => o.rate)).toEqual([0.03, 0.04]);
  });
  it('keeps everything when no ceiling is given', () => {
    expect(parseRatesResponse('groq', wrapIt(slabs), 'X')).toHaveLength(3);
  });
  it('tells the reader about the ceiling', () => {
    const req = buildRatesRequest('groq', 'k', 'X', 'page', undefined, [], 10_000_000);
    expect(JSON.stringify(req.init.body)).toContain('1,00,00,000');
  });
});

describe('reading a long bank page', () => {
  const table = (title: string) =>
    `<h3>${title}</h3><table>${Array.from({ length: 12 }, (_, i) => `<tr><td>${i + 1} year</td><td>6.${i}0%</td></tr>`).join('')}</table>`;
  it('finds a rate table that sits far into a page full of menus', () => {
    const html = `<html><title>FD rates</title><body>${'<li>Menu item and notices</li>'.repeat(3000)}${table('Below 3 Crore')}${'<p>Notice</p>'.repeat(500)}${table('3 Crore and above')}</body></html>`;
    const text = htmlToText(html, 8000);
    expect(text.length).toBeLessThanOrEqual(8200);
    expect(text).toContain('Below 3 Crore');
    expect(text).toContain('3 Crore and above');
    expect(text).toContain('6.50%');
  });
  it('reads a table that the page carries as escaped markup in its text', () => {
    const html =
      '<div>&lt;table&gt;&lt;tr&gt;&lt;td class=&#34;x&#34;&gt;7 - 14 days&lt;/td&gt;&lt;td&gt;2.75%&lt;/td&gt;&lt;/tr&gt;&lt;/table&gt;</div>';
    const text = htmlToText(html);
    expect(text).toContain('7 - 14 days');
    expect(text).toContain('2.75%');
    expect(text).not.toMatch(/<td|&#34;/);
  });
  it('leaves a short page alone', () => {
    expect(focusRates('short 5% page', 1000)).toBe('short 5% page');
  });
});
