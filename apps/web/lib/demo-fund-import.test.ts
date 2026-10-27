import { describe, expect, it } from 'vitest';
import { chipsOf } from '@fwos/core';
import { demoFundPreview } from './demo-fund-import';

describe('the sample fund-statement preview', () => {
  const [anil, beena, charu] = demoFundPreview();
  const by = (n: string) => anil!.diff.items.find((i) => i.name.includes(n))!;
  it('shows every kind of change the preview can propose', () => {
    expect(by('Flexi').lines.newCount).toBe(2);
    expect(by('Flexi').units).toEqual({ before: 1200.25, after: 1450.5 });
    expect(by('Large Cap').sip!.kind).toBe('stopped');
    expect(by('Large Cap').sip!.effectiveOn).toBe('2026-04-05');
    expect(by('Index').sip).toMatchObject({ kind: 'changed', before: 5000, after: 8000 });
    expect(by('Old Fund').kind).toBe('sold');
    expect(by('Old Fund').why).toContain('lists all your funds');
    expect(by('Balanced').kind).toBe('unchanged');
    const mid = beena!.diff.items.find((i) => i.name.includes('Mid Cap'))!;
    expect(chipsOf(mid).map((c) => c.label)).toEqual(['New fund', '+4 transactions', 'SIP new']);
    expect(mid.sip!.kind).toBe('new');
  });
  it('shows what the statement replaces, adds and confirms for a fund with lines from other sources', () => {
    const flexi = by('Flexi');
    expect(flexi.lines.replace).toMatchObject({ count: 2, bySource: { csv: 1, estimate: 1 } });
    expect(flexi.lines.duplicateCount).toBe(6);
    expect(chipsOf(flexi).map((c) => c.label)).toContain('2 replaced');
  });
  it('does not call funds sold when the statement is keyed on an email address', () => {
    const items = charu!.diff.items.filter((i) => i.kind === 'review');
    expect(items.map((i) => i.name)).toEqual([
      'Sample Dividend Fund - Direct Growth',
      'Sample Tax Saver Fund - Direct Growth',
    ]);
    expect(chipsOf(items[0]!).map((c) => c.label)).toEqual(['Not on this statement']);
    expect(charu!.diff.items.some((i) => i.kind === 'sold')).toBe(false);
  });
  it('carries no write set to the browser', () => {
    for (const p of demoFundPreview())
      for (const i of p.diff.items) {
        expect('write' in i).toBe(false);
        for (const outs of Object.values(i.prompt?.outcomes ?? {}))
          for (const o of outs) expect('write' in o).toBe(false);
      }
  });
  it('shows a question for each case: two folios of one scheme, a scheme with no evidence, a fund not listed, a SIP not judged', () => {
    const core = beena!.diff.items.filter((i) => i.name.includes('Core'));
    expect(core.map((i) => i.prompt!.suggestion.recommended)).toEqual(['link:v1', 'link:v2']);
    expect(core[0]!.prompt!.suggestion.suggest).toBe(
      'Link folio …8540 to your fund "Sample Core Fund - Direct Growth".',
    );
    expect(core[0]!.prompt!.suggestion.why).toContain('not the folio on file (…1111)');
    expect(core[1]!.prompt!.suggestion.why).toContain('not on file yet');
    const hybrid = beena!.diff.items.find((i) => i.name.includes('Hybrid'))!;
    expect(hybrid.prompt!.suggestion.approve).toBeNull();
    expect(hybrid.prompt!.suggestion.suggest).toContain('I cannot tell');
    const dividend = charu!.diff.items.find((i) => i.name.includes('Dividend'))!;
    expect(dividend.prompt!.start).toBe('keep');
    expect(dividend.prompt!.suggestion.why).toContain('keyed on an email address');
    expect(chipsOf(dividend).map((c) => c.label)).toEqual(['Not on this statement']);
    const bond = charu!.diff.items.find((i) => i.name.includes('Bond'))!;
    expect(bond.sipPrompt!.suggestion.recommended).toBe('keep');
    expect(chipsOf(bond).map((c) => c.label)).toEqual([]);
    // no old red "Needs a look" anywhere in the sample
    expect(JSON.stringify(demoFundPreview())).not.toMatch(/Needs a look|check its ISIN or folio/);
  });
});
