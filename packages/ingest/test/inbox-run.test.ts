import { describe, expect, it } from 'vitest';
import { runInbox, type InboxIo, type InboxMessage, type InboxRow } from '../src/inbox-run';
import type { BalanceReading, KnownAccount } from '../src/bank-email';

const HDFC = `Available balance in your account ending XX7240 is Rs. INR 10,711.96 as on 25-OCT-26.`;
const accounts: KnownAccount[] = [
  {
    assetId: 'hdfc1',
    institution: 'HDFC Bank',
    last4: '7240',
    currency: 'INR',
    type: 'bank_account',
  },
];
const msg = (o: Partial<InboxMessage> = {}): InboxMessage => ({
  messageId: 'm1',
  from: 'HDFC Bank <alerts@hdfcbank.bank.in>',
  subject: 'View: Account update for your HDFC Bank A/c',
  text: HDFC,
  receivedOn: '2026-10-26',
  attachments: [],
  ...o,
});

function fakeIo(
  over: Partial<InboxIo> = {},
  latest: { amount: number; asOf: string } | null = { amount: 9000, asOf: '2026-09-30' },
) {
  const rows: InboxRow[] = [];
  const applied: { assetId: string; reading: BalanceReading; source: string }[] = [];
  const seen = new Set<string>();
  const io: InboxIo = {
    accounts: async () => accounts,
    latestObservation: async () => latest,
    alreadySeen: async (id) => seen.has(id),
    record: async (r) => {
      rows.push(r);
      seen.add(r.messageId);
    },
    apply: async (a) => {
      applied.push(a);
    },
    fetchJson: async () => ({}),
    pdfText: async () => 'statement text',
    ...over,
  };
  return { io, rows, applied };
}

const cfgNoAi = { today: '2026-10-26', ai: null };

