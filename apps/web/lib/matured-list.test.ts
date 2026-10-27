import { describe, expect, it } from 'vitest';
import {
  CONFIRMED_NOTICE,
  hiddenSentence,
  maturedHref,
  NOT_COUNTED_NOTE,
  showsMatured,
} from './matured-list';

describe('matured deposits: words and addresses', () => {
  it('reads ?matured=all and nothing else as "show them"', () => {
    expect(showsMatured('all')).toBe(true);
    expect(showsMatured(['all'])).toBe(true);
    expect(showsMatured(undefined)).toBe(false);
    expect(showsMatured('1')).toBe(false);
  });

  it('says how many are hidden, or shown dimmed', () => {
    expect(hiddenSentence({ hidden: 1, confirmed: 1 }, false)).toBe(
      '1 older or confirmed matured deposit is hidden.',
    );
    expect(hiddenSentence({ hidden: 4, confirmed: 2 }, false)).toBe(
      '4 older or confirmed matured deposits are hidden.',
    );
    expect(hiddenSentence({ hidden: 4, confirmed: 2 }, true)).toBe(
      'Showing 4 older or confirmed matured deposits, dimmed.',
    );
  });

  it('builds the toggle address, keeping the other choices', () => {
    expect(maturedHref('/accounts', {}, true)).toBe('/accounts?matured=all');
    expect(maturedHref('/accounts', { p: 'abc' }, true)).toBe('/accounts?p=abc&matured=all');
    expect(maturedHref('/deposits', { tab: 'maturities', p: null, g: undefined }, false)).toBe(
      '/deposits?tab=maturities',
    );
    expect(maturedHref('/accounts', { matured: 'all' }, false)).toBe('/accounts');
  });

  it('has the sentences the person reads', () => {
    expect(CONFIRMED_NOTICE).toBe(
      'Marked as matured. It is hidden from the list; Show matured brings it back.',
    );
    expect(NOT_COUNTED_NOTE).toBe(
      'Counted in the savings account or a new deposit once you record it',
    );
  });
});
