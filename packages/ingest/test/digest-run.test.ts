import { describe, expect, it } from 'vitest';
import {
  runDigestTest,
  runDigests,
  type Claim,
  type DigestStore,
  type Mailer,
} from '../src/digest-run';

function setup(
  opts: {
    claims?: Claim[];
    members?: string[];
    extra?: string[];
    failSends?: number;
    buildFails?: boolean;
  } = {},
) {
  const sent: { to: string[]; subject: string }[] = [];
  const finished: { status: string; recipients: number; error?: string; providerId?: string }[] =
    [];
  const claims = [...(opts.claims ?? ['claimed'])];
  let failures = opts.failSends ?? 0;
  const store: DigestStore = {
    households: async () => [{ id: 'h1', name: 'Home', extraRecipients: opts.extra ?? [] }],
    memberEmails: async () => opts.members ?? ['a@example.test', 'b@example.test'],
    claim: async () => claims.shift() ?? 'claimed',
    finish: async (_h, _d, r) => void finished.push(r),
    build: async () => {
      if (opts.buildFails) throw new Error('database unavailable');
      return { subject: 'S', text: 't', html: '<p>t</p>' };
    },
  };
  const mailer: Mailer = {
    send: async (m) => {
      if (failures-- > 0) throw new Error('smtp 421');
      sent.push({ to: m.to, subject: m.subject });
      return { id: 'msg-1' };
    },
  };
  return { store, mailer, sent, finished };
}
const fast = { sleep: async () => {} };

describe('runDigests', () => {
  it('sends one message to every member and records only "accepted by provider"', async () => {
    const s = setup({ extra: ['mum@example.test'] });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', fast);
    expect(r[0]).toMatchObject({ outcome: 'sent', recipients: 3 });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toEqual(['a@example.test', 'b@example.test', 'mum@example.test']);
    expect(s.finished[0]).toMatchObject({ status: 'accepted_by_provider', providerId: 'msg-1' });
  });

  it('does not send twice for the same day', async () => {
    const s = setup({ claims: ['already_done'] });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', fast);
    expect(r[0]!.outcome).toBe('skipped_already_sent');
    expect(s.sent).toHaveLength(0);
    expect(
      setup({ claims: ['in_progress'] }) &&
        (await runDigests(setup({ claims: ['in_progress'] }).store, s.mailer, 'd', fast))[0]!
          .outcome,
    ).toBe('skipped_in_progress');
  });

  it('retries a failing mail server with backoff and succeeds', async () => {
    const waits: number[] = [];
    const s = setup({ failSends: 2 });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', {
      sleep: async (ms) => void waits.push(ms),
    });
    expect(r[0]!.outcome).toBe('sent');
    expect(waits).toEqual([1000, 2000]);
  });

  it('records a failure (never a fake success) when every attempt fails', async () => {
    const s = setup({ failSends: 5 });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', fast);
    expect(r[0]).toMatchObject({ outcome: 'failed', error: 'smtp 421' });
    expect(s.sent).toHaveLength(0);
    expect(s.finished[0]).toMatchObject({ status: 'failed', error: 'smtp 421' });
  });

  it('drops invalid and duplicate addresses and does not send to nobody', async () => {
    const s = setup({
      members: ['A@Example.test', 'a@example.test', 'not-an-email'],
      extra: ['x y@z'],
    });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', fast);
    expect(s.sent[0]!.to).toEqual(['a@example.test']);
    expect(r[0]!.recipients).toBe(1);
    const none = setup({ members: [], extra: [] });
    expect((await runDigests(none.store, none.mailer, 'd', fast))[0]!.outcome).toBe(
      'no_recipients',
    );
    expect(none.sent).toHaveLength(0);
  });

  it('turns an unexpected error into a logged failure for that household only', async () => {
    const s = setup({ buildFails: true });
    const r = await runDigests(s.store, s.mailer, '2026-10-26', fast);
    expect(r[0]).toMatchObject({ outcome: 'failed', error: 'database unavailable' });
    expect(s.finished[0]!.status).toBe('failed');
  });
});

describe('runDigestTest', () => {
  it('sends one [Test] message to the people who can sign in, not the extra recipients, and writes no log', async () => {
    const s = setup({ extra: ['mum@example.test'], claims: ['already_done'] });
    const r = await runDigestTest(s.store, s.mailer, '2026-10-26');
    expect(r[0]).toMatchObject({ outcome: 'sent', recipients: 2 });
    expect(s.sent).toHaveLength(1);
    expect(s.sent[0]!.to).toEqual(['a@example.test', 'b@example.test']);
    expect(s.sent[0]!.subject).toBe('[Test] S');
    // it never claims the day, so a real summary is neither used up nor blocked
    expect(s.finished).toHaveLength(0);
  });

  it('reports a household with nobody to send to, and a failure, without stopping', async () => {
    expect(
      (await runDigestTest(setup({ members: [] }).store, setup().mailer, 'd'))[0]!.outcome,
    ).toBe('no_recipients');
    const bad = await runDigestTest(setup({ buildFails: true }).store, setup().mailer, 'd');
    expect(bad[0]).toMatchObject({ outcome: 'failed', error: 'database unavailable' });
    const smtp = await runDigestTest(setup().store, setup({ failSends: 1 }).mailer, 'd');
    expect(smtp[0]).toMatchObject({ outcome: 'failed', error: 'smtp 421' });
  });
});
