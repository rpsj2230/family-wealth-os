import { describe, expect, it } from 'vitest';
import { plannerRedirect } from './rates-redirect';

describe('plannerRedirect', () => {
  it('sends an old planner address to New money with the same parameters', () => {
    expect(
      plannerRedirect({ amount: '2500000', kind: 'NRO', who: 'p1', joint: 'on', with: 'p2' }),
    ).toBe('/new-money?amount=2500000&who=p1&joint=on&with=p2&kind=NRO');
  });
  it('keeps an empty planner address working', () => {
    expect(plannerRedirect({ amount: '' })).toBe('/new-money');
  });
  it('leaves ordinary Rates addresses alone, including the board and best-rates filters', () => {
    expect(plannerRedirect({})).toBeNull();
    expect(plannerRedirect({ view: 'all', sort: 'saving' })).toBeNull();
    expect(plannerRedirect({ product: 'fd', fk: 'NRE', ft: '24' })).toBeNull();
    expect(plannerRedirect({ kind: 'NRE' })).toBeNull();
  });
});