describe('runInbox: rule-based alerts', () => {
  it('records the HDFC balance when the sender and one account match, and logs it as applied', async () => {
    const { io, rows, applied } = fakeIo();
    const r = await runInbox([msg()], io, cfgNoAi);
    expect(r).toMatchObject({ applied: 1, needsReview: 0 });
    expect(applied[0]).toMatchObject({ assetId: 'hdfc1', source: 'email' });
    expect(applied[0]!.reading.amount).toBe(10711.96);
    expect(rows[0]).toMatchObject({ outcome: 'applied', assetId: 'hdfc1' });
  });

  it('sends a look-alike sender to review instead of applying', async () => {
    const { io, applied } = fakeIo();
    const r = await runInbox([msg({ from: 'alerts@hdfcbank.bank.in.evil.example' })], io, cfgNoAi);
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('ignores a reading that is not newer than the value on record', async () => {
    const { io, applied } = fakeIo({}, { amount: 5, asOf: '2026-10-25' });
    const r = await runInbox([msg()], io, cfgNoAi);
    expect(applied).toHaveLength(0);
    expect(r.ignored).toBe(1);
  });

  it('skips a message it has already logged (safe to run repeatedly)', async () => {
    const { io, applied } = fakeIo();
    await runInbox([msg()], io, cfgNoAi);
    const again = await runInbox([msg()], io, cfgNoAi);
    expect(again.skipped).toBe(1);
    expect(applied).toHaveLength(1);
  });

  it('ignores marketing mail and reviews a balance for an unknown account', async () => {
    const a = fakeIo();
    expect(
      (await runInbox([msg({ text: 'Festive offers', subject: 'Offers' })], a.io, cfgNoAi)).ignored,
    ).toBe(1);
    const b = fakeIo({ accounts: async () => [] });
    expect((await runInbox([msg()], b.io, cfgNoAi)).needsReview).toBe(1);
  });

  it('keeps going after one message fails and logs the error', async () => {
    let n = 0;
    const { io, rows } = fakeIo({
      latestObservation: async () => {
        if (n++ === 0) throw new Error('database timeout');
        return null;
      },
    });
    const r = await runInbox([msg({ messageId: 'bad' }), msg({ messageId: 'good' })], io, cfgNoAi);
    expect(r).toMatchObject({ errors: 1, applied: 1 });
    expect(rows.find((x) => x.messageId === 'bad')).toMatchObject({
      outcome: 'error',
      reason: 'database timeout',
    });
  });
});

describe('runInbox: statements read by AI', () => {
  const stmt = (o: Partial<InboxMessage> = {}) =>
    msg({
      messageId: 's1',
      subject: 'Your HDFC Bank Account Statement',
      text: 'Please find your statement attached.',
      attachments: [{ filename: 'stmt.pdf', content: new Uint8Array([1]) }],
      ...o,
    });
  const aiReply = (amount: number | string, last4 = '7240', asOf = '2026-10-25') => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            readings: [{ bank: 'HDFC Bank', last4, amount, currency: 'INR', asOf }],
          }),
        },
      },
    ],
  });
  const ai = { provider: 'groq' as const, key: 'gsk_test_12345' };

  it('applies a plausible AI reading from the bank’s own address, recorded as a statement', async () => {
    const { io, applied } = fakeIo({ fetchJson: async () => aiReply(12000) });
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai });
    expect(r.applied).toBe(1);
    expect(applied[0]).toMatchObject({ source: 'statement' });
    expect(applied[0]!.reading.source).toBe('ai');
  });

  it('sends an implausible amount to review', async () => {
    const { io, applied } = fakeIo({ fetchJson: async () => aiReply(900_000) });
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('sends a statement from an unverified sender to review even if the amount is fine', async () => {
    const { io, applied } = fakeIo({ fetchJson: async () => aiReply(12000) });
    const r = await runInbox([stmt({ from: 'someone@gmail.com' })], io, {
      today: '2026-10-26',
      ai,
    });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });

  it('explains when there is no AI key, or the PDF is password-protected', async () => {
    const a = fakeIo();
    await runInbox([stmt()], a.io, cfgNoAi);
    expect(a.rows[0]!.reason).toContain('AI key');
    const b = fakeIo({
      pdfText: async () => {
        throw new Error('password required');
      },
    });
    await runInbox([stmt()], b.io, { today: '2026-10-26', ai });
    expect(b.rows[0]!.reason).toContain('password-protected');
  });

  it('never trusts an AI answer that fails validation', async () => {
    const { io, applied } = fakeIo({ fetchJson: async () => aiReply('abc') });
    const r = await runInbox([stmt()], io, { today: '2026-10-26', ai });
    expect(applied).toHaveLength(0);
    expect(r.needsReview).toBe(1);
  });
});

describe('runInbox: fund statements', () => {
  const casMsg = msg({
    messageId: 'cas1',
    from: 'CAMS <donotreply@camsonline.com>',
    subject: 'Your Consolidated Account Statement',
    attachments: [{ filename: 'cas.pdf', content: new Uint8Array([1]) }],
  });
  it('hands a statement to the importer and logs it as applied', async () => {
    const { io, rows } = fakeIo({
      casImport: async () => ({ outcome: 'imported', reason: '3 funds updated' }),
    });
    const r = await runInbox([casMsg], io, cfgNoAi);
    expect(r).toMatchObject({ applied: 1, needsReview: 0 });
    expect(rows[0]).toMatchObject({ outcome: 'applied', reason: '3 funds updated' });
  });
  it('sends a statement that could not be imported to review, with the reason', async () => {
    const { io, rows } = fakeIo({
      casImport: async () => ({ outcome: 'failed', reason: 'password did not open it' }),
    });
    await runInbox([casMsg], io, cfgNoAi);
    expect(rows[0]).toMatchObject({ outcome: 'needs_review', reason: 'password did not open it' });
  });
  it('does not treat a bank alert as a statement', async () => {
    let called = false;
    const { io } = fakeIo({
      casImport: async () => ((called = true), { outcome: 'imported', reason: '' }),
    });
    await runInbox([msg()], io, cfgNoAi);
    expect(called).toBe(false);
  });
  it('does nothing special when this run has no importer', async () => {
    const { io, rows } = fakeIo();
    await runInbox([casMsg], io, cfgNoAi);
    expect(rows[0]!.outcome).not.toBe('applied');
  });
});
