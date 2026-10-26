import { describe, expect, it } from 'vitest';
import {
  exitLoadPercentText,
  matchProgress,
  orderForMatching,
  parseExitLoad,
  type MatchableFund,
} from './match-funds';

const f = (name: string, amfiCode: string | null, sipStopped = false): MatchableFund => ({
  assetId: name,
  name,
  amfiCode,
  sipStopped,
});

describe('matching progress', () => {
  it('counts matched and pending funds', () => {
    expect(matchProgress([f('a', '1'), f('b', null), f('c', null)])).toEqual({
      matched: 1,
      total: 3,
      pending: 2,
    });
    expect(matchProgress([])).toEqual({ matched: 0, total: 0, pending: 0 });
  });
  it('puts funds that need a decision first, running SIPs before stopped ones', () => {
    const order = orderForMatching([
      f('Zed', '9'),
      f('Beta', null, true),
      f('Alpha', '2'),
      f('Gamma', null),
    ]).map((x) => x.name);
    expect(order).toEqual(['Gamma', 'Beta', 'Alpha', 'Zed']);
  });
});

describe('exit load', () => {
  it('shows a stored fraction as clean percent', () => {
    expect(exitLoadPercentText(0.01)).toBe('1');
    expect(exitLoadPercentText(0.0025)).toBe('0.25');
    expect(exitLoadPercentText(0.07)).toBe('7');
    expect(exitLoadPercentText(null)).toBe('');
  });
  it('turns the form into a fraction and days, or clears it', () => {
    expect(parseExitLoad('1', '365')).toEqual({ clear: false, fraction: 0.01, days: 365 });
    expect(parseExitLoad('0.25 %', '30')).toEqual({ clear: false, fraction: 0.0025, days: 30 });
    expect(parseExitLoad('', '')).toEqual({ clear: true });
  });
  it('refuses nonsense', () => {
    expect(parseExitLoad('11', '30')).toBeNull();
    expect(parseExitLoad('1', '12.5')).toBeNull();
    expect(parseExitLoad('1', '5000')).toBeNull();
    expect(parseExitLoad('abc', '30')).toBeNull();
  });
});
