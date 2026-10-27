import { describe, expect, it } from 'vitest';
import { chipsOf } from '@fwos/core';
import { demoFundPreview } from './demo-fund-import';

describe('the sample fund-statement preview', () => {
  const [anil, beena] = demoFundPreview();
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
  it('carries no write set to the browser', () => {
    for (const i of anil!.diff.items) expect('write' in i).toBe(false);
  });
});
