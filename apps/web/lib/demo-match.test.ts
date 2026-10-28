import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unpricedFunds } from '@fwos/data';
import { demoSearch, demoUnmatched } from './demo-match';
import { testDb } from './test-db';

/**
 * The public sample of "Funds without a price" is made by the same ranking and wording as the real page: one fund only its saved plan
 * and name can place (likely), one whose ISIN settles it although its name changed (certain), one nothing can settle (please choose).
 * And the count that Home and the e-mail show: held funds with no scheme that are not marked "not a listed fund".
 */
describe('the sample funds without a price', () => {
  const rows = demoUnmatched();
  const by = (id: string) => rows.find((r) => r.assetId === id)!;
  it('has three, each with the four parts', () => {
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r.proposal!.found).toContain('no price source');
      expect(r.proposal!.options.at(-1)!.label).toContain('not a listed fund');
    }
  });
  it('one is certain by its ISIN though the name differs', () => {
    const p = by('f9').proposal!;
    expect(by('f9').certainty).toBe('certain');
    expect(p.approve).toBe(
      'Approve: use Sample Large Cap Fund - Direct Plan - Growth Option (AMFI code 918010)',
    );
  });
  it('one is likely from the saved plan and the name, and offers Regular with its difference', () => {
    const p = by('f4').proposal!;
    expect(by('f4').certainty).toBe('medium');
    expect(p.recommended).toBe('918001');
    expect(p.options.find((o) => o.id === '918002')!.label).toContain('Regular instead of Direct');
    expect(p.options.find((o) => o.id === '918003')!.label).toContain('IDCW instead of Growth');
  });
  it('one is ambiguous: no Approve button, the best three listed, "please choose"', () => {
    const p = by('f10').proposal!;
    expect(by('f10').certainty).toBeNull();
    expect(p.approve).toBeNull();
    expect(p.suggest).toContain('please choose');
    expect(p.options.filter((o) => o.id !== 'none')).toHaveLength(3);
  });
  it('searches the invented list', () => {
    expect(demoSearch('sample value regular').map((h) => h.code)).toEqual(['918021', '918023']);
    expect(demoSearch('918010')[0]!.name).toBe(
      'Sample Large Cap Fund - Direct Plan - Growth Option',
    );
  });
});

describe('counting the funds with no price source', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 40_000 * Math.floor(Math.random() * 1e6));
  });
  const assets = [
    { id: 'a', type: 'mutual_fund', status: 'active', amfi_code: null },
    { id: 'b', type: 'mutual_fund', status: 'stopped', amfi_code: null },
    { id: 'c', type: 'mutual_fund', status: 'active', amfi_code: '120465' },
    { id: 'd', type: 'mutual_fund', status: 'closed', amfi_code: null },
    { id: 'e', type: 'mutual_fund', status: 'active', amfi_code: null },
    { id: 'f', type: 'bank_account', status: 'active', amfi_code: null },
  ];
  it('counts held funds with no scheme, leaving out the matched, the sold, other kinds and the ones marked not listed', async () => {
    const w = testDb({
      tables: {
        mf_positions: [
          { asset_id: 'a', household_id: 'h', no_price_source: false },
          { asset_id: 'e', household_id: 'h', no_price_source: true },
        ],
      },
    });
    const r = await unpricedFunds(w.db, assets);
    expect(r.waiting).toEqual(['a', 'b']);
    expect(r.notListed).toEqual(['e']);
  });
  it('before the database update that adds the mark, every unmatched held fund counts', async () => {
    const w = testDb({
      tables: { mf_positions: [{ asset_id: 'a', household_id: 'h' }] },
      missingColumns: { mf_positions: ['no_price_source'] },
    });
    const r = await unpricedFunds(w.db, assets);
    expect(r.waiting).toEqual(['a', 'b', 'e']);
  });
});
