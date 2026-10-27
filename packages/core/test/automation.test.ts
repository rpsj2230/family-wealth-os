import { describe, expect, it } from 'vitest';
import { agoText, buildAutomationCards, isoDaysBetween, type AutomationInput } from '../src';

const base: AutomationInput = {
  today: '2026-10-26',
  inbox: {
    lastLoggedAt: '2026-10-25T08:20:00Z',
    week: { applied: 2, needs_review: 1, ignored: 3, error: 0 },
    waiting: 1,
    aiReady: true,
    label: 'FWOS/Inbox',
  },
  market: { navLatest: '2026-10-23', fxLatest: '2026-10-26' },
  digest: {
    enabled: true,
    last: {
      date: '2026-10-26',
      status: 'accepted_by_provider',
      channel: 'email',
      recipients: 2,
      error: null,
    },
  },
  rates: { sources: 3, lastRunOn: '2026-10-25' },
};
const card = (i: AutomationInput, key: string) =>
  buildAutomationCards(i).find((c) => c.key === key)!;

describe('dates', () => {
  it('counts days and says them in words', () => {
    expect(isoDaysBetween('2026-10-20', '2026-10-26')).toBe(6);
    expect(agoText('2026-10-26', '2026-10-26')).toBe('today');
    expect(agoText('2026-10-25', '2026-10-26')).toBe('yesterday');
    expect(agoText('2026-10-20T10:00:00Z', '2026-10-26')).toBe('6 days ago');
  });
});

describe('automation cards', () => {
  it('shows everything healthy', () => {
    const cards = buildAutomationCards(base);
    expect(cards.map((c) => c.key)).toEqual(['email', 'market', 'digest', 'rates']);
    expect(cards.every((c) => c.tone === 'ok')).toBe(true);
    expect(card(base, 'email').lines.join(' ')).toContain('1 waiting for your review');
  });
  it('does not call a quiet mailbox a failure', () => {
    const c = card(
      { ...base, inbox: { ...base.inbox, lastLoggedAt: '2026-09-01T00:00:00Z' } },
      'email',
    );
    expect(c.tone).toBe('info');
    expect(c.status).toBe('Quiet for 55 days');
  });
  it('asks for the first email when there is none, and warns about failures', () => {
    expect(card({ ...base, inbox: { ...base.inbox, lastLoggedAt: null } }, 'email').status).toBe(
      'Waiting for the first email',
    );
    expect(
      card({ ...base, inbox: { ...base.inbox, week: { ...base.inbox.week, error: 2 } } }, 'email')
        .tone,
    ).toBe('warn');
  });
  it('flags stale market data', () => {
    const m = (navLatest: string | null) =>
      card({ ...base, market: { navLatest, fxLatest: null } }, 'market');
    expect(m('2026-10-20').tone).toBe('warn');
    expect(m('2026-10-01').tone).toBe('bad');
    expect(m(null).status).toBe('No data yet');
  });
  it('reports the daily summary honestly', () => {
    expect(card({ ...base, digest: { enabled: false, last: null } }, 'digest').status).toBe(
      'Switched off',
    );
    const failed = card(
      {
        ...base,
        digest: { enabled: true, last: { ...base.digest.last!, status: 'failed', error: 'login' } },
      },
      'digest',
    );
    expect(failed.tone).toBe('bad');
    expect(failed.lines[0]).toContain('login');
    const late = card(
      { ...base, digest: { enabled: true, last: { ...base.digest.last!, date: '2026-10-20' } } },
      'digest',
    );
    expect(late.status).toBe('Late');
  });
  it('handles rate pages not set up', () => {
    expect(card({ ...base, rates: { sources: 0, lastRunOn: null } }, 'rates').status).toBe(
      'No pages set',
    );
  });
});
