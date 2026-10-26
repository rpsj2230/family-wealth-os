import { describe, expect, it } from 'vitest';
import { buildRatesRequest, htmlToText, parseRatesResponse } from '../src/rates-ai';

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
      },
      {
        bank: 'Sample Bank',
        product: 'savings',
        accountKind: 'resident',
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
