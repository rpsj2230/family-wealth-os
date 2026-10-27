import { describe, expect, it } from 'vitest';
import {
  depositListState,
  effectiveDepositStatus,
  isPastMaturity,
  maturedRuleText,
} from '../src/deposit-state';

const today = '2026-10-26';
const N = 60;
const state = (o: { status?: string; maturityOn: string; endedOn?: string | null }) =>
  depositListState({ status: 'active', today, hideAfterDays: N, ...o });

describe('isPastMaturity and the status a deposit is valued with', () => {
  it('a deposit maturing today has not passed yet; from tomorrow it has', () => {
    expect(isPastMaturity('2026-10-26', today)).toBe(false);
    expect(isPastMaturity('2026-10-25', today)).toBe(true);
    expect(effectiveDepositStatus('active', '2026-10-26', today)).toBe('active');
    expect(effectiveDepositStatus('active', '2026-10-25', today)).toBe('matured_unconfirmed');
  });
  it('only an active deposit is turned into "matured, not confirmed"; other statuses are kept', () => {
    for (const s of ['matured', 'renewed', 'closed', 'matured_unconfirmed', 'gifted'])
      expect(effectiveDepositStatus(s, '2020-01-01', today)).toBe(s);
  });
});

describe('depositListState', () => {
  it('shows a running deposit, and one maturing today', () => {
    expect(state({ maturityOn: '2027-03-01' })).toBe('show');
    expect(state({ maturityOn: today })).toBe('show');
  });
  it('asks to confirm a deposit that matured inside the window and was not confirmed', () => {
    expect(state({ maturityOn: '2026-10-25' })).toBe('confirm');
    expect(state({ maturityOn: '2026-10-25', status: 'matured_unconfirmed' })).toBe('confirm');
  });
  it('window edges: exactly N days ago is still listed, N + 1 is hidden', () => {
    expect(state({ maturityOn: '2026-08-27' })).toBe('confirm'); // 60 days ago
    expect(state({ maturityOn: '2026-08-26' })).toBe('hidden'); // 61 days ago
    expect(state({ maturityOn: '2026-08-27', status: 'matured_unconfirmed' })).toBe('confirm');
    expect(state({ maturityOn: '2026-08-26', status: 'matured_unconfirmed' })).toBe('hidden');
  });
  it('hides a confirmed matured, renewed or closed deposit at once, whatever its date', () => {
    for (const status of ['matured', 'renewed', 'closed'])
      expect(state({ maturityOn: '2026-10-20', status })).toBe('hidden');
    expect(state({ maturityOn: '2027-05-01', status: 'closed' })).toBe('hidden');
  });
  it('hides an old one whatever its status, even one still marked active', () => {
    expect(state({ maturityOn: '2024-03-01' })).toBe('hidden');
    expect(state({ maturityOn: '2021-10-10', status: 'gifted' })).toBe('hidden');
  });
  it('uses the day it ended (from the History import) when there is one', () => {
    // matured later on paper, but the monthly tabs say it ended long ago
    expect(state({ maturityOn: '2026-10-01', endedOn: '2026-01-01' })).toBe('hidden');
    expect(state({ maturityOn: '2026-01-01', endedOn: '2026-10-01', status: 'stopped' })).toBe(
      'show',
    );
    expect(state({ maturityOn: '2021-12-10', endedOn: '2021-11-01', status: 'closed' })).toBe(
      'hidden',
    );
  });
  it('follows the Setting', () => {
    const at = (days: number) =>
      depositListState({ status: 'active', maturityOn: '2026-10-06', today, hideAfterDays: days });
    expect(at(20)).toBe('confirm');
    expect(at(19)).toBe('hidden');
    expect(at(3650)).toBe('confirm');
  });
});

describe('maturedRuleText', () => {
  it('states the rule, the Setting and the number of days', () => {
    const t = maturedRuleText(45);
    expect(t).toContain('45 days');
    expect(t).toContain('Hide a matured deposit from the lists after (days)');
    expect(t).toContain('maturing today still counts');
    expect(maturedRuleText()).toContain('60 days');
  });
});
