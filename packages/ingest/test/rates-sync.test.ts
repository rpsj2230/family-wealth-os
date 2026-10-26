import { describe, expect, it } from 'vitest';
import type { ParsedOffer } from '../src/rates-ai';
import { diagnoseMisread, planSync, slotKey, slotLabel, type StoredOffer } from '../src/rates-sync';

const fd = (o: Partial<ParsedOffer> = {}): ParsedOffer => ({
  bank: 'Jana Small Finance Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFromMonths: 24,
  tenureToMonths: 24,
  rate: 0.08,
  conditions: null,
  balanceFrom: null,
  balanceTo: null,
  ...o,
});
const stored = (o: Partial<StoredOffer> = {}): StoredOffer => ({
  id: 'a',
  bank: 'Jana Small Finance Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFromMonths: 24,
  tenureToMonths: 24,
  balanceFrom: null,
  balanceTo: null,
  rate: 0.08,
  sourceKind: 'ai',
  aiRate: null,
  correctionReason: null,
  misreadCount: 0,
  ...o,
});

describe('slotKey and slotLabel', () => {
  it('ignores bank spelling and describes the slot', () => {
    expect(slotKey(fd({ bank: 'JANA bank' }))).toBe(slotKey(fd({ bank: 'jana-bank' })));
    expect(slotLabel(fd())).toBe('NRE fixed deposit, 24 months');
    expect(
      slotLabel({
        ...fd(),
        product: 'savings',
        accountKind: 'any',
        balanceFrom: 500_000,
        balanceTo: null,
      }),
    ).toBe('savings, balance above ₹5 L');
  });
});

describe('planSync', () => {
  it('adds new slots, updates changed ones and only re-checks the unchanged', () => {
    const p = planSync(
      [
        stored({ id: 'a', rate: 0.08 }),
        stored({ id: 'b', tenureFromMonths: 12, tenureToMonths: 12, rate: 0.07 }),
      ],
      [
        fd({ rate: 0.0825 }),
        fd({ tenureFromMonths: 12, tenureToMonths: 12, rate: 0.07 }),
        fd({ tenureFromMonths: 36, tenureToMonths: 36 }),
      ],
      { replaceAbsent: true },
    );
    expect(p.change).toEqual([{ id: 'a', from: 0.08, to: 0.0825 }]);
    expect(p.confirm).toEqual(['b']);
    expect(p.insert).toHaveLength(1);
    expect(p.remove).toEqual([]);
  });
  it('removes reader-owned slots that left the page, never typed ones', () => {
    const p = planSync(
      [
        stored({ id: 'gone' }),
        stored({ id: 'mine', tenureFromMonths: 60, tenureToMonths: 60, sourceKind: 'manual' }),
      ],
      [fd({ tenureFromMonths: 12, tenureToMonths: 12 })],
      { replaceAbsent: true },
    );
    expect(p.remove).toEqual(['gone']);
  });
  it('never applies the page over a typed rate, but shows the difference', () => {
    const typed = stored({ sourceKind: 'manual', rate: 0.0825 });
    expect(planSync([typed], [fd({ rate: 0.08 })], { replaceAbsent: false }).pageDiffers).toEqual([
      { id: 'a', pageRate: 0.08 },
    ]);
    expect(planSync([typed], [fd({ rate: 0.0825 })], { replaceAbsent: false }).pageAgrees).toEqual([
      'a',
    ]);
  });
  describe('after you corrected a rate the reader got wrong', () => {
    const corrected = stored({
      sourceKind: 'manual',
      rate: 0.08,
      aiRate: 0.085,
      correctionReason: 'senior_citizen',
    });
    it('hands the rate back when the page now says what you said', () => {
      expect(
        planSync([corrected], [fd({ rate: 0.08 })], { replaceAbsent: false }).resolved,
      ).toEqual(['a']);
    });
    it('keeps your figure and explains when the reader repeats the mistake', () => {
      const p = planSync([corrected], [fd({ rate: 0.085 })], { replaceAbsent: false });
      expect(p.resolved).toEqual([]);
      expect(p.stillMisread[0]).toMatchObject({ id: 'a', wrong: 0.085, right: 0.08 });
      expect(p.stillMisread[0]!.diagnosis.cause).toBe('senior_citizen');
      expect(p.stillMisread[0]!.diagnosis.hint).toContain('regular (non-senior) column');
    });
    it('notices when the page moved on from both figures', () => {
      expect(
        planSync([corrected], [fd({ rate: 0.0775 })], { replaceAbsent: false }).pageMoved,
      ).toEqual([{ id: 'a', pageRate: 0.0775 }]);
    });
  });
});

describe('diagnoseMisread', () => {
  const slot = fd();
  it('uses the reason you gave', () => {
    expect(
      diagnoseMisread({ slot, wrong: 0.09, right: 0.08, fetched: [], reason: 'nro_nre' }).cause,
    ).toBe('nro_nre');
  });
  it('spots a senior-citizen premium of about half a point', () => {
    expect(diagnoseMisread({ slot, wrong: 0.0855, right: 0.08, fetched: [] }).cause).toBe(
      'senior_citizen',
    );
  });
  it('spots a neighbouring tenure band', () => {
    const fetched = [fd({ tenureFromMonths: 12, tenureToMonths: 12, rate: 0.095 }), fd()];
    const d = diagnoseMisread({ slot, wrong: 0.095, right: 0.08, fetched });
    expect(d.cause).toBe('wrong_tenure');
    expect(d.hint).toContain('neighbouring tenure band');
  });
  it('spots NRE and NRO mixed up', () => {
    const fetched = [fd({ accountKind: 'NRO', rate: 0.1 }), fd()];
    expect(diagnoseMisread({ slot, wrong: 0.1, right: 0.08, fetched }).cause).toBe('nro_nre');
  });
  it('spots a neighbouring savings slab', () => {
    const sav = (o: Partial<ParsedOffer>) =>
      fd({ product: 'savings', accountKind: 'any', tenureFromMonths: 0, tenureToMonths: 0, ...o });
    const s = sav({ balanceFrom: 500_000, balanceTo: null, rate: 0.07 });
    const d = diagnoseMisread({
      slot: s,
      wrong: 0.0675,
      right: 0.07,
      fetched: [sav({ balanceFrom: 100_000, balanceTo: 500_000, rate: 0.0675 }), s],
    });
    expect(d.cause).toBe('wrong_slab');
  });
  it('falls back to a plain statement of the difference', () => {
    const d = diagnoseMisread({ slot, wrong: 0.0913, right: 0.08, fetched: [] });
    expect(d.cause).toBe('other');
    expect(d.hint).toBe(
      'For NRE fixed deposit, 24 months: the right rate is 8%; it had been read as 9.13%.',
    );
  });
});
