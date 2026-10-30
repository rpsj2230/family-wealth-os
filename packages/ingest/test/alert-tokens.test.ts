import { describe, expect, it } from 'vitest';
import { alertLinkKey, alertToken, hashToken } from '../src/alert-tokens';

const key = alertLinkKey('a-server-secret-of-some-length');
const H = '11111111-2222-3333-4444-555555555555';
const A = '2026-10-01T00:20:00.000Z';

describe('alert link tokens', () => {
  it('gives the same token for the same absence, so every reminder carries a working link', () => {
    const t = alertToken(key, 'confirm', H, A, 0);
    expect(alertToken(key, 'confirm', H, A, 0)).toBe(t);
    // the same instant written the way Postgres returns it
    expect(alertToken(key, 'confirm', H, '2026-10-01 00:20:00+00', 0)).toBe(t);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('gives a different token for a new absence, another person, the other purpose, another household or another secret', () => {
    const t = alertToken(key, 'confirm', H, A, 0);
    expect(alertToken(key, 'confirm', H, '2026-11-20T08:00:00Z', 0)).not.toBe(t);
    expect(alertToken(key, 'confirm', H, A, 1)).not.toBe(t);
    expect(alertToken(key, 'postpone', H, A, 0)).not.toBe(t);
    expect(alertToken(key, 'confirm', 'another-household', A, 0)).not.toBe(t);
    expect(alertToken(alertLinkKey('a-different-server-secret'), 'confirm', H, A, 0)).not.toBe(t);
  });

  it('stores only a sha256 hex of the token', () => {
    const t = alertToken(key, 'postpone', H, A, -1);
    const h = hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain(t);
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('refuses a short secret and an absence without a valid start', () => {
    expect(() => alertLinkKey('short')).toThrow(/too short/);
    expect(() => alertToken(key, 'confirm', H, 'not a date', 0)).toThrow(/valid start/);
  });
});
