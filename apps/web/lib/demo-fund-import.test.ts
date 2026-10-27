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
    expect(chipsOf(items[0]!).map((c) => c.label)).toEqual(['Not on this statement: check']);
    expect(charu!.diff.items.some((i) => i.kind === 'sold')).toBe(false);
  });
  it('carries no write set to the browser', () => {
    for (const i of anil!.diff.items) expect('write' in i).toBe(false);
  });
});
